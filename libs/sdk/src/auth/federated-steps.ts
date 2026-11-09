import {
  buildFederatedStepPage,
  builtInAuthPageHeaders,
  type AuthOptions,
  type DetectedAuthProvider,
  type PendingAuthorizationRecord,
} from '@frontmcp/auth';
import { base64urlEncode, randomBytes } from '@frontmcp/utils';

import { httpRespond, isOrchestratedMode, type ScopeEntry } from '../common';
import { oauthBasePath } from '../flows/flow.http-path';
import {
  authUiExtraPath,
  buildAuthUiPage,
  buildFederatedState,
  type AuthProvider,
  type FederatedStep,
} from './auth-ui';
import type { LocalPrimaryAuth } from './instances/instance.local-primary-auth';
import { requiredProviderIds } from './required-providers.utils';

/** The wire field a step page posts the index of the step it answers in. */
export const FEDERATED_STEP_FIELD = 'federated_step';

/** What a step page asks the server to do with its step. */
export type FederatedStepAction = 'continue' | 'skip' | 'back';

/** What answering a step leads to: a step page to show, a refusal, or the finished selection. */
export type FederatedStepOutcome =
  | { kind: 'show'; error?: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'done'; selectedProviderIds: string[] };

/** Whether the provider picker shows one provider per page (`incrementalAuth.showAllAppsAtOnce: false`). */
export function showsProvidersStepByStep(authOptions: AuthOptions | undefined): boolean {
  return !!authOptions && isOrchestratedMode(authOptions) && authOptions.incrementalAuth?.showAllAppsAtOnce === false;
}

/**
 * Top-level `auth.providers` declared for local-mode multi-provider
 * orchestration. Only `local` mode carries `providers`; everything else
 * returns an empty list so the app-level federation path is unchanged.
 */
export function getConfiguredProviders(auth: unknown): Array<{ id: string; scopes?: string[] }> {
  const providers = (auth as { providers?: unknown } | undefined)?.providers;
  if (!Array.isArray(providers)) {
    return [];
  }
  return providers.filter(
    (p): p is { id: string; scopes?: string[] } => !!p && typeof (p as { id?: unknown }).id === 'string',
  );
}

/**
 * The providers the picker offers, in its order: the top-level `auth.providers`, else the server's own sign-in
 * (`__parent__`), then the provider of every app with its own `auth`.
 */
export function pickerProviders(scope: ScopeEntry): DetectedAuthProvider[] {
  const authOptions = scope.metadata.auth;
  const providers: DetectedAuthProvider[] = [];
  const configuredProviders = getConfiguredProviders(authOptions);
  for (const p of configuredProviders) {
    providers.push({ id: p.id, mode: 'local', appIds: [p.id], scopes: p.scopes ?? [], isParentProvider: false });
  }
  if (configuredProviders.length === 0 && authOptions && isOrchestratedMode(authOptions)) {
    providers.push({
      id: '__parent__',
      mode: authOptions.mode,
      appIds: ['__parent__'],
      scopes: [],
      isParentProvider: true,
    });
  }
  for (const app of scope.apps.getApps()) {
    const appAuth = app.metadata.auth;
    if (!appAuth) continue;
    const appId = app.metadata.id || app.metadata.name;
    if (providers.some((p) => p.id === appId)) continue;
    providers.push({
      id: appId,
      providerUrl: appAuth.mode === 'transparent' ? appAuth.provider : undefined,
      mode: appAuth.mode,
      appIds: [appId],
      scopes: [],
      isParentProvider: false,
    });
  }
  return providers;
}

/** A picker provider as a custom `@AuthUi` page sees it. */
export function toAuthProvider(provider: DetectedAuthProvider): AuthProvider {
  return {
    id: provider.id,
    name: provider.id,
    url: provider.providerUrl,
    mode: provider.mode,
    appIds: provider.appIds.filter((id) => id !== '__parent__'),
    primary: provider.isParentProvider,
  };
}

/**
 * Put a new pending authorization on the first step of the step-by-step picker, with the CSRF token every step
 * submission must echo (minted through the `@AuthUi` registry when there is one, so its extras endpoint agrees).
 */
export function startFederatedSteps(record: PendingAuthorizationRecord, scope: ScopeEntry): void {
  if (!record.federatedLogin) return;
  record.federatedLogin.currentStep = 0;
  record.federatedLogin.selectedProviderIds = [];
  record.federatedLogin.skippedProviderIds = [];
  record.authUiCsrf ??= scope.authUi?.mintCsrf(record.id) ?? base64urlEncode(randomBytes(32));
}

/**
 * Answer the step a page submitted, on the pending authorization: `continue` links the step's provider, `skip`
 * leaves it for later, `back` returns to the previous step. A skip is refused for a provider the sign-in must
 * link (`federatedAuth.requiredProviders`, or every app's provider under `incrementalAuth.allowSkip: false`), and
 * when too few providers could still be linked to reach `federatedAuth.minProviders`. A submission for another
 * step than the current one changes nothing and shows the current step again.
 */
