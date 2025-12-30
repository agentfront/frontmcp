module.exports = {
  displayName: 'json-schema-to-zod-v3',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            decorators: true,
            dynamicImport: true,
          },
          transform: {
            decoratorMetadata: true,
            legacyDecorator: true,
          },
          keepClassNames: true,
          externalHelpers: true,
          loose: true,
        },
        module: {
          type: 'es6',
        },
        sourceMaps: true,
        swcrc: false,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/json-schema-to-zod-v3',
};
