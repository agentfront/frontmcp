import * as os from 'node:os';
import * as path from 'node:path';

/** The folder the daemon watches: `DROP_FOLDER`, else `frontmcp-drop` in the temporary directory. */
export const dropFolder = process.env['DROP_FOLDER'] ?? path.join(os.tmpdir(), 'frontmcp-drop');
