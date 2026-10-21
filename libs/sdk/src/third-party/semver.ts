// `#semver` everywhere but a require(): the semver functions the ESM loader uses, each from its own module.
export { default as compare } from 'semver/functions/compare.js';
export { default as gt } from 'semver/functions/gt.js';
export { default as rcompare } from 'semver/functions/rcompare.js';
export { default as satisfies } from 'semver/functions/satisfies.js';
export { default as valid } from 'semver/functions/valid.js';
export { default as maxSatisfying } from 'semver/ranges/max-satisfying.js';
export { default as validRange } from 'semver/ranges/valid.js';
