import { AuthenticatedServerRequest } from '../server/server.types';
import { ServerResponse } from '../common';

export type TransportType = 'sse' | 'streamable-http' | 'http' | 'stateless-http' | 'in-memory' | 'stdio';

export interface TransportKey {
  type: TransportType;
  token: string;
  tokenHash: string;
  sessionId: string;
  sessionIdSse?: string;
}

export interface RemoteLocation {
  nodeId: string;
  channel: string;
}

export interface TransportBus {
  nodeId(): string;

  advertise(key: TransportKey): Promise<void>;

  revoke(key: TransportKey): Promise<void>;

  lookup(key: TransportKey): Promise<RemoteLocation | null>;

  proxyRequest(
    key: TransportKey,
    payload: {
      method?: string;
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    },
    io: {
      onResponseStart(statusCode: number, headers: Record<string, string>): void;
      onResponseChunk(chunk: Uint8Array | string): void;
      onResponseEnd(finalChunk?: Uint8Array | string): void;
      onError?(err: Error | string): void;
    },
  ): Promise<void>;

  destroyRemote(key: TransportKey, reason?: string): Promise<void>;
}

/* --------------------------------- API ---------------------------------- */

export interface Transporter {
  readonly type: TransportType;
  readonly tokenHash: string;
  readonly sessionId: string;

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  destroy(reason?: string): Promise<void>;

  ping(timeoutMs?: number): Promise<boolean>;

  /**
   * Marks this transport as pre-initialized for session recreation.
   * This is needed when recreating a transport from Redis because the
   * original initialize request was processed by a different transport instance.
   */
  markAsInitialized(): void;
}

export interface TransportRegistryOptions {
  distributed?: boolean;
  bus?: TransportBus;
}

export type TransportTokenBucket = Map<string, Transporter>; // sessionHash -> Transporter
export type TransportTypeBucket = Map<string, TransportTokenBucket>; // tokenHash   -> TokenBucket
export type TransportRegistryBucket = Map<TransportType, TransportTypeBucket>; // tokenHash   -> TokenBucket
