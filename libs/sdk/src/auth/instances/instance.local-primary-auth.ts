import {SignJWT} from "jose";
import {URL} from 'url';
import {randomBytes, randomUUID} from "crypto";
import {FrontMcpAuth, FrontMcpLogger, LocalAuthOptions, ProviderScope, ServerRequest} from '../../common';
import ProviderRegistry from '../../provider/provider.registry';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import SessionVerifyFlow from '../flows/session.verify.flow';
import OauthAuthorizeFlow from "../flows/oauth.authorize.flow";
import OauthRegisterFlow from "../flows/oauth.register.flow";
import OauthTokenFlow from "../flows/oauth.token.flow";
import {JwksService} from "../jwks";


const DEFAULT_NO_AUTH_SECRET = randomBytes(32)

export class LocalPrimaryAuth extends FrontMcpAuth {
  readonly host: string;
  readonly port: number;
  readonly issuer: string;
  readonly keys: any[] = [];
  readonly secret: Uint8Array;
  readonly logger: FrontMcpLogger;
  private jwks = new JwksService();

  constructor(private providers: ProviderRegistry, metadata: LocalAuthOptions) {
    super(metadata);
    this.logger = this.providers.getActiveScope().logger.child('LocalPrimaryAuth');
    this.port = this.providers.getActiveScope().metadata.http?.port ?? 3001;
    this.host = 'localhost';
    this.issuer = `http://${this.host}:${this.port}`

    if (process.env["JWT_SECRET"]) {
      this.secret = new TextEncoder().encode(process.env["JWT_SECRET"])
    } else {
      this.logger.warn('JWT_SECRET is not set, using default secret')
      this.secret = DEFAULT_NO_AUTH_SECRET;
    }
    this.ready = this.initialize();
  }


  async signAnonymousJwt() {
    const sub = randomUUID()
    return new SignJWT({sub, role: 'user', anonymous: true})
      .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setExpirationTime('1d')
      .sign(this.secret)
  }

  protected async initialize(): Promise<void> {
    // TODO: create separated jwk service for local/remote auth options
    this.providers.injectProvider({
      value: this.jwks,
      metadata: {
        scope: ProviderScope.GLOBAL,
        name: 'auth:jwk-service',
      },
      provide: JwksService,
    });

    await this.registerAuthFlows();


    return Promise.resolve();
  }

  override fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  override validate(request: ServerRequest): Promise<void> {
    return Promise.resolve();
  }


  private async registerAuthFlows() {
    const scope = this.providers.getActiveScope();
    await scope.registryFlows(
      WellKnownPrmFlow, /** /.well-known/oauth-protected-resource */
      WellKnownAsFlow, /** /.well-known/oauth-authorization-server */
      WellKnownJwksFlow, /** /.well-known/jwks.json */
      SessionVerifyFlow, /** Session verification flow */

      OauthAuthorizeFlow,
      OauthTokenFlow,
      OauthRegisterFlow
    );
  }
}