import { getSelfVersion } from './version';

const version = getSelfVersion();
export const name = `frontmcp cli version ${version}`;

console.log(`Hello, I'm ${name}`);
