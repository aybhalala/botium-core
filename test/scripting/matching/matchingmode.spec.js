const path = require('path')
const BotDriver = require('../../../').BotDriver
const Capabilities = require('../../../').Capabilities

const echoConnector = ({ queueBotSays }) => {
  return {
    UserSays (msg) {
      const botMsg = { sender: 'bot', sourceData: msg.sourceData, messageText: `You said: ${msg.messageText}` }
      queueBotSays(botMsg)
    }
  }
}

describe('matching.matchingmode', function () {
  beforeEach(async function () {
    const myCaps = {
      [Capabilities.PROJECTNAME]: 'matching.matchingmode',
      [Capabilities.CONTAINERMODE]: echoConnector,
      [Capabilities.SCRIPTING_MATCHING_MODE]: 'regexp'
    }
    const driver = new BotDriver(myCaps)
    this.compiler = driver.BuildCompiler()
    this.container = await driver.Build()
  })
  afterEach(async function () {
    this.container && await this.container.Clean()
  })

  it('should check matching with regex', async function () {
    this.compiler.ReadScript(path.resolve(__dirname, 'convos'), 'regex.convo.txt')
    await this.compiler.convos[0].Run(this.container)
  })
})
