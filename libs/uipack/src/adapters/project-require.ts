/**
 * Optional packages a rendering option needs, loaded from the server's own project when a tool uses
 * the option.
 *
 * @packageDocumentation
 */

/**
 * Node `require` functions rooted where the server's project resolves packages: the working
 * directory, then the directory of the script Node started. They are Node's own requires, created
 * at run time from the built-in module (so neither a bundler nor a test runner swaps them), load ES
 * modules too, and return the copy of a package the server's own code imports.
 */
function projectRequires(): NodeJS.Require[] {
  const { createRequire } = process.getBuiltinModule('node:module');
  const path = process.getBuiltinModule('node:path');
  const bases = [process.cwd()];
  if (process.argv[1]) bases.push(path.dirname(process.argv[1]));
  return bases.map((base) => createRequire(path.join(base, 'package.json')));
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isNotFound(error: unknown, specifier: string): boolean {
  // Not `instanceof Error`: Node's loader can throw from another realm, as under a test runner
  const { code, message } = (error ?? {}) as Partial<NodeJS.ErrnoException>;
  return (
    (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') &&
    typeof message === 'string' &&
    message.includes(`'${packageName(specifier)}`)
  );
}

function fromProject<T>(specifier: string, purpose: string, use: (projectRequire: NodeJS.Require) => T): T {
  let notFound: unknown;
  for (const projectRequire of projectRequires()) {
    try {
      return use(projectRequire);
    } catch (error) {
      if (!isNotFound(error, specifier)) throw error;
      notFound = error;
    }
  }
  const name = packageName(specifier);
  throw new Error(
    `${purpose} needs ${name}, which is not installed. Install it where the server runs: \`npm install ${name}\`.`,
    { cause: notFound },
  );
}

/**
 * Load a package from the server's project.
 *
 * @param specifier - The package, or a module in it
 * @param purpose - What needs it, named in the error when it isn't installed
 */
export function requireFromProject<T>(specifier: string, purpose: string): T {
  return fromProject(specifier, purpose, (projectRequire) => projectRequire(specifier) as T);
}

/** The path of a file in a package of the server's project. */
export function resolveFromProject(specifier: string, purpose: string): string {
  return fromProject(specifier, purpose, (projectRequire) => projectRequire.resolve(specifier));
}
