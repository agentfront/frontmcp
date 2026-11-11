import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

import { ROUTE_CHANGED_EVENT } from './router-bridge';

/** The event a navigation publishes: declare it on the server (`create({ eventDefinitions })`) to let clients subscribe. */
export function createRouteChangedEvent(name: string = ROUTE_CHANGED_EVENT) {
  return event({
    name,
    description: 'Fires when the page navigates to another route',
    payloadSchema: {
      pathname: z.string().describe('The path navigated to'),
      search: z.string().describe('The query string, with its leading "?", or empty'),
      hash: z.string().describe('The fragment, with its leading "#", or empty'),
      previous: z.string().describe('The path, query and fragment navigated from'),
    },
  });
}
