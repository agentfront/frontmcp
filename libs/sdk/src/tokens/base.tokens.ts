export const baseTokenPrefix = 'FrontMcp';

export const tokenFactory = {
  type: (name: string) => Symbol(`${baseTokenPrefix}:type:${name}`),
  meta: (name: string) => Symbol(`${baseTokenPrefix}:meta:${name}`),
}