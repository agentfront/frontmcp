const nxPreset = require('@nx/jest/preset').default;
const coveragePreset = require('./jest.coverage.preset.js');

module.exports = {
  ...nxPreset,
  ...coveragePreset,
};
