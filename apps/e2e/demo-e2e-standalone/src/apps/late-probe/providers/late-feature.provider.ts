import { Provider, type ScopeEntry } from '@frontmcp/sdk';

/** A feature started on demand, after the server is up, that reports itself on /readyz while it runs. */
@Provider({ name: 'late-feature' })
export class LateFeature {
  private removeProbe?: () => void;

  start(scope: ScopeEntry, healthy: boolean): void {
    this.stop();
    this.removeProbe = scope.registerHealthProbe({
      name: 'late-feature',
      check: async () => (healthy ? { status: 'healthy' } : { status: 'unhealthy', error: 'the late feature is down' }),
    });
  }

  stop(): void {
    this.removeProbe?.();
    this.removeProbe = undefined;
  }
}
