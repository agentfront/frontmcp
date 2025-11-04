// auth/dcr/dcr.ts
import { makeDcrStore } from './store';
import { DcrStoreInterface } from './store/dcr.store.types';
import { FrontMcpServer } from '@frontmcp/sdk';

export interface DcrManagerOptions {
  baseIssuerUrl?: string; // e.g., https://as.example.com
  policy?: {
    httpsOnlyRedirects: boolean;
    allowLocalhost: boolean;
    allowedAuthMethods: ('client_secret_basic' | 'client_secret_post' | 'private_key_jwt')[];
    maxRedirects: number;
  };
}

export class DcrService {
  store: DcrStoreInterface;

  constructor(private readonly opts: DcrManagerOptions) {
    this.store = makeDcrStore({ kind: 'memory' });
  }

  private registrationClientUri(client_id: string) {
    return `${this.opts.baseIssuerUrl}/oauth/dcr/clients/${client_id}`;
  }

  registerRoutes(host: FrontMcpServer, entryPath: string, appPrefixPath: string) {
    const dcrEndpoint = `${entryPath}${appPrefixPath}/oauth/dcr/register`;
    // host.registerRoute('POST', dcrEndpoint, this.buildDcrRegisterHandler(scopeApps));
    // host.registerRoute('GET', '/oauth/dcr/clients/:clientId', this.buildReadHandler());
    // host.registerRoute('PUT', '/oauth/dcr/clients/:clientId', this.buildUpdateHandler());
    // host.registerRoute('PATCH', '/oauth/dcr/clients/:clientId', this.buildPatchHandler());
    // host.registerRoute('DELETE', '/oauth/dcr/clients/:clientId', this.buildDeleteHandler());

    return {
      dcrEndpoint,
    };
  }

  // private buildDcrRegisterHandler(scopedApps: McpGatewayApp[]) {
  // one-liner per route
  // const { invoker, baseExtras } = makeRouteInvoker(scopedApps, 'dcr.register', {
  //   providerGetters: {
  //     before: [scoped.global(new Map([[DcrStore, this.store]]))],
  //   },
  // });

  // return async (request: ServerRequest, response: ServerResponse) => {
  // unauth route => ctx.sessionId/requestId will be undefined in the flow
  // const result = await DcrRegisterFlow.run(invoker, baseExtras, {
  //   request,
  //   allowAnonymous: true,
  //   policy: {
  //     httpsOnlyRedirects: true,
  //     allowLocalhost: true,
  //     allowedAuthMethods: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
  //     maxRedirects: 5,
  //   },
  // });
  // response.json(result);
  // };
  // }
  getDefaultOptions() {
    return {
      requireInitialAccessToken: true,
      policy: {
        httpsOnlyRedirects: true,
        allowLocalhost: true,
        allowedAuthMethods: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
        maxRedirects: 5,
      },
    };
  }
}
