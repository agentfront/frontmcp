// // auth/session/flows/session.create.flow.ts
// import 'reflect-metadata';
// import { z } from 'zod';
// import {
//   InvokePlan,
//   FlowAsCtx,
//   HooksOf,
//   defaultFlowPlan,
//   StagesFromPlan,
//   RunPlan,
//   RunOptions,
//   CreateOptions,
// } from '../../../invoker';
// import { SessionService } from '../session.service';
// import { SessionSchema } from '../session.schema';
// import { PartialStagesType, userClaimSchema } from '@frontmcp/sdk';
// import { AuthScope } from '../../auth.scope';
//
// export const SessionCreateInputSchema = z.object({
//   token: z.string().min(1),
//   sessionId: z.string().optional(),
//   claims: z.record(z.any()),
//   user: userClaimSchema,
// });
// export type SessionCreateInput = z.infer<typeof SessionCreateInputSchema>;
//
// // ===== Output =====
// const SessionCreateOkSchema = z.object({
//   status: z.literal(200),
//   session: SessionSchema,
// });
// export const SessionCreateResultSchema = SessionCreateOkSchema;
// export type SessionCreateResult = z.infer<typeof SessionCreateResultSchema>;
//
// // ===== Options =====
// export type SessionCreateFlowOptions = { args: SessionCreateInput };
//
// // ===== Plan =====
// export const sessionCreatePlan = {
//   name: 'session.create',
//   ...defaultFlowPlan,
//   execute: [
//     'collectApps',
//     'collectTools',
//     'collectResources',
//     'collectPrompts',
//     'computeProviders',
//     'computeScopes',
//     'createSession',
//   ],
// } as const satisfies RunPlan<string>;
// export type SessionCreateStage = StagesFromPlan<typeof sessionCreatePlan>;
// const { Stage } = HooksOf<SessionCreateStage>();
//
// type CreateState = {
//   appIds: string[];
//   authorizedApps: Record<string, { id: string; toolIds: string[] }>;
//   authorizedAppIds: string[];
//   authorizedResources: string[];
//   authorizedTools: Record<string, { executionPath: [string, string]; details?: Record<string, any> }>;
//   authorizedToolIds: string[];
//   authorizedPrompts: Record<string, { executionPath: [string, string]; details?: Record<string, any> }>;
//   authorizedPromptIds: string[];
//   authorizedProviders?: Record<string, any>;
//   authorizedProviderIds?: string[];
//   scopes?: string[];
// };
//
// declare global {
//   export interface AuthorizedRouteFlows {
//     'session.create': PartialStagesType<SessionCreateStage>;
//   }
// }
// @InvokePlan(sessionCreatePlan)
// export default class SessionCreateFlow extends FlowAsCtx<
//   SessionCreateFlowOptions,
//   SessionCreateInput,
//   SessionCreateResult
// > {
//   static create(options: CreateOptions) {
//     return super.createInvoker.bind(this)(sessionCreatePlan.name, options) as RunOptions<
//       SessionCreateFlowOptions,
//       SessionCreateResult
//     >;
//   }
//
//   constructor(options: SessionCreateFlowOptions) {
//     super({ rawInput: options });
//   }
//
//   public state: CreateState = {
//     appIds: [],
//     authorizedApps: {},
//     authorizedAppIds: [],
//     authorizedResources: [],
//     authorizedTools: {},
//     authorizedToolIds: [],
//     authorizedPrompts: {},
//     authorizedPromptIds: [],
//   };
//
//   // ---------------- defaultFlowPlan: parseInput / validateInput / validateOutput ---------
//
//   @Stage('parseInput')
//   async parseInput() {
//     const { args } = this.rawInput ?? ({} as SessionCreateFlowOptions);
//     this.inputDraft = args as any;
//   }
//
//   @Stage('validateInput')
//   async validateInput() {
//     this.input = SessionCreateInputSchema.parse(this.inputDraft);
//   }
//
//   @Stage('collectApps')
//   async collectApps() {
//     const scope = this.get(AuthScope);
//     const appIds = scope.apps.map((a) => a.id);
//     this.state.appIds = appIds;
//     this.state.authorizedAppIds = appIds;
//   }
//
//   @Stage('collectTools')
//   async collectTools() {
//     const scope = this.get(AuthScope);
//     const toolsMap: CreateState['authorizedTools'] = {};
//     const toolIds: string[] = [];
//     const appsRec: CreateState['authorizedApps'] = {};
//
//     for (const app of scope.apps) {
//       const list = app.tools.listGlobal();
//       const idsForApp: string[] = [];
//       for (const t of list) {
//         const id = `${app.id}:${String((t as any).name)}`;
//         idsForApp.push(String((t as any).name));
//         toolIds.push(id);
//         toolsMap[id] = {
//           executionPath: [app.id, String((t as any).name)],
//           details: {
//             name: String((t as any).name),
//             description: String((t as any).description ?? ''),
//             kind: String((t as any).kind ?? ''),
//             provider: (t as any).provider ? String((t as any).provider) : undefined,
//           },
//         };
//       }
//       appsRec[app.id] = { id: app.id, toolIds: idsForApp };
//     }
//
//     this.state.authorizedTools = toolsMap;
//     this.state.authorizedToolIds = toolIds;
//     this.state.authorizedApps = appsRec;
//   }
//
//   @Stage('collectResources')
//   async collectResources() {
//     const scope = this.get(AuthScope);
//     const resIds: string[] = [];
//     // for (const app of scope.apps) {
//     //   try {
//     //     const rs = app.resources.list();
//     //     for (const r of rs) resIds.push(String((r as any).id ?? ''));
//     //   } catch {
//     //     /* ignore */
//     //   }
//     // }
//     this.state.authorizedResources = resIds;
//   }
//
//   @Stage('collectPrompts')
//   async collectPrompts() {
//     const scope = this.get(AuthScope);
//     const promptsMap: CreateState['authorizedPrompts'] = {};
//     const promptIds: string[] = [];
//     // for (const app of scope.apps) {
//     //   try {
//     //     const ps = app.prompts.list();
//     //     for (const p of ps) {
//     //       const id = `${app.id}:${String((p as any).id ?? '')}`;
//     //       promptIds.push(id);
//     //       promptsMap[id] = {
//     //         executionPath: [app.id, String((p as any).id ?? '')],
//     //         details: { ...(p as any) },
//     //       };
//     //     }
//     //   } catch {
//     //     /* ignore */
//     //   }
//     // }
//     this.state.authorizedPrompts = promptsMap;
//     this.state.authorizedPromptIds = promptIds;
//   }
//
//   @Stage('computeProviders')
//   async computeProviders() {
//     const scope = this.get(AuthScope);
//     if (scope.orchestrated) return; // provider snapshots handled by orchestrated sessions
//     const primary = scope.getRemoteAuthorizeServers().primary;
//     const expClaim =
//       this.input.claims && typeof (this.input.claims as any)['exp'] === 'number'
//         ? Number((this.input.claims as any)['exp'])
//         : undefined;
//
//     const providerSnapshot = {
//       id: primary.id,
//       exp: expClaim,
//       payload: this.input.claims ?? {},
//       apps: this.state.appIds.map((id) => ({ id, toolIds: this.state.authorizedApps[id]?.toolIds ?? [] })),
//       embedMode: 'plain' as const,
//     };
//     this.state.authorizedProviders = { [primary.id]: providerSnapshot } as any;
//     this.state.authorizedProviderIds = [primary.id];
//   }
//
//   @Stage('computeScopes')
//   async computeScopes() {
//     const c = this.input.claims ?? {};
//     const raw = (c['scope'] ?? c['scp']) as unknown;
//     const scopes: string[] = Array.isArray(raw)
//       ? raw.map(String)
//       : typeof raw === 'string'
//       ? raw.split(/[\s,]+/).filter(Boolean)
//       : [];
//     this.state.scopes = scopes;
//   }
//
//   @Stage('createSession')
//   async createSession() {
//     const scope = this.get(AuthScope);
//     const sessionService = this.get(SessionService);
//
//     const session = await sessionService.createSession(scope, {
//       token: this.input.token,
//       user: this.input.user,
//       claims: this.input.claims,
//       sessionId: this.input.sessionId,
//       authorizedApps: this.state.authorizedApps,
//       authorizedAppIds: this.state.authorizedAppIds,
//       authorizedResources: this.state.authorizedResources,
//       authorizedProviders: this.state.authorizedProviders,
//       authorizedProviderIds: this.state.authorizedProviderIds,
//       scopes: this.state.scopes,
//       authorizedTools: this.state.authorizedTools,
//       authorizedToolIds: this.state.authorizedToolIds,
//       authorizedPrompts: this.state.authorizedPrompts,
//       authorizedPromptIds: this.state.authorizedPromptIds,
//     } as any);
//
//     this.outputDraft = { status: 200, session };
//   }
//
//   @Stage('validateOutput')
//   async validateOutput() {
//     this.output = SessionCreateResultSchema.parse(this.outputDraft);
//   }
// }
