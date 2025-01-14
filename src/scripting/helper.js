const isJSON = require('is-json')

module.exports.linesToConvoStep = (lines, sender, context, eol, singleLineMode = false) => {
  const convoStep = { asserters: [], logicHooks: [], userInputs: [], not: false, sender }

  let textLinesRaw = []
  const textLines = []
  // local eslint accepts it without disable, but build on github does not
  // eslint-disable-next-line no-unused-vars
  let textLinesAccepted = true
  lines.forEach(l => {
    const name = l.split(' ')[0]
    if (sender !== 'me' && context.IsAsserterValid(name)) {
      const args = (l.length > name.length ? l.substr(name.length + 1).split('|').map(a => a.trim()) : [])
      convoStep.asserters.push({ name, args })
    } else if (sender === 'me' && context.IsUserInputValid(name)) {
      const args = (l.length > name.length ? l.substr(name.length + 1).split('|').map(a => a.trim()) : [])
      convoStep.userInputs.push({ name, args })
      textLinesAccepted = false
    } else if (context.IsLogicHookValid(name)) {
      const args = (l.length > name.length ? l.substr(name.length + 1).split('|').map(a => a.trim()) : [])
      convoStep.logicHooks.push({ name, args })
      textLinesAccepted = false
    } else {
      if (sender === 'me') {
        if (!textLinesAccepted) {
          if (l.trim().length) {
            throw new Error(`Failed to parse conversation. Invalid text: '${l.trim()}' in convo:\n ${lines.join('\n')}`)
          } else {
            // skip empty lines
          }
        } else {
          textLinesRaw.push(l)
        }
      } else {
        textLinesRaw.push(l)
      }
    }
    // line is not textline if it is empty, and there is no line with data after it.
    if (textLinesRaw.length > 0) {
      if (l.trim().length) {
        textLines.push(...textLinesRaw)
        textLinesRaw = []
      }
    }
  })

  // deal with just message convosteps
  if (textLinesRaw.length >= 1 && textLines.length === 0) {
    textLines.push(...textLinesRaw)
    textLinesRaw.pop()
  }

  if (textLines.length > 0) {
    if (textLines[0].startsWith('!')) {
      if (!textLines[0].startsWith('!!')) {
        convoStep.not = true
      }
      textLines[0] = textLines[0].substr(1)
    }
    const content = textLines.join(' ')
    if (isJSON(content)) {
      convoStep.sourceData = JSON.parse(content)
    } else {
      /// csv has always just 1 line, and has no eol setting
      if (singleLineMode) {
        convoStep.messageText = textLines[0]
      } else {
        if (eol === null) {
          throw new Error('eol cant be null')
        }
        convoStep.messageText = textLines.join(eol).trim()
      }
    }
  } else {
    // no message is different from empty message
    convoStep.messageText = null
  }
  return convoStep
}
