// Preloaded with NODE_OPTIONS=--require into a CLI process that must not run the server itself.
const Module = require('node:module');

const loadModule = Module._load;
Module._load = function loadWithoutSdk(request, parent, isMain) {
  if (request === '@frontmcp/sdk') throw new Error('the command loaded @frontmcp/sdk: it ran the server in-process');
  return loadModule.call(this, request, parent, isMain);
};