export function answerFederatedStep(
  record: PendingAuthorizationRecord,
  answer: { step?: string; action?: string },
  rules: { requiredProviderIds: readonly string[]; minProviders: number },
): FederatedStepOutcome {
  const federatedLogin = record.federatedLogin;
  const current = federatedLogin?.currentStep;
  if (!federatedLogin || current === undefined) return { kind: 'refuse', message: 'Invalid provider selection' };
  if (answer.step !== String(current)) return { kind: 'show' };

  const action = answer.action;
  if (action !== 'continue' && action !== 'skip' && action !== 'back') {
    return { kind: 'refuse', message: 'Invalid step action' };
  }
  if (action === 'back') {
    federatedLogin.currentStep = Math.max(0, current - 1);
    return { kind: 'show' };
  }

  const { providerIds } = federatedLogin;
  const providerId = providerIds[current];
  const linked = (federatedLogin.selectedProviderIds ?? []).filter((id) => id !== providerId);
  const skipped = (federatedLogin.skippedProviderIds ?? []).filter((id) => id !== providerId);
  if (action === 'skip') {
    if (rules.requiredProviderIds.includes(providerId)) {
      return { kind: 'refuse', message: `Required provider(s) not linked: ${providerId}` };
    }
    const stillLinkable = providerIds.length - current - 1;
    if (linked.length + stillLinkable < rules.minProviders) {
      const plural = rules.minProviders === 1 ? '' : 's';
      return { kind: 'refuse', message: `At least ${rules.minProviders} provider${plural} must be linked` };
    }
  }
  federatedLogin.selectedProviderIds = action === 'continue' ? [...linked, providerId] : linked;
  federatedLogin.skippedProviderIds = action === 'skip' ? [...skipped, providerId] : skipped;

  if (current < providerIds.length - 1) {
    federatedLogin.currentStep = current + 1;
    return { kind: 'show' };
  }
  const selected = federatedLogin.selectedProviderIds;
  return { kind: 'done', selectedProviderIds: providerIds.filter((id) => selected.includes(id)) };
}

/**
 * The page of the step the pending authorization is on: the custom `@AuthUi({ slot: 'federated' })` page with
 * `extras.step` when one is registered, else the built-in step page.
 */
export function renderFederatedStep(
  scope: ScopeEntry,
  record: PendingAuthorizationRecord,
  options: { clientName: string; error?: string },
): ReturnType<typeof httpRespond.html> {
  const federatedLogin = record.federatedLogin;
  const providerIds = federatedLogin?.providerIds ?? [];
  const index = federatedLogin?.currentStep ?? 0;
  const providerId = providerIds[index] ?? '';
  const providers = pickerProviders(scope);
  const provider = providers.find((p) => p.id === providerId);
  const required = requiredProviderIds(scope.auth?.options, scope.apps.getApps());
  const decision = federatedLogin?.selectedProviderIds?.includes(providerId)
    ? 'continue'
    : federatedLogin?.skippedProviderIds?.includes(providerId)
      ? 'skip'
      : undefined;
  const step: FederatedStep = {
    index,
    count: providerIds.length,
    providerId,
    last: index === providerIds.length - 1,
    canGoBack: index > 0,
    canSkip: !required.includes(providerId),
    ...(decision ? { decision } : {}),
  };
  const csrfToken = record.authUiCsrf ?? '';
  const submitUrl = `${oauthBasePath(scope)}/oauth/callback`;

  const authUi = scope.authUi;
  if (authUi?.hasSlot('federated')) {
    const state = buildFederatedState(
      {
        pendingAuthId: record.id,
        submitUrl,
        extraUrl: authUiExtraPath(scope.fullPath),
        csrfToken,
        addedItems: authUi.getAddedItems(record.id),
      },
      {
        clientId: record.clientId,
        clientName: options.clientName,
        redirectUri: record.redirectUri,
        providers: providers.map(toAuthProvider),
        step,
      },
    );
    const page = buildAuthUiPage({
      registry: authUi,
      slot: 'federated',
      state,
      fullPath: scope.fullPath,
      formTargets: [record.redirectUri, ...providerAuthorizationEndpoints(scope, providerIds)],
    });
    if (page) return httpRespond.html(page.html, 200, page.headers);
  }

  const markup = buildFederatedStepPage({
    provider: {
      providerId,
      providerName: providerId,
      providerUrl: provider?.providerUrl,
      mode: provider?.mode ?? 'unknown',
      appIds: (provider?.appIds ?? []).filter((id) => id !== '__parent__'),
      isPrimary: provider?.isParentProvider,
      required: !step.canSkip,
    },
    step,
    clientName: options.clientName,
    pendingAuthId: record.id,
    callbackPath: submitUrl,
    csrfToken,
    error: options.error,
  });
  return httpRespond.html(markup, 200, builtInAuthPageHeaders());
}

/** The authorization endpoints of the upstream providers among `providerIds` (others have none). */
export function providerAuthorizationEndpoints(scope: ScopeEntry, providerIds: Iterable<string>): string[] {
  const localAuth = scope.auth as Partial<LocalPrimaryAuth> | undefined;
  if (typeof localAuth?.getProviderConfig !== 'function') return [];
  const endpoints: string[] = [];
  for (const id of providerIds) {
    const endpoint = localAuth.getProviderConfig(id)?.authorizationEndpoint;
    if (endpoint) endpoints.push(endpoint);
  }
  return endpoints;
}
