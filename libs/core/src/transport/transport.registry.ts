// server/transport/transport.registry.ts
import {createHash} from 'crypto';
import {
  TransportBus,
  Transporter,
  TransportKey,
  TransportRegistryBucket,
  TransportTokenBucket,
  TransportType,
  TransportTypeBucket,
} from './transport.types';
import {RemoteTransporter} from './transport.remote';
import {LocalTransporter} from './transport.local';
import {AuthInfo} from '@modelcontextprotocol/sdk/server/auth/types.js';
import {ServerResponse} from '@frontmcp/sdk';
import {Scope} from '../scope';
import HandleStreamableHttpFlow from './flows/handle.streamable-http.flow';
import HandleSseFlow from './flows/handle.sse.flow';

export class TransportService {
  readonly ready: Promise<void>;
  private readonly byType: TransportRegistryBucket = new Map();
  private readonly distributed: boolean;
  private readonly bus?: TransportBus;
  private readonly scope: Scope;

  constructor(scope: Scope) {
    this.scope = scope;
    this.distributed = false; // get from scope metadata
    this.bus = undefined; // get from scope metadata
    if (this.distributed && !this.bus) {
      throw new Error('TransportRegistry: distributed=true requires a TransportBus implementation.');
    }

    this.ready = this.initialize();

  }


  private async initialize() {
    await this.scope.registryFlows(
      HandleStreamableHttpFlow,
      HandleSseFlow,
    );
  }

  async destroy() {
    /* empty */
  }

  async getTransporter(type: TransportType, token: string, sessionId: string): Promise<Transporter | undefined> {
    const key = this.keyOf(type, token, sessionId);

    const local = this.lookupLocal(key);
    if (local) return local;

    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        return new RemoteTransporter(key, this.bus);
      }
    }

    return undefined;
  }

  async createTransporter(
    type: TransportType,
    token: string,
    sessionId: string,
    res: ServerResponse,
  ): Promise<Transporter> {
    const key = this.keyOf(type, token, sessionId);
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    const transporter = new LocalTransporter(this.scope, key, res, () => {
      key.sessionId = sessionId;
      this.evictLocal(key);
      if (this.distributed && this.bus) {
        this.bus.revoke(key).catch(() => void 0);
      }
    });

    await transporter.ready();

    this.insertLocal(key, transporter);

    if (this.distributed && this.bus) {
      await this.bus.advertise(key);
    }

    return transporter;
  }

  async destroyTransporter(type: TransportType, token: string, sessionId: string, reason?: string): Promise<void> {
    const key = this.keyOf(type, token, sessionId);

    const local = this.lookupLocal(key);
    if (local) {
      await local.destroy(reason);
      return;
    }

    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        await this.bus.destroyRemote(key, reason);
        return;
      }
    }

    throw new Error('Invalid session: cannot destroy non-existent transporter.');
  }

  /* --------------------------------- internals -------------------------------- */

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private keyOf(type: TransportType, token: string, sessionId: string, sessionIdSse?: string): TransportKey {
    return {
      type,
      token,
      tokenHash: this.sha256(token),
      sessionId,
      sessionIdSse,
    };
  }

  private ensureTypeBucket(type: TransportType): TransportTypeBucket {
    let bucket = this.byType.get(type);
    if (!bucket) {
      bucket = new Map<string, TransportTokenBucket>();
      this.byType.set(type, bucket);
    }
    return bucket;
  }

  private ensureTokenBucket(typeBucket: TransportTypeBucket, tokenHash: string): TransportTokenBucket {
    let bucket = typeBucket.get(tokenHash);
    if (!bucket) {
      bucket = new Map<string, Transporter>();
      typeBucket.set(tokenHash, bucket);
    }
    return bucket;
  }

  lookupWithAuthInfo(authInfo: AuthInfo): Transporter | undefined {
    const key = this.keyOf(authInfo.protocol, authInfo.token, authInfo.sessionId);
    return this.lookupLocal(key);
  }

  private lookupLocal(key: TransportKey): Transporter | undefined {
    const typeBucket = this.byType.get(key.type);
    if (!typeBucket) return undefined;
    const tokenBucket = typeBucket.get(key.tokenHash);
    if (!tokenBucket) return undefined;
    return tokenBucket.get(key.sessionId);
  }

  private insertLocal(key: TransportKey, t: Transporter): void {
    const typeBucket = this.ensureTypeBucket(key.type);
    const tokenBucket = this.ensureTokenBucket(typeBucket, key.tokenHash);
    tokenBucket.set(key.sessionId, t);
  }

  private evictLocal(key: TransportKey): void {
    const typeBucket = this.byType.get(key.type);
    if (!typeBucket) return;
    const tokenBucket = typeBucket.get(key.tokenHash);
    if (!tokenBucket) return;
    tokenBucket.delete(key.sessionId);
    if (tokenBucket.size === 0) typeBucket.delete(key.tokenHash);
    if (typeBucket.size === 0) this.byType.delete(key.type);
  }

  // servers = new Map<string, Server>();
  //
  // private getOrCreate(key: TransportKey): Server {
  //   if (this.servers.has(key.sessionId)) {
  //     return this.servers.get(key.sessionId)!;
  //   }
  //   const serverOptions = {
  //     instructions: 'Expense server',
  //     debouncedNotificationMethods: [],
  //     enforceStrictCapabilities: true,
  //     capabilities: {
  //       tools: {
  //         subscribe: true,
  //         listChanged: true,
  //       },
  //     },
  //   };
  //   const server = new Server({
  //     name: 'Test',
  //     title: 'test test',
  //     version: '1.0.0',
  //
  //   }, serverOptions);
  //   this.servers.set(key.sessionId, server);
  //   return server;
  // }
}
