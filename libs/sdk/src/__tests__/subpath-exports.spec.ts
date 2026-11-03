// The build writes each subpath export of the package as a re-export of the root entry, so the root exports all its values
describe.each([
  ['./transport', () => import('../transport')],
  ['./job/tools', () => import('../job/tools')],
  ['./workflow/tools', () => import('../workflow/tools')],
])('the %s subpath', (_subpath, loadSubpath) => {
  it('exports only values the root entry exports', async () => {
    const root: Record<string, unknown> = await import('../index');
    const subpathExports: Record<string, unknown> = await loadSubpath();

    const names = Object.keys(subpathExports);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => root[name] !== subpathExports[name])).toEqual([]);
  });
});
