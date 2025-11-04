import { z } from 'zod';
import { JSONWebKeySet, jsonWebKeySetSchema, JWK, jwkSchema } from '../auth';
import { RawZodShape } from '../common.types';

export type RemoteAuthOptions = {
  type: 'remote';

  /**
   * unique id for the provider
   */
  id?: string;
  /**
   * human-readable name for the provider
   */
  name: string;
  /**
   * base url of the provider
   * if the provider does not support dcr it will be used with local auth provider proxy
   * to register client dynamically you have to provide client id for the registration flow
   * @example https://my-company.frontegg.com
   */
  baseUrl: string;

  /**
   * enable dynamic client registration (DCR) flow, if your provider does not support DCR
   * you can set this to false and provide clientId for authorization flow, we will use local auth provider proxy
   * to register a dynamic client with the provided clientId or by called clientId function with client info
   * by default, the provider will use the registration endpoint to register the client dynamically
   */
  dcrEnabled?: boolean;

  /**
   * Only used if your auth provider does not support DCR.
   * for Dcr auth provider the client id acquired by the registration flow
   */
  clientId?: string | ((clientInfo: { clientId: string }) => string);

  /**
   * Set default gateway oauth server mode, this will be overridden by discovery flow.
   * if set to transparent and the discovery flow detect orchestrated mode it will switch to orchestrated mode
   * @default 'transparent'
   */
  mode?: 'orchestrated' | 'transparent';

  /**
   * allow anonymous access to the provider
   * @default false - allowing anonymous access will make the provider to issue an orchestrated token
   */
  allowAnonymous?: boolean;

  /**
   * allow consent mode to select tools/resource/prompts after authorization
   * for scoped based access token
   * @default false - allowing anonymous access will make the provider to issue an orchestrated token
   */
  consent?: boolean;


  /**
   * scopes for the token endpoint
   * @default undefined - all scopes supported by th provider
   */
  scopes?: string[];
  /**
   * authorization provider supported grant types, currently only authorization_code and refresh_token are supported
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  grantTypes?: ('authorization_code' | 'refresh_token')[];

  /**
   * authorization endpoint for the provider
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  authEndpoint?: string;
  /**
   * token endpoint for the provider
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  tokenEndpoint?: string;
  /**
   * registration endpoint for the provider (DCR)
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  registrationEndpoint?: string;
  /**
   * user info endpoint for the provider
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  userInfoEndpoint?: string;

  /**
   * Inline JWKS for the provider to verify tokens without automatic fetching
   * @default undefined - default is what presented in the /.well-known/jwks.json
   */
  jwks?: JSONWebKeySet;

  /**
   * jwks uri for the provider
   * @default undefined - default is what presented in the /.well-known/oauth-authorization-server
   */
  jwksUri?: string;
};

export const remoteAuthOptionsSchema = z.object({
  type: z.literal('remote'),
  id: z.string().optional(),
  name: z.string(),
  baseUrl: z.string(),
  dcrEnabled: z.boolean().optional(),
  clientId: z
    .union([
      z.string(),
      z.function().args(z.object({ clientId: z.string() })).returns(z.string())])
    .optional(),
  mode: z.union([z.literal('orchestrated'), z.literal('transparent')]).optional(),
  allowAnonymous: z.boolean().optional(),
  consent: z.boolean().optional(),
  jwks: jsonWebKeySetSchema.optional(),
  scopes: z.array(z.string()).optional(),
  grantTypes: z.array(z.union([z.literal('authorization_code'), z.literal('refresh_token')])).optional(),
  authEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  registrationEndpoint: z.string().optional(),
  userInfoEndpoint: z.string().optional(),
  jwksUri: z.string().optional(),
} satisfies RawZodShape<RemoteAuthOptions>);

export type LocalAuthOptions = {
  type: 'local';

  /**
   * unique id for the provider
   */
  id: string;

  /**
   * human-readable name for the provider
   */
  name: string;

  /**
   * scopes for the token endpoint
   * @default undefined - all scopes supported by th provider
   */
  scopes?: string[];
  /**
   * currently only authorization_code and refresh_token are supported
   * @default ['authorization_code', 'refresh_token']
   */
  grantTypes?: ('authorization_code' | 'refresh_token')[];

  /**
   * allow anonymous access to the provider
   * in this case the provider will act as an authorization server
   * @default true
   */
  allowAnonymous?: boolean;

  /**
   * allow consent mode to select tools/resource/prompts after authorization
   * for scoped based access token
   * @default false - allowing anonymous access will make the provider to issue an orchestrated token
   */
  consent?: boolean;

  /**
   * Inline JWKS for the provider to verify tokens for local provider
   * it will also used in /.well-known/jwks.json
   * @default undefined - default is auto generated keys and saved in the temp folder
   */
  jwks?: JSONWebKeySet;

  /**
   * private key signing tokens for local provider
   * @default undefined - default is auto generated keys and saved in the temp folder
   */
  signKey?: JWK | Uint8Array;

};


export const localAuthOptionsSchema = z.object({
  type: z.literal('local'),
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).optional(),
  grantTypes: z.array(z.union([z.literal('authorization_code'), z.literal('refresh_token')])).optional(),
  allowAnonymous: z.boolean().optional(),
  consent: z.boolean().optional(),
  jwks: jsonWebKeySetSchema.optional(),
  signKey: jwkSchema.or(z.instanceof(Uint8Array)).optional(),
} satisfies RawZodShape<LocalAuthOptions>);


export const authOptionsSchema = z.discriminatedUnion('type', [
  remoteAuthOptionsSchema,
  localAuthOptionsSchema,
]);

export type AuthOptions = RemoteAuthOptions | LocalAuthOptions;


type StandaloneOption = {
  /**
   * if the provider is standalone or not, if standalone it will register an oauth service provider
   * on app's entry path, if not standalone it will be registered as a child provider
   * under the root provider
   * @default false
   */
  standalone?: boolean;

  /**
   * if the provider should be excluded from the parent provider's discovery
   * this used for standalone providers
   * @default false
   */
  excludeFromParent?: boolean;
};

const standaloneOptionSchema = {
  standalone: z.boolean().optional(),
  excludeFromParent: z.boolean().optional(),
} satisfies RawZodShape<StandaloneOption>;

export const appAuthOptionsSchema = z.discriminatedUnion('type', [
  remoteAuthOptionsSchema.extend(standaloneOptionSchema),
  localAuthOptionsSchema.extend(standaloneOptionSchema),
]);


export type AppAuthOptions = (RemoteAuthOptions | LocalAuthOptions) & StandaloneOption;