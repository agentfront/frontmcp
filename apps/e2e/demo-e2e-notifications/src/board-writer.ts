/** Another process: writes the board given as JSON in argv[2] to the shared store, prints the snapshot, and exits. */
import { board, boardStore, type Board } from './apps/board/board.store';

async function main(): Promise<void> {
  const value = JSON.parse(process.argv[2] ?? '{}') as Board;
  const snapshot = await board.set(value);
  await boardStore.close();
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
