import { resourceStore } from '@frontmcp/sdk';

export interface Board {
  open: number;
  note: string;
}

/** The SQLite file the server and the writer processes share. */
const boardDatabase = process.env['BOARD_DB'];
if (!boardDatabase) throw new Error('Set BOARD_DB to the SQLite file the board is kept in');

export const boardStore = resourceStore({ storage: { type: 'sqlite', sqlite: { path: boardDatabase } } });

export const board = boardStore.key<Board>('board', { initial: { open: 0, note: '' } });

/** The cards of each column, which other processes write: `board://columns/{column}` serves each column's key. */
export const columns = boardStore.family<string[]>('columns', { initial: [] });
