// The `require` variant of `#js-yaml`: js-yaml loads the first time one of its functions is read.
Object.defineProperties(exports, {
  dump: { enumerable: true, get: () => require('js-yaml').dump },
  load: { enumerable: true, get: () => require('js-yaml').load },
});
