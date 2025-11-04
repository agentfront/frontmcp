export class ControlRespond<T = unknown> extends Error {
  constructor(public value: T) {
    super('ControlRespond');
    this.name = 'ControlRespond';
  }
}


export class ControlAbort extends Error {
  constructor(
    public reason: string,
    public code?: string,
    public httpStatus?: number
  ) {
    super('ControlAbort');
    this.name = 'ControlAbort';
  }
}

export class ControlRetryAfter extends Error {
  constructor(public ms: number, public reason?: string) {
    super('ControlRetryAfter');
    this.name = 'ControlRetryAfter';
  }
}
