import { Provider, ProviderScope } from '@frontmcp/sdk';

/** Counts the visits of tools and pages alike: both get the same instance from the app's providers. */
@Provider({ name: 'VisitCounter', scope: ProviderScope.GLOBAL })
export class VisitCounter {
  private visits = 0;

  record(): number {
    return ++this.visits;
  }
}
