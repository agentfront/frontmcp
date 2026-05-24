#!/usr/bin/env node
/**
 * frontmcp - FrontMCP command line interface
 *
 * Uses commander.js for argument parsing, command management, and
 * auto-generated help. Interactive TUI is handled by @clack/prompts.
 */
import { c } from './colors';
import { createProgram } from './program';
import { isProjectCommand, ProjectCommandFailedError } from './project-commands';

async function main(): Promise<void> {
  try {
    const program = await createProgram();

    // `--list-commands` is a top-level metadata flag. Only honor it when it
    // appears BEFORE any verb token — otherwise `frontmcp my-tool --list-commands`
    // would bypass the user's `my-tool` action.
    const argv = process.argv.slice(2);
    const firstVerbIdx = argv.findIndex((a) => !a.startsWith('-'));
    const preVerb = firstVerbIdx === -1 ? argv : argv.slice(0, firstVerbIdx);
    if (preVerb.includes('--list-commands')) {
      for (const sub of program.commands) {
        const tag = isProjectCommand(sub) ? '[project]' : '[built-in]';
        process.stdout.write(`${sub.name()}\t${tag}\t${sub.description() ?? ''}\n`);
      }
      setImmediate(() => process.exit(0));
      return;
    }

    await program.parseAsync(process.argv);
    // Defer process.exit() by one event-loop tick so native addon destructors
    // (ONNX runtime, etc.) can release mutexes before V8 tears down.
    setImmediate(() => process.exit(0));
  } catch (err: unknown) {
    if (err instanceof ProjectCommandFailedError) {
      // The child already printed its own output via stdio:'inherit'; just
      // exit with its code. Don't re-print a stack trace.
      process.exit(err.exitCode);
    }
    console.error('\n' + c('red', err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  }
}

main();
