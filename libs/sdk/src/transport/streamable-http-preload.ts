import { toLegacyProtocolFlags } from '../common/types/options/transport/schema';
import type { Scope } from '../scope/scope.instance';
import { loadStreamableHttpTransport } from './adapters/transport.streamable-http.adapter';

// A listening server loads the Streamable HTTP transport while it waits for clients, not on the first initialize.
export function loadStreamableHttpTransportOnStart(scope: Scope): void {
  const { enableStreamableHttp, enableStatelessHttp, enableStatefulHttp } = toLegacyProtocolFlags(
    scope.metadata.transport?.protocol,
  );
  if (!enableStreamableHttp && !enableStatelessHttp && !enableStatefulHttp) return;
  scope.onServerStarted(() => {
    setImmediate(() => {
      loadStreamableHttpTransport().catch((error: unknown) =>
        scope.logger.verbose('Streamable HTTP transport preload failed', { error }),
      );
    });
  });
}
