/**
 * How the generated CLI answers a server's questions (MCP elicitation), such as confirming a destructive action: in
 * the terminal, yes for every yes/no question with `--yes`, and declined when there is no terminal to ask on.
 *
 * NOTE: This file is used as a CJS runtime module, bundled into the CLI output beside the generated CLI entry; the
 * source it returns must stay plain JavaScript.
 */

/** The `terminal-elicitation` module's source: `createElicitationHandler({ assumeYes, input?, output? })`. */
export function generateTerminalElicitationSource(): string {
  return `'use strict';

var readline = require('readline');

function isYesNoQuestion(fields) {
  return Object.keys(fields).every(function(name) { return fields[name].type === 'boolean'; });
}

function allYes(fields) {
  var content = {};
  Object.keys(fields).forEach(function(name) { content[name] = true; });
  return { action: 'accept', content: content };
}

function fieldValue(field, answer) {
  if (field.type === 'boolean') return /^(y|yes|true)$/i.test(answer);
  if (field.type === 'number' || field.type === 'integer') return Number(answer);
  return answer;
}

/**
 * The CLI's elicitation handler, as \`connect({ onElicitation })\` and the daemon client take it.
 * @param {{ assumeYes: () => boolean, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} options
 */
function createElicitationHandler(options) {
  var input = options.input || process.stdin;
  var output = options.output || process.stderr;

  function ask(question) {
    return new Promise(function(resolve) {
      var prompt = readline.createInterface({ input: input, output: output });
      prompt.question(question, function(answer) {
        prompt.close();
        resolve(answer.trim());
      });
    });
  }

  async function askEachField(fields) {
    var content = {};
    var names = Object.keys(fields);
    for (var i = 0; i < names.length; i++) {
      var field = fields[names[i]];
      var answer = await ask('  ' + (field.title || names[i]) + (field.description ? ' (' + field.description + ')' : '') + ': ');
      if (answer !== '') content[names[i]] = fieldValue(field, answer);
    }
    return { action: 'accept', content: content };
  }

  return async function answerElicitation(request) {
    var fields = (request.requestedSchema && request.requestedSchema.properties) || {};
    var yesNo = isYesNoQuestion(fields);
    if (yesNo && options.assumeYes()) return allYes(fields);
    if (!input.isTTY) {
      var retry = yesNo ? ' Run the command again with --yes to confirm.' : '';
      output.write(request.message + '\\nDeclined: there is no terminal to ask on.' + retry + '\\n');
      return { action: 'decline' };
    }
    if (!yesNo) {
      output.write(request.message + '\\n');
      return askEachField(fields);
    }
    var answer = await ask(request.message + ' [y/N] ');
    return /^y(es)?$/i.test(answer) ? allYes(fields) : { action: 'decline' };
  };
}

exports.createElicitationHandler = createElicitationHandler;
`;
}
