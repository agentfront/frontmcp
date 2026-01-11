const { composePlugins, withNx } = require('@nx/webpack');

// Nx plugins for webpack.
module.exports = composePlugins(withNx(), (config) => {
  // Update the webpack config as needed here.
  // e.g. `config.plugins.push(new MyPlugin())`
  const additionalExternals = {
    bufferutil: 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
  };

  // Handle all possible webpack externals types (array, function, object, string, regex)
  if (!config.externals) {
    config.externals = additionalExternals;
  } else if (Array.isArray(config.externals)) {
    config.externals.push(additionalExternals);
  } else {
    // Function, object, string, or regex - wrap in array with our additions
    config.externals = [config.externals, additionalExternals];
  }

  return config;
});
