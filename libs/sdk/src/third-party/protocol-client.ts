// `#protocol-client` everywhere but an ESM import: `@frontmcp/protocol/client`, whose require() variant loads on first read.
import * as protocolClient from '@frontmcp/protocol/client';

export type ProtocolClientModule = typeof protocolClient;

export const loadProtocolClient = async (): Promise<ProtocolClientModule> => protocolClient;
