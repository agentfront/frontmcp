/**
 * Another process: writes the JSON in argv[2] to the shared store, as the board or, with argv[3], as that column's
 * cards; prints the snapshot, and exits.
 */
import { board, boardStore, columns, type Board } from './apps/board/board.store';

async function main(): Promise<void> {
  const value: unknown = JSON.parse(process.argv[2] ?? '{}');
  const column = process.argv[3];
  const snapshot = column ? await columns.key({ column }).set(value as string[]) : await board.set(value as Board);
  await boardStore.close();
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
