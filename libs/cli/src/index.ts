import { getSelfVersion } from './core/version';

const version = getSelfVersion();
export const name = `frontmcp cli version ${version}`;

console.log(`Hello, I'm ${name}`);
