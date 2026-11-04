import { runEvalCommand } from './cli';

runEvalCommand(process.argv.slice(2), process.env, (text) => console.log(text)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
