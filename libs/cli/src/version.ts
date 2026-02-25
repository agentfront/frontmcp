import { readFileSync } from 'fs';
import { join } from 'path';

export function getSelfVersion(): string {
  const pkgPath = join(__dirname, '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}
