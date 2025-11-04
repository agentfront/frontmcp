// // auth/drc/flows/dcr.register.types.ts
//
// import { z } from 'zod';
// import { defaultFlowPlan, RunPlan, StagesFromPlan } from '../../../../invoker';
//
// // Common: allow https or http only for localhost
// const httpsOrLocalhostUrl = z.string().refine((u) => {
//   try {
//     const url = new URL(u);
//     if (url.protocol === 'https:') return true;
//     if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
//     return false;
//   } catch {
//     return false;
//   }
// }, 'redirect_uris must be https, except http://localhost is allowed');
//
// const TokenEndpointAuthMethod = z.enum(['client_secret_basic', 'client_secret_post', 'private_key_jwt']);
//
// export const DcrRegisterInputSchema = z.object({
//   initialAccessToken: z.string().optional(),
//   body: z.object({
//     client_name: z.string().min(1),
//     redirect_uris: z.array(httpsOrLocalhostUrl).min(1),
//     grant_types: z.array(z.enum(['authorization_code','refresh_token','client_credentials','urn:ietf:params:oauth:grant-type:device_code']))
//       .default(['authorization_code','refresh_token'])
//       .optional(),
//     response_types: z.array(z.enum(['code','token','id_token','code token','code id_token','id_token token','code id_token token']))
//       .default(['code'])
//       .optional(),
//     token_endpoint_auth_method: TokenEndpointAuthMethod.default('client_secret_basic').optional(),
//
//     // Optional metadata commonly used by OIDC
//     scope: z.string().optional(),
//     client_uri: z.string().url().optional(),
//     logo_uri: z.string().url().optional(),
//     policy_uri: z.string().url().optional(),
//     tos_uri: z.string().url().optional(),
//     contacts: z.array(z.string()).optional(),
//
//     // Key material
//     jwks_uri: z.string().url().optional(),
//     jwks: z.any().optional(),
//
//     // Optional dynamic client registration fields
//     software_statement: z.string().min(1).optional(),
//   }).superRefine((body, ctx) => {
//     // private_key_jwt requires jwks or jwks_uri
//     if (body.token_endpoint_auth_method === 'private_key_jwt' && !body.jwks && !body.jwks_uri) {
//       ctx.addIssue({
//         code: z.ZodIssueCode.custom,
//         path: ['jwks'],
//         message: 'jwks or jwks_uri is required when token_endpoint_auth_method is private_key_jwt',
//       });
//     }
//     // response_types compatibility with grant_types
//     const gt = new Set(body.grant_types ?? ['authorization_code','refresh_token']);
//     const rt = new Set(body.response_types ?? ['code']);
//     if (rt.has('code') && !gt.has('authorization_code')) {
//       ctx.addIssue({
//         code: z.ZodIssueCode.custom,
//         path: ['response_types'],
//         message: 'response_types includes "code" but grant_types does not include "authorization_code"',
//       });
//     }
//   }),
// });
// export type DcrRegisterInput = z.infer<typeof DcrRegisterInputSchema>;
//
// // Make result schema accept echoed metadata (.passthrough())
// // Make registration_client_uri optional
// // Allow client_secret_expires_at === 0 (non-negative)
// export const DcrRegisterResultSchema = z.object({
//   client_id: z.string().min(1),
//   client_secret: z.string().optional(),
//   client_id_issued_at: z.number().int().nonnegative(),
//   client_secret_expires_at: z.number().int().nonnegative().optional(),
//   registration_client_uri: z.string().url().optional(),
//   registration_access_token: z.string().min(1).optional(),
// }).passthrough();
// export type DcrRegisterResult = z.infer<typeof DcrRegisterResultSchema>;
//
//
// export const dcrRegisterPlan = {
//   name:'dcr.register',
//   ...defaultFlowPlan,
//   execute: ['checkRegistrar', 'checkDcrPolicy', 'generateClientSecretId', 'persistClient', 'buildOutput'],
// } as const satisfies RunPlan<string>;
//
// export type DcrRegisterStage = StagesFromPlan<typeof dcrRegisterPlan>;
