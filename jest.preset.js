const nxPreset = require('@nx/jest/preset').default;
const coveragePreset = require('./jest.coverage.preset.js');
const importsMapper = require('./jest.imports-mapper');

module.exports = {
  ...nxPreset,
  ...coveragePreset,
  // Map #imports (package.json "imports" field) to their Node implementations.
  // Jest does not natively support Node.js conditional #imports, so we resolve
  // them explicitly to the "default" (Node) condition here.
  moduleNameMapper: {
    ...nxPreset.moduleNameMapper,
    ...importsMapper,
  },
};
