#!/usr/bin/env node
/**
 * frontmcp - FrontMCP command line interface
 *
 * Uses commander.js for argument parsing, command management, and
 * auto-generated help. Interactive TUI is handled by @clack/prompts.
 */

import { createProgram } from './program';
import { c } from './colors';

async function main(): Promise<void> {
  try {
    const program = createProgram();
    await program.parseAsync(process.argv);
    // Defer process.exit() by one event-loop tick so native addon destructors
    // (ONNX runtime, etc.) can release mutexes before V8 tears down.
    setImmediate(() => process.exit(0));
  } catch (err: unknown) {
    console.error('\n' + c('red', err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  }
}

main();
