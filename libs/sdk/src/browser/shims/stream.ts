/**
 * Browser shim for node:stream
 *
 * Provides stub classes for type compatibility.
 * Node.js streams are not needed for in-memory transport.
 */

export class Readable {
  pipe(): this {
    return this;
  }
  on(): this {
    return this;
  }
  read(): null {
    return null;
  }
  destroy(): this {
    return this;
  }
}

export class Writable {
  write(): boolean {
    return true;
  }
  end(): this {
    return this;
  }
  on(): this {
    return this;
  }
  destroy(): this {
    return this;
  }
}

export class Transform extends Readable {}
export class Duplex extends Readable {}
export class PassThrough extends Transform {}

export default { Readable, Writable, Transform, Duplex, PassThrough };
