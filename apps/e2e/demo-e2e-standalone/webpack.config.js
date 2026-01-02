const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/e2e/demo-e2e-standalone'),
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'eval-cheap-module-source-map',
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      sourceMap: true,
      tsConfig: './tsconfig.app.json',
      assets: [],
      externalDependencies: 'all',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      buildLibsFromSource: true,
    }),
  ],
};
