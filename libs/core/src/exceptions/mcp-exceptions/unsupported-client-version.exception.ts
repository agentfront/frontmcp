export class UnsupportedClientVersionException extends Error {
  constructor(public version: string) {
    super(`Unsupported client version: ${version}`);
  }
  static fromVersion(version: string) {
    return new UnsupportedClientVersionException(version);
  }
}
