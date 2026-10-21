// The `require` variant of `#semver`: each semver function loads its module the first time it is read.
Object.defineProperties(exports, {
  compare: { enumerable: true, get: () => require('semver/functions/compare.js') },
  gt: { enumerable: true, get: () => require('semver/functions/gt.js') },
  rcompare: { enumerable: true, get: () => require('semver/functions/rcompare.js') },
  satisfies: { enumerable: true, get: () => require('semver/functions/satisfies.js') },
  valid: { enumerable: true, get: () => require('semver/functions/valid.js') },
  maxSatisfying: { enumerable: true, get: () => require('semver/ranges/max-satisfying.js') },
  validRange: { enumerable: true, get: () => require('semver/ranges/valid.js') },
});
