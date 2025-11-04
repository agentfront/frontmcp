// // auth/dcr/flows/dcr.register.flow.ts
// import 'reflect-metadata';
// import crypto from 'node:crypto';
// import { ServerRequest } from '../../../../server/server.types';
// import {  RegistrarIdentity, DcrPolicyOptions } from '../../dcr.types';
// import { Invoker, FlowAsCtx, HooksOf, InvokePlan, type RunExtras } from '../../../../invoker';
// import {
//   DcrRegisterInput,
//   DcrRegisterResult,
//   DcrRegisterInputSchema,
//   DcrRegisterResultSchema,
//   DcrRegisterStage,
//   dcrRegisterPlan,
// } from './dcr.register.types';
// import {
//   safeFetchJwks,
//   verifyInitialAccessToken,
//   issueRegistrationAccessToken,
//   verifySoftwareStatement,
//   validateClientMetadata,
//   makeHttpError,
// } from '../../dcr.utils';
// import { DcrStore } from '../../store';
// import { ManagedClient } from '../../store/dcr.store.types';
//
// const { Stage } = HooksOf<DcrRegisterStage>();
//
// export type DcrRegisterFlowOptions = {
//   request: ServerRequest & { baseUrl?: string };
//   allowAnonymous: boolean;
//
//   // Policy fed into your utils.validateClientMetadata()
//   policy: DcrPolicyOptions;
//
//   // Client Configuration (management) support
//   enableClientConfiguration?: boolean; // if true, issue RAT + return registration_client_uri
//   registrationTokenTtlSeconds?: number; // default 86400
//
//   // Scope allow-list (optional hardening)
//   allowedScopes?: string[];
// };
//
// @InvokePlan<DcrRegisterStage>(dcrRegisterPlan)
// export default class DcrRegisterFlow extends FlowAsCtx<ServerRequest, DcrRegisterInput, DcrRegisterResult> {
//   // static run(
//   //   invoker: Invoker,
//   //   extras: Partial<RunExtras<DcrRegisterStage>>,
//   //   options: DcrRegisterFlowOptions,
//   // ): Promise<DcrRegisterResult> {
//   //   return super.invoke.bind(DcrRegisterFlow)(invoker, extras, options) as Promise<DcrRegisterResult>;
//   // }
//
//   constructor(private readonly options: DcrRegisterFlowOptions) {
//     super({ rawInput: options.request });
//   }
//
//   state: {
//     authMethod?: 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt';
//     clientId?: string;
//     clientSecret?: string;
//     needsSecret?: boolean;
//     client?: ManagedClient;
//     registrar?: RegistrarIdentity;
//     rat?: string;
//     ratExp?: number;
//   } = {};
//
//   // ====== Pre ======
//
//   @Stage('parseInput')
//   async parseInput() {
//     const authz = String(this.rawInput?.headers?.['authorization'] ?? '').trim();
//     this.inputDraft = {
//       initialAccessToken: authz || undefined,
//       body: this.rawInput?.body || {},
//     };
//   }
//
//   @Stage('validateInput')
//   async validateInput() {
//     // Base Zod schema (includes defaults)
//     this.input = DcrRegisterInputSchema.parse(this.inputDraft);
//     const meta = this.input.body;
//
//     // Optional scope allow-list
//     if (meta.scope && this.options.allowedScopes) {
//       const requested = new Set(meta.scope.split(/\s+/).filter(Boolean));
//       for (const s of requested) {
//         if (!this.options.allowedScopes.includes(s)) {
//           throw makeHttpError(400, 'invalid_scope', `scope "${s}" not allowed`);
//         }
//       }
//     }
//
//     // Resolve auth method & whether we need a client secret
//     const method = meta.token_endpoint_auth_method ?? 'client_secret_basic';
//     this.state.authMethod = method;
//     this.state.needsSecret = method !== 'private_key_jwt';
//
//   }
//
//   // ====== Execute ======
//
//   @Stage('checkRegistrar')
//   async checkRegistrar() {
//     const { initialAccessToken, body } = this.input;
//
//     if ((!initialAccessToken || initialAccessToken.length === 0) && this.options.allowAnonymous) {
//       // Anonymous registrar identity (very limited; use with caution)
//       this.state.registrar = {
//         org_id: body.client_name,
//         user_id: `${body.client_name}_an_`,
//         env: 'anon',
//         scopes: ['dcr:register'],
//       };
//       return;
//     }
//
//     // Verify IAT using your util (JWT/opaque check lives there)
//     this.state.registrar = await verifyInitialAccessToken(initialAccessToken);
//     if (!this.state.registrar?.scopes?.includes('dcr:register')) {
//       throw makeHttpError(403, 'insufficient_scope', 'missing dcr:register');
//     }
//   }
//
//   @Stage('checkDcrPolicy')
//   async checkDcrPolicy() {
//     const meta = this.input.body;
//
//     // Optional SSA validation (no-op if not present)
//     await verifySoftwareStatement(meta.software_statement, this.state.registrar);
//
//     // If jwks_uri provided but no jwks, fetch via SSRF-safe helper
//     if (meta.jwks_uri && !meta.jwks) {
//       meta.jwks = await safeFetchJwks(meta.jwks_uri);
//     }
//
//     // Validate + normalize metadata via your policy aware util
//     // This will also apply defaults (grant_types/response_types/auth_method)
//     validateClientMetadata(meta, this.options.policy);
//   }
//
//   @Stage('generateClientSecretId')
//   async generateClientSecretId() {
//     this.state.clientId = this.generateClientId();
//     if (this.state.needsSecret) {
//       this.state.clientSecret = this.generateClientSecret();
//     }
//   }
//
//   @Stage('persistClient')
//   async persistClient() {
//     const store = this.get(DcrStore);
//     const meta = this.input.body;
//     const { clientId, registrar } = this.state;
//
//     if (!clientId) throw makeHttpError(500, 'server_error', 'missing clientId');
//     if (!registrar) throw makeHttpError(500, 'server_error', 'missing registrar');
//
//     // Persist exactly what you accepted
//     const created = await store.create({
//       client_id: clientId,
//       client_secret: this.state.clientSecret, // may be undefined for private_key_jwt
//       metadata: meta,
//       owner: { org_id: registrar.org_id, user_id: registrar.user_id },
//     });
//
//     this.state.client = created;
//
//     // Ensure we keep the secret value we intend to return
//     if (!this.state.clientSecret && created.client_secret) {
//       this.state.clientSecret = created.client_secret;
//     }
//
//     // Issue a Registration Access Token if you support Client Configuration
//     if (this.options.enableClientConfiguration) {
//       const ttl = this.options.registrationTokenTtlSeconds ?? 86400;
//       const now = Math.floor(Date.now() / 1000);
//       this.state.rat = await issueRegistrationAccessToken({ client_id: clientId, scope: ['dcr:manage'] }, ttl);
//       this.state.ratExp = now + ttl;
//
//       // // Optionally persist RAT with the store, if supported
//       // if (typeof (store as any).saveRegistrationToken === 'function') {
//       //   await (store as any).saveRegistrationToken({
//       //     client_id: clientId,
//       //     token: this.state.rat,
//       //     exp: this.state.ratExp,
//       //   });
//       // }
//     }
//   }
//
//   @Stage('buildOutput')
//   async buildOutput() {
//     const id = this.state.client?.client_id;
//     const meta = this.input.body;
//
//     if (!id) throw makeHttpError(500, 'server_error', 'missing client_id');
//
//     // Make sure the response reflects the auth method we accepted
//     if (this.state.authMethod) {
//       meta.token_endpoint_auth_method = this.state.authMethod;
//     }
//
//     const now = Math.floor(Date.now() / 1000);
//     const registrationClientUri =
//       this.options.enableClientConfiguration && this.options.request?.baseUrl
//         ? `${this.options.request.baseUrl.replace(/\/+$/, '')}/oauth/clients/${encodeURIComponent(id)}`
//         : undefined;
//
//     // Build RFC 7591-style response: issued identifiers + echoed metadata
//     const result: Record<string, unknown> = {
//       client_id: id,
//       client_id_issued_at: now,
//       client_secret_expires_at: 0,
//       ...(this.state.clientSecret ? { client_secret: this.state.clientSecret } : {}),
//       ...(registrationClientUri ? { registration_client_uri: registrationClientUri } : {}),
//       ...(this.state.rat ? { registration_access_token: this.state.rat } : {}),
//       ...meta, // echo accepted metadata
//     };
//
//     this.outputDraft = result as DcrRegisterResult;
//   }
//
//   // ====== Post ======
//
//   @Stage('validateOutput')
//   async validateOutput() {
//     // .passthrough() in the schema lets echoed metadata through
//     this.output = DcrRegisterResultSchema.parse(this.outputDraft);
//   }
//
//   // ====== Helpers ======
//
//   private generateClientId(): string {
//     // ~144 bits entropy, url-safe
//     return 'cli_' + crypto.randomBytes(18).toString('base64url');
//     // If you need UUIDs instead, use crypto.randomUUID()
//   }
//
//   private generateClientSecret(): string {
//     // ~256 bits entropy, url-safe
//     return 'sec_' + crypto.randomBytes(32).toString('base64url');
//   }
// }
