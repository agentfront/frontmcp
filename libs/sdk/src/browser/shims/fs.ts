/**
 * Browser shim for node:fs and node:fs/promises
 *
 * File system operations are not available in the browser.
 * All calls throw a clear error directing users to pass config via objects.
 */

function notAvailable(method: string): never {
  throw new Error(
    `fs.${method}() is not available in the browser. ` +
      'Pass configuration via objects instead of loading from files.',
  );
}

export function readFile(): never {
  return notAvailable('readFile');
}
export function writeFile(): never {
  return notAvailable('writeFile');
}
export function readFileSync(): never {
  return notAvailable('readFileSync');
}
export function writeFileSync(): never {
  return notAvailable('writeFileSync');
}
export function existsSync(): boolean {
  return false;
}
export function mkdirSync(): never {
  return notAvailable('mkdirSync');
}
export function mkdir(): never {
  return notAvailable('mkdir');
}
export function stat(): never {
  return notAvailable('stat');
}
export function access(): never {
  return notAvailable('access');
}
export function unlink(): never {
  return notAvailable('unlink');
}
export function readdir(): never {
  return notAvailable('readdir');
}

export const promises = {
  readFile,
  writeFile,
  mkdir,
  stat,
  access,
  unlink,
  readdir,
};

export default {
  readFile,
  readFileSync,
  writeFile,
  writeFileSync,
  existsSync,
  mkdirSync,
  mkdir,
  stat,
  access,
  unlink,
  readdir,
  promises,
};
