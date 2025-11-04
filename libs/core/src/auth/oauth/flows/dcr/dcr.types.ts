/* ---------------------------------- */
/* Branded primitives                  */
/* ---------------------------------- */
export type URLString = string;

/* ---------------------------------- */
/* OAuth/OIDC enums & unions           */
/* ---------------------------------- */
export type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt';

export type GrantType =
  | 'authorization_code'
  | 'refresh_token'
  | 'client_credentials'
  | 'urn:ietf:params:oauth:grant-type:device_code';

export type ResponseType =
  | 'code'
  | 'token'
  | 'id_token'
  // Combined response types (OIDC hybrid / legacy combos if you choose to allow them)
  | 'code token'
  | 'code id_token'
  | 'id_token token'
  | 'code id_token token';

/* ---------------------------------- */
/* JWK / JWKS minimal representations  */
/* ---------------------------------- */
export type JWKUse = 'sig' | 'enc';
export type JWKKeyOps =
  | 'sign'
  | 'verify'
  | 'encrypt'
  | 'decrypt'
  | 'wrapKey'
  | 'unwrapKey'
  | 'deriveKey'
  | 'deriveBits';

// Minimal subset; you can expand as needed
export interface JWK {
  kty: string;
  use?: JWKUse;
  key_ops?: JWKKeyOps[];
  alg?: string;
  kid?: string;
  // RSA
  n?: string;
  e?: string;
  d?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
  // EC / OKP
  crv?: string;
  x?: string;
  y?: string;
  // Symmetric
  k?: string;
  // Any additional props from your IdP/keys service
  [prop: string]: unknown;
}

export interface JWKS {
  keys: JWK[];
}

/* ---------------------------------- */
/* Registrar & tokens                  */
/* ---------------------------------- */
export interface RegistrarIdentity {
  org_id: string;
  user_id: string;
  env?: string;
  scopes?: string[]; // e.g., ['dcr:register']
}

export interface RegistrationAccessTokenClaims {
  client_id: string;
  scope: string[]; // e.g., ['dcr:manage']
  // add iss, aud, exp, iat, jti if you mint JWTs
  [k: string]: unknown;
}

/* ---------------------------------- */
/* Client metadata (RFC 7591/7592-ish) */
/* ---------------------------------- */
export interface DcrClientMetadata {
  // Required in your flow/policy
  client_name: string;
  redirect_uris: URLString[];

  // Common OAuth/OIDC metadata
  grant_types?: GrantType[];
  response_types?: ResponseType[];
  token_endpoint_auth_method?: TokenEndpointAuthMethod;

  // OIDC niceties
  scope?: string; // space-delimited
  client_uri?: URLString;
  logo_uri?: URLString;
  policy_uri?: URLString;
  tos_uri?: URLString;
  contacts?: string[];

  // Key material for private_key_jwt, etc.
  jwks_uri?: URLString;
  jwks?: JWKS | Record<string, unknown>;

  // Optional SSA (software statement assertion)
  software_statement?: string;

  // Room for provider-specific extensions
  [extension: string]: unknown;
}

/* ---------------------------------- */
/* Policy options consumed by utils    */
/* ---------------------------------- */
export interface DcrPolicyOptions {
  // Redirect URI limits/guards
  maxRedirects: number;
  httpsOnlyRedirects: boolean; // disallow http except where you explicitly allow
  allowLocalhost: boolean; // allow http(s)://localhost/127.0.0.1

  allowedAuthMethods: TokenEndpointAuthMethod[];

  // You can add more here as your policy grows, e.g.:
  // allowedResponseTypes?: ResponseType[];
  // allowedGrantTypes?: GrantType[];
  // defaultScopes?: string[];
}
