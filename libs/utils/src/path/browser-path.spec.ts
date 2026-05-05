import { isAbsolute } from './browser-path';

describe('browser-path.isAbsolute', () => {
  it('rejects empty input', () => {
    expect(isAbsolute('')).toBe(false);
  });

  it('treats POSIX root as absolute', () => {
    expect(isAbsolute('/foo')).toBe(true);
    expect(isAbsolute('/foo/bar.md')).toBe(true);
  });

  it('treats a leading backslash (UNC / Windows root) as absolute', () => {
    // `\\server\share` and `\foo` both pass the leading-separator check.
    expect(isAbsolute('\\foo')).toBe(true);
    expect(isAbsolute('\\\\server\\share')).toBe(true);
  });

  it('treats Windows drive letters with separator as absolute', () => {
    expect(isAbsolute('C:\\foo')).toBe(true);
    expect(isAbsolute('C:/foo')).toBe(true);
    expect(isAbsolute('z:\\foo')).toBe(true);
  });

  it('rejects drive letter without a separator', () => {
    // `C:foo` is a Windows drive-relative path, not absolute.
    expect(isAbsolute('C:foo')).toBe(false);
  });

  it('rejects bare relative paths', () => {
    expect(isAbsolute('foo')).toBe(false);
    expect(isAbsolute('foo/bar')).toBe(false);
    expect(isAbsolute('./foo')).toBe(false);
    expect(isAbsolute('../foo')).toBe(false);
  });
});
