const util = require('util')
const fs = require('fs')
const path = require('path')
const async = require('async')
const mkdirp = require('mkdirp')
const slugify = require('slugify')
const moment = require('moment')
const randomize = require('randomatic')
const _ = require('lodash')
const boolean = require('boolean')
const EventEmitter = require('events')
const debug = require('debug')('botium-BotDriver')

const { version } = require('../package.json')

const Defaults = require('./Defaults')
const Capabilities = require('./Capabilities')
const Source = require('./Source')
const Fluent = require('./Fluent')
const Events = require('./Events')
const ScriptingProvider = require('./scripting/ScriptingProvider')

module.exports = class BotDriver {
  constructor (caps = {}, sources = {}, envs = {}) {
    this.eventEmitter = new EventEmitter()

    this.caps = _.cloneDeep(Defaults.Capabilities)
    this.sources = _.cloneDeep(Defaults.Sources)
    this.envs = _.cloneDeep(Defaults.Envs)

    this._fetchConfigFromFiles(['./botium.json', './botium.local.json'])

    const botiumConfigEnv = process.env.BOTIUM_CONFIG
    if (botiumConfigEnv) {
      if (!this._fetchConfigFromFiles([botiumConfigEnv])) {
        throw new Error(`FAILED: Botium configuration file ${botiumConfigEnv} not available`)
      }
    }

    const sourcesToTest = Object.keys(Source)

    Object.keys(process.env).filter(e => e.startsWith('BOTIUM_')).forEach((element) => {
      const elementToTest = element.replace(/^BOTIUM_/, '')
      if (sourcesToTest.includes(elementToTest)) {
        this._mergeCaps(this.sources, { [elementToTest]: process.env[element] })
        debug('Changed source ' + elementToTest + ' to "' + this.sources[elementToTest] + '" using environment variables.')
      } else {
        this._mergeCaps(this.caps, { [elementToTest]: process.env[element] })
        debug('Changed capability ' + elementToTest + ' to "' + this.caps[elementToTest] + '" using environment variables.')
      }
      if (element.startsWith('BOTIUM_ENV_')) {
        const envName = element.replace(/^BOTIUM_ENV_/, '')
        this.envs[envName] = process.env[element]
        debug('Changed env ' + envName + ' to "' + process.env[element] + '" using environment variables.')
      }
    })

    if (caps) this._mergeCaps(this.caps, caps)
    if (sources) this._mergeCaps(this.sources, sources)
    if (envs) this.envs = _.merge(this.envs, envs)
  }

  on (event, listener) {
    this.eventEmitter.on(event, listener)
    return this
  }

  setCapabilities (caps) {
    this._mergeCaps(this.caps, caps)
    return this
  }

  setCapability (cap, value) {
    this._mergeCaps(this.caps, { [cap]: value })
    return this
  }

  setSources (sources) {
    this._mergeCaps(this.sources, sources)
    return this
  }

  setSource (source, value) {
    this._mergeCaps(this.sources, { [source]: value })
    return this
  }

  setEnvs (envs) {
    this.envs = _.merge(this.envs, envs)
    return this
  }

  setEnv (name, value) {
    this.envs[name] = value
    return this
  }

  BuildFluent () {
    this.Fluent = new Fluent(this)
    return this.Fluent
  }

  Build () {
    debug(`Build - Botium Core Version: ${version}`)
    debug(`Build - Capabilites: ${util.inspect(this.caps)}`)
    debug(`Build - Sources : ${util.inspect(this.sources)}`)
    debug(`Build - Envs : ${util.inspect(this.envs)}`)
    this.eventEmitter.emit(Events.CONTAINER_BUILDING)

    return new Promise((resolve, reject) => {
      let repo = null
      let container = null

      async.series([

        (driverValidated) => {
          this._validate()
            .then(() => driverValidated())
            .catch(driverValidated)
        },

        (repoValidated) => {
          try {
            repo = this._getRepo()
          } catch (err) {
            return repoValidated(err)
          }
          repo.Validate().then(() => repoValidated()).catch(repoValidated)
        },

        (repoPrepared) => {
          repo.Prepare().then(() => repoPrepared()).catch(repoPrepared)
        },

        (containerValidated) => {
          try {
            container = this._getContainer(repo)
          } catch (err) {
            return containerValidated(err)
          }
          container.Validate().then(() => containerValidated()).catch(containerValidated)
        },

        (containerBuilt) => {
          container.Build().then(() => containerBuilt()).catch(containerBuilt)
        }

      ], (err) => {
        if (err) {
          debug(`BotDriver Build error: ${err}`)
          this.eventEmitter.emit(Events.CONTAINER_BUILD_ERROR, err)
          return reject(err)
        }
        this.eventEmitter.emit(Events.CONTAINER_BUILT, container)
        resolve(container)
      })
    })
  }

  BuildCompiler () {
    debug(`BuildCompiler: Capabilites: ${util.inspect(this.caps)}`)
    try {
      const compiler = new ScriptingProvider(this.caps)
      compiler.Build()
      return compiler
    } catch (err) {
      debug(`BotDriver BuildCompiler error: ${err}`)
      throw err
    }
  }

  /* Private Functions */

  // loadConfig from files
  _loadConfigFile (filename) {
    try {
      const configJson = JSON.parse(fs.readFileSync(filename))
      if (configJson.botium) {
        if (configJson.botium.Capabilities) this._mergeCaps(this.caps, configJson.botium.Capabilities)
        if (configJson.botium.Sources) this._mergeCaps(this.sources, configJson.botium.Sources)
        if (configJson.botium.Envs) this._mergeCaps(this.envs, configJson.botium.Envs)
        debug(`Loaded Botium configuration file ${filename}`)
        return true
      } else {
        debug(`Botium configuration file ${filename} contains no botium configuration. Ignored.`)
        return false
      }
    } catch (err) {
      throw new Error(`FAILED: loading Botium configuration file ${filename}: ${util.inspect(err)}`)
    }
  }

  // fetches config from files ordered by priority later files overwrite previous
  _fetchConfigFromFiles (files) {
    return files
      .filter(file => fs.existsSync(file))
      .map(file => {
        this._loadConfigFile(file)
        return file
      })
  }

  _findKeyProperty (obj) {
    const lookup = ['id', 'ID', 'Id', 'ref', 'REF', 'Ref', 'name', 'NAME', 'Name']
    for (const checkPropIdx in lookup) {
      if (Object.prototype.hasOwnProperty.call(obj, lookup[checkPropIdx])) return lookup[checkPropIdx]
    }
  }

  _mergeCaps (caps, newCaps) {
    if (!caps) return
    Object.keys(newCaps).forEach(capKey => {
      if (!Object.prototype.hasOwnProperty.call(caps, capKey)) {
        if (_.isString(newCaps[capKey])) {
          try {
            caps[capKey] = JSON.parse(newCaps[capKey])
          } catch (err) {
            caps[capKey] = newCaps[capKey]
          }
        } else {
          caps[capKey] = newCaps[capKey]
        }
        return
      }

      if (_.isArray(caps[capKey])) {
        let newCapArray = newCaps[capKey]
        if (!_.isArray(newCapArray)) {
          try {
            newCapArray = JSON.parse(newCapArray)
          } catch (err) {
            debug(`Expected JSON Array in capability ${capKey}, JSON parse failed (${err}). Capability will be overwritten with maybe unexpected side effects.`)
          }
        }
        if (_.isArray(newCapArray)) {
          newCapArray.forEach(capElement => {
            const mergeKey = this._findKeyProperty(capElement)
            if (mergeKey) {
              const oldElement = caps[capKey].find(oldElement => oldElement[mergeKey] && oldElement[mergeKey] === capElement[mergeKey])
              if (oldElement) {
                _.merge(oldElement, capElement)
                return
              }
            }
            caps[capKey].push(capElement)
          })
          return
        }
      }
      if (!_.isArray(caps[capKey]) && _.isObject(caps[capKey])) {
        let newCapObject = newCaps[capKey]
        if (!_.isObject(newCapObject)) {
          try {
            newCapObject = JSON.parse(newCapObject)
          } catch (err) {
            debug(`Expected JSON Object in capability ${capKey}, JSON parse failed (${err}). Capability will be overwritten with maybe unexpected side effects.`)
          }
        }
        if (_.isObject(newCapObject)) {
          _.merge(caps[capKey], newCapObject)
          return
        }
      }

      if (_.isBoolean(caps[capKey])) {
        if (!_.isBoolean(newCaps[capKey])) {
          caps[capKey] = boolean(newCaps[capKey])
          return
        }
      }

      caps[capKey] = newCaps[capKey]
    })
  }

  _validate () {
    return new Promise((resolve, reject) => {
      if (!this.caps[Capabilities.PROJECTNAME]) {
        throw new Error(`Capability property ${Capabilities.PROJECTNAME} not set`)
      }
      if (!this.caps[Capabilities.TEMPDIR]) {
        throw new Error(`Capability property ${Capabilities.TEMPDIR} not set`)
      }

      async.series([
        (tempdirCreated) => {
          this.tempDirectory = path.resolve(process.cwd(), this.caps[Capabilities.TEMPDIR], slugify(`${this.caps[Capabilities.PROJECTNAME]} ${moment().format('YYYYMMDD HHmmss')} ${randomize('Aa0', 5)}`))

          mkdirp(this.tempDirectory, (err) => {
            if (err) {
              return tempdirCreated(new Error(`Unable to create temp directory ${this.tempDirectory}: ${err}`))
            }
            tempdirCreated()
          })
        }

      ], (err) => {
        if (err) {
          return reject(err)
        }
        resolve(this)
      })
    })
  }

  _getRepo () {
    if (this.caps[Capabilities.BOTIUMGRIDURL]) {
      const NoRepo = require('./repos/NoRepo')
      return new NoRepo(this.tempDirectory, this.sources)
    }
    if (this.sources[Source.GITURL]) {
      const GitRepo = require('./repos/GitRepo')
      return new GitRepo(this.tempDirectory, this.sources)
    }
    if (this.sources[Source.LOCALPATH]) {
      const LocalRepo = require('./repos/LocalRepo')
      return new LocalRepo(this.tempDirectory, this.sources)
    }
    throw new Error(`No Repo provider found for Sources ${util.inspect(this.sources)}`)
  }

  _getContainer (repo) {
    if (this.caps[Capabilities.BOTIUMGRIDURL]) {
      const GridContainer = require('./containers/GridContainer')
      return new GridContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
    }
    if (!this.caps[Capabilities.CONTAINERMODE]) {
      throw new Error(`Capability '${Capabilities.CONTAINERMODE}' missing`)
    }
    if (this.caps[Capabilities.CONTAINERMODE] === 'docker') {
      const DockerContainer = require('./containers/DockerContainer')
      return new DockerContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
    }
    if (this.caps[Capabilities.CONTAINERMODE] === 'fbdirect') {
      const FbContainer = require('./containers/FbContainer')
      return new FbContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
    }
    if (this.caps[Capabilities.CONTAINERMODE] === 'webspeech') {
      const WebSpeechContainer = require('./containers/WebSpeechContainer')
      return new WebSpeechContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
    }
    if (this.caps[Capabilities.CONTAINERMODE] === 'inprocess') {
      const InProcessContainer = require('./containers/InProcessContainer')
      return new InProcessContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
    }
    const PluginConnectorContainer = require('./containers/PluginConnectorContainer')
    return new PluginConnectorContainer(this.eventEmitter, this.tempDirectory, repo, this.caps, this.envs)
  }
}
