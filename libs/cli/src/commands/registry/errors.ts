/** A failure the user can act on: the command prints the message without a stack trace and exits 1. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}
