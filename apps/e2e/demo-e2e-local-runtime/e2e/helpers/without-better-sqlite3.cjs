// Preloaded with NODE_OPTIONS=--require into a process on a machine where better-sqlite3 could not be installed.
const Module = require('node:module');

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithoutBetterSqlite3(request, ...rest) {
  if (request === 'better-sqlite3') {
    throw Object.assign(new Error("Cannot find module 'better-sqlite3'"), { code: 'MODULE_NOT_FOUND' });
  }
  return resolveFilename.call(this, request, ...rest);
};
