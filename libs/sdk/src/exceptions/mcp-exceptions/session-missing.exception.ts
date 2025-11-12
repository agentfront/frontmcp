export class SessionMissingException extends Error {
  constructor(message = 'Unauthorized: missing session') {
    super(message);
    this.name = 'SessionMissingError';
  }
}
