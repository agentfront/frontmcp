// Which Express the node:http host stands in for (#948): it serves requests the way an Express app would only when
// it can read the installed Express (4 or 5) and its body-parser (2), and find the packages it loads itself.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { ExpressFlavor } from './express-compat';

function majorVersion(manifestPath: string): number {
  const { version } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
  return Number.parseInt(String(version), 10);
}

/** The installed Express's flavor, or undefined when the node:http host cannot stand in for it. */
export function detectExpressFlavor(): ExpressFlavor | undefined {
  try {
    const expressManifest = require.resolve('express/package.json');
    const major = majorVersion(expressManifest);
    if (major !== 4 && major !== 5) return undefined;
    if (majorVersion(createRequire(expressManifest).resolve('body-parser/package.json')) !== 2) return undefined;
    // What the Express host loads with Express, and what this host loads in its place
    require.resolve('cors');
    require.resolve('raw-body');
    require.resolve('content-type');
    return { major };
  } catch {
    return undefined;
  }
}
