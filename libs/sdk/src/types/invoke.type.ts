export class ControlRespond extends Error {
  constructor(public value: unknown) {
    super('CONTROL_RESPOND');
  }
}
export class ControlAbort extends Error {
  constructor(
    public reason: string,
    public code?: string,
    public httpStatus?: number,
  ) {
    super('CONTROL_ABORT');
  }
}
export class ControlRetryAfter extends Error {
  constructor(
    public ms: number,
    public reason?: string,
  ) {
    super('CONTROL_RETRY_AFTER');
  }
}
