// Stub for ExpressHostAdapter in browser builds

export interface ExpressHostAdapterOptions {
  cors?: unknown;
}

export class ExpressHostAdapter {
  constructor(_options?: ExpressHostAdapterOptions) {
    throw new Error('ExpressHostAdapter is not available in browser environments');
  }
}
