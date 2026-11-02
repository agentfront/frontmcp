module.exports = {
  preset: '@frontmcp/testing/jest-preset-unit',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};
