/**
 * Template Builders for OAuth UI
 *
 * Server-side HTML rendering with Tailwind CSS for OAuth authorization flows.
 * No build step required - pure runtime rendering with Tailwind CSS CDN.
 *
 * Features:
 * - OAuth consent page with multiple apps
 * - Incremental authorization page for single app
 * - Federated login page for multi-provider selection
 * - All pages use Tailwind CSS from CDN (no build required)
 * - Google Fonts (Inter) for modern typography
 *
 * Uses base-layout.ts for consistent HTML shell with CDN resources.
 */

import { escapeHtml as baseEscapeHtml, centeredCardLayout, extraWideLayout, wideLayout } from './base-layout';

// ============================================
// Types
// ============================================

/**
 * App information for authorization cards
 */
export interface AppAuthCard {
  /** App identifier */
  appId: string;
  /** Display name */
  appName: string;
  /** App description */
  description?: string;
  /** Icon URL (optional, will use initials fallback) */
  iconUrl?: string;
  /** Scopes required by this app */
  requiredScopes?: string[];
}

/**
 * Provider information for federated login
 */
export interface ProviderCard {
  /** Provider identifier */
  providerId: string;
  /** Display name */
  providerName: string;
  /** Provider URL (for remote providers) */
  providerUrl?: string;
  /** Auth mode */
  mode: string;
  /** App IDs associated with this provider */
  appIds: string[];
  /** Whether this is the parent/primary provider */
  isPrimary?: boolean;
}

/**
 * Tool information for consent page
 */
export interface ToolCard {
  /** Tool identifier */
  toolId: string;
  /** Display name */
  toolName: string;
  /** Tool description */
  description?: string;
  /** Parent app ID */
  appId: string;
  /** Parent app name */
  appName: string;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Escape HTML special characters
 * Re-exported from base-layout for convenience
 */
export const escapeHtml = baseEscapeHtml;

// ============================================
// Template Builders
// ============================================

/**
 * Build OAuth consent page with Tailwind
 * Shows all apps at once with Authorize/Skip buttons
 */
export function buildConsentPage(params: {
  apps: AppAuthCard[];
  clientName: string;
  pendingAuthId: string;
  csrfToken: string;
  callbackPath: string;
}): string {
  const { apps, clientName, pendingAuthId, csrfToken, callbackPath } = params;

  const appCards = apps.map((app) => buildAppCardHtml(app, pendingAuthId, csrfToken, callbackPath)).join('\n');

  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-4">Authorize ${escapeHtml(clientName)}</h1>
    <p class="text-gray-600 mb-8">
      Select which apps you want to authorize. You can skip apps and authorize them later when needed.
    </p>

    <div class="space-y-4" id="app-list">
      ${appCards}
    </div>

    <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
      Skipped apps can be authorized later when you try to use their tools (progressive authorization).
    </div>`;

  return wideLayout(content, { title: `Authorize ${clientName}` });
}

/**
 * Build single app authorization card HTML
 */
function buildAppCardHtml(app: AppAuthCard, pendingAuthId: string, csrfToken: string, callbackPath: string): string {
  const icon = app.iconUrl
    ? `<img src="${escapeHtml(app.iconUrl)}" alt="${escapeHtml(
        app.appName,
      )}" class="w-12 h-12 rounded-lg object-cover">`
    : `<div class="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">${escapeHtml(
        app.appName.charAt(0).toUpperCase(),
      )}</div>`;

  const description = app.description ? `<p class="text-sm text-gray-500">${escapeHtml(app.description)}</p>` : '';

  const scopes = app.requiredScopes?.length
    ? `<div class="mb-4">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Permissions</p>
        <div class="flex flex-wrap gap-2">
          ${app.requiredScopes
            .map(
              (scope) =>
                `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">${escapeHtml(
                  scope,
                )}</span>`,
            )
            .join('')}
        </div>
      </div>`
    : '';

  return `<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow" data-app-id="${escapeHtml(
    app.appId,
  )}">
    <div class="flex items-center gap-4 mb-4">
      ${icon}
      <div class="flex-1">
        <h3 class="font-semibold text-gray-900">${escapeHtml(app.appName)}</h3>
        ${description}
      </div>
    </div>

    ${scopes}

    <form method="POST" action="${escapeHtml(callbackPath)}" class="flex gap-3 pt-4 border-t border-gray-100">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">
      <input type="hidden" name="app" value="${escapeHtml(app.appId)}">
      <button type="submit" name="action" value="authorize"
        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
        Authorize
      </button>
      <button type="submit" name="action" value="skip"
        class="px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium rounded-lg transition-colors">
        Skip
      </button>
    </form>
  </div>`;
}

/**
 * Build incremental auth page (single app) with Tailwind
 * Used when a tool requires authorization for a skipped app
 */
export function buildIncrementalAuthPage(params: {
  app: AppAuthCard;
  toolId: string;
  sessionHint: string;
  callbackPath: string;
}): string {
  const { app, toolId, sessionHint, callbackPath } = params;

  const description = app.description ? `<p class="text-gray-500 mt-2">${escapeHtml(app.description)}</p>` : '';

  const content = `
    <!-- Warning icon -->
    <div class="flex justify-center mb-6">
      <div class="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <svg class="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
      </div>
    </div>

    <h1 class="text-2xl font-bold text-gray-900 text-center mb-2">Authorization Required</h1>
    <p class="text-gray-600 text-center mb-8">
      To use "<span class="font-mono text-sm bg-gray-100 px-1 rounded">${escapeHtml(
        toolId,
      )}</span>", you need to authorize ${escapeHtml(app.appName)}.
    </p>

    <!-- App card -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
      <div class="flex items-center gap-4 mb-4">
        <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
          ${escapeHtml(app.appName.charAt(0).toUpperCase())}
        </div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">${escapeHtml(app.appName)}</h3>
          ${description}
        </div>
      </div>

      <form method="GET" action="${escapeHtml(callbackPath)}" class="flex gap-3 pt-4 border-t border-gray-100">
        <input type="hidden" name="pending_auth_id" value="${escapeHtml(sessionHint)}">
        <input type="hidden" name="app_id" value="${escapeHtml(app.appId)}">
        <input type="hidden" name="incremental" value="true">
        <button type="button" onclick="window.close()"
          class="flex-1 px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 font-medium rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit"
          class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
          Authorize
        </button>
      </form>
    </div>

    <div class="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 text-center">
      This is an incremental authorization. Your existing session will be expanded to include ${escapeHtml(
        app.appName,
      )}.
    </div>`;

  return centeredCardLayout(content, { title: `Authorize ${app.appName}` });
}

/**
 * Build federated login page for multi-provider selection
 */
export function buildFederatedLoginPage(params: {
  providers: ProviderCard[];
  clientName: string;
  pendingAuthId: string;
  callbackPath: string;
}): string {
  const { providers, clientName, pendingAuthId, callbackPath } = params;

  const providerCards = providers
    .map((provider) => {
      const isPrimaryBadge = provider.isPrimary
        ? `<span class="px-2 py-0.5 text-xs font-medium bg-blue-600 text-white rounded-full">Primary</span>`
        : '';

      const providerUrl = provider.providerUrl
        ? `<p class="text-xs text-gray-400 font-mono truncate">${escapeHtml(provider.providerUrl)}</p>`
        : '';

      const appIds =
        provider.appIds.length > 0
          ? `<p class="text-xs text-gray-500 mt-1">Apps: ${provider.appIds.map((id) => escapeHtml(id)).join(', ')}</p>`
          : '';

      return `<label class="flex items-start gap-4 p-4 bg-white border-2 border-gray-200 rounded-xl cursor-pointer hover:border-blue-300 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
      <input type="checkbox" name="providers" value="${escapeHtml(provider.providerId)}"
        class="mt-1 w-5 h-5 rounded border-gray-300" ${provider.isPrimary ? 'checked' : ''}>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-semibold text-gray-900">${escapeHtml(provider.providerName)}</span>
          ${isPrimaryBadge}
        </div>
        <p class="text-sm text-gray-500">Mode: ${escapeHtml(provider.mode)}</p>
        ${providerUrl}
        ${appIds}
      </div>
    </label>`;
    })
    .join('\n');

  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-4">Select Authorization Providers</h1>
    <p class="text-gray-600 mb-8">
      ${escapeHtml(clientName)} uses multiple authentication providers. Select which ones you want to authorize.
    </p>

    <form method="GET" action="${escapeHtml(callbackPath)}" id="federated-form">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">
      <input type="hidden" name="federated" value="true">

      <!-- Select all toggle -->
      <label class="flex items-center gap-3 mb-6 cursor-pointer">
        <input type="checkbox" id="select-all" class="w-5 h-5 rounded border-gray-300"
          onchange="document.querySelectorAll('input[name=providers]').forEach(cb => cb.checked = this.checked)">
        <span class="text-gray-700">Select all providers</span>
      </label>

      <!-- Provider cards -->
      <div class="space-y-4 mb-8">
        ${providerCards}
      </div>

      <!-- Email input -->
      <div class="mb-6">
        <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
        <input type="email" id="email" name="email" required placeholder="you@example.com"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
      </div>

      <!-- Buttons -->
      <div class="flex gap-4">
        <button type="button"
          class="flex-1 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium rounded-lg transition-colors"
          onclick="document.querySelectorAll('input[name=providers]').forEach(cb => cb.checked = false); document.getElementById('federated-form').submit();">
          Skip All
        </button>
        <button type="submit"
          class="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Continue
        </button>
      </div>
    </form>

    <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
      Skipped providers can be authorized later when you try to use their tools (progressive authorization).
    </div>`;

  return wideLayout(content, { title: 'Select Providers' });
}

/**
 * A hidden field to round-trip on the consent form (identity / federated
 * context) so the consent POST back to `/oauth/callback` carries everything the
 * mint step needs.
 */
export interface ConsentHiddenField {
  /** Form field name. */
  name: string;
  /** Field value (rendered escaped). */
  value: string;
}

/**
 * Build consent page for tool selection.
 *
 * The form GETs/POSTs back to `callbackPath` (`/oauth/callback`) carrying
 * `pending_auth_id`, the chosen `tools=` checkboxes, and any caller-supplied
 * {@link ConsentHiddenField hidden context} (identity / `federated=true` /
 * `providers=`). Honors the `auth.consent` config flags:
 *
 * - `groupByApp`      — group tools under per-app cards (default) or render a flat list.
 * - `showDescriptions`— show tool descriptions (default) or hide them.
 * - `customMessage`   — replace the default subtitle.
 * - `allowSelectAll`  — render the select-all + per-app toggle controls (default).
 * - `requireSelection`— require ≥1 tool; disables the submit button at 0 selected.
 * - `defaultSelectedTools` — the set of tool ids to pre-check (others unchecked).
 *   When omitted, ALL tools are pre-checked (the historical default).
 *
 * Note: `excludedTools` are filtered out by the caller and never appear here.
 */
export function buildToolConsentPage(params: {
  tools: ToolCard[];
  clientName: string;
  pendingAuthId: string;
  csrfToken: string;
  callbackPath: string;
  userName?: string;
  userEmail?: string;
  /** Group tools by app (default true). When false, a single flat list is rendered. */
  groupByApp?: boolean;
  /** Show per-tool descriptions (default true). */
  showDescriptions?: boolean;
  /** Replace the default subtitle with a custom message. */
  customMessage?: string;
  /** Render the select-all / toggle-all controls (default true). */
  allowSelectAll?: boolean;
  /** Require at least one tool to be selected (default true). */
  requireSelection?: boolean;
  /**
   * Tool ids to pre-check. When omitted, every tool is pre-checked (historical
   * default). When provided, only listed ids are checked.
   */
  defaultSelectedTools?: string[];
  /** Optional error banner (e.g. re-render after an empty `requireSelection` submit). */
  error?: string;
  /** Hidden fields to round-trip (identity / federated context) back to the callback. */
  hiddenFields?: ConsentHiddenField[];
}): string {
  const {
    tools,
    clientName,
    pendingAuthId,
    csrfToken,
    callbackPath,
    userName,
    userEmail,
    groupByApp = true,
    showDescriptions = true,
    customMessage,
    allowSelectAll = true,
    requireSelection = true,
    defaultSelectedTools,
    error,
    hiddenFields = [],
  } = params;

  // A tool is pre-checked when no explicit default set is supplied (check all),
  // or when its id is in the supplied set.
  const defaultSet = defaultSelectedTools ? new Set(defaultSelectedTools) : undefined;
  const isChecked = (toolId: string): boolean => (defaultSet ? defaultSet.has(toolId) : true);
  const checkedCount = tools.filter((t) => isChecked(t.toolId)).length;

  const renderTool = (tool: ToolCard): string => {
    const desc =
      showDescriptions && tool.description
        ? `<p class="text-sm text-gray-500 mt-0.5">${escapeHtml(tool.description)}</p>`
        : '';
    return `<label class="flex items-start gap-3 p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-50">
        <input type="checkbox" name="tools" value="${escapeHtml(tool.toolId)}" class="mt-0.5 w-5 h-5 rounded border-gray-300"${
          isChecked(tool.toolId) ? ' checked' : ''
        }>
        <div>
          <span class="font-medium text-gray-900">${escapeHtml(tool.toolName)}</span>
          ${desc}
        </div>
      </label>`;
  };

  // Build the tool section — grouped by app (default) or as a flat list.
  let toolSection: string;
  if (groupByApp) {
    const toolsByApp: Record<string, { appName: string; tools: ToolCard[] }> = {};
    for (const tool of tools) {
      if (!toolsByApp[tool.appId]) {
        toolsByApp[tool.appId] = { appName: tool.appName, tools: [] };
      }
      toolsByApp[tool.appId].tools.push(tool);
    }

    const toggleAllButton = allowSelectAll
      ? `<button type="button" class="text-sm text-blue-600 hover:text-blue-800"
          onclick="const container = this.closest('.bg-gray-50').querySelector('[data-app]'); const cbs = container.querySelectorAll('input[name=tools]'); const allChecked = [...cbs].every(cb => cb.checked); cbs.forEach(cb => cb.checked = !allChecked); updateCount();">
          Toggle All
        </button>`
      : '';

    toolSection = Object.entries(toolsByApp)
      .map(([appId, { appName, tools: appTools }]) => {
        const toolItems = appTools.map(renderTool).join('\n');
        return `<div class="bg-gray-50 rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 bg-gray-100">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            ${escapeHtml(appName.charAt(0).toUpperCase())}
          </div>
          <span class="font-semibold text-gray-900">${escapeHtml(appName)}</span>
        </div>
        ${toggleAllButton}
      </div>
      <div class="p-4 space-y-2" data-app="${escapeHtml(appId)}">
        ${toolItems}
      </div>
    </div>`;
      })
      .join('\n');
  } else {
    // Flat list (groupByApp: false): a single container so client scripts that
    // target `[data-app]` still work, but no per-app chrome.
    toolSection = `<div class="bg-gray-50 rounded-xl p-4 space-y-2" data-app="__all__">
      ${tools.map(renderTool).join('\n')}
    </div>`;
  }

  const userInfo =
    userName || userEmail
      ? `<div class="p-3 bg-gray-50 rounded-lg mb-6 text-sm">
        <span class="text-gray-500">Signed in as: </span>
        <span class="font-medium text-gray-900">${escapeHtml(userName || userEmail || '')}</span>
      </div>`
      : '';

  const errorBanner = error
    ? `<div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">${escapeHtml(error)}</div>`
    : '';

  const hiddenInputs = hiddenFields
    .map((f) => `<input type="hidden" name="${escapeHtml(f.name)}" value="${escapeHtml(f.value)}">`)
    .join('\n      ');

  // The select-all toggle is only rendered when allowed.
  const selectAllControl = allowSelectAll
    ? `<label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" id="select-all" class="w-5 h-5 rounded border-gray-300"${
            checkedCount === tools.length && tools.length > 0 ? ' checked' : ''
          }
            onchange="document.querySelectorAll('input[name=tools]').forEach(cb => cb.checked = this.checked); updateCount();">
          <span class="text-gray-700">Select all tools</span>
        </label>`
    : '<span></span>';

  // When selection is required, the submit button disables itself at 0 selected.
  const requireSelectionScript = requireSelection
    ? `
      const submitBtn = document.getElementById('consent-submit');
      if (submitBtn) submitBtn.disabled = checked.length === 0;`
    : '';

  const updateCountScript = `
  <script>
    function updateCount() {
      const all = document.querySelectorAll('input[name="tools"]');
      const checked = document.querySelectorAll('input[name="tools"]:checked');
      const countEl = document.getElementById('selection-count');
      if (countEl) countEl.textContent = checked.length + ' of ' + all.length + ' selected';
      const selectAll = document.getElementById('select-all');
      if (selectAll) selectAll.checked = all.length > 0 && all.length === checked.length;${requireSelectionScript}
    }
    document.querySelectorAll('input[name="tools"]').forEach(cb => cb.addEventListener('change', updateCount));
    updateCount();
  </script>`;

  const subtitle = customMessage
    ? escapeHtml(customMessage)
    : `Choose which tools ${escapeHtml(clientName)} can access. You can change this later.`;

  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-4">Select Tools to Enable</h1>
    <p class="text-gray-600 mb-6">
      ${subtitle}
    </p>

    ${errorBanner}
    ${userInfo}

    <form method="GET" action="${escapeHtml(callbackPath)}" id="consent-form">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">
      <input type="hidden" name="consent_submitted" value="1">
      ${hiddenInputs}

      <!-- Select all toggle -->
      <div class="flex items-center justify-between mb-6">
        ${selectAllControl}
        <span id="selection-count" class="text-sm text-gray-500">${checkedCount} of ${tools.length} selected</span>
      </div>

      <!-- Tool groups -->
      <div class="space-y-6 mb-8">
        ${toolSection}
      </div>

      <!-- Buttons -->
      <div class="flex gap-4">
        <button type="button" onclick="history.back()"
          class="flex-1 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" id="consent-submit"
          class="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          Confirm Selection
        </button>
      </div>
    </form>
    ${updateCountScript}`;

  return extraWideLayout(content, { title: 'Select Tools' });
}

/**
 * A custom login field rendered on the built-in login page (Checkpoint 3a).
 * Mirrors `LoginFieldConfig` from `@frontmcp/auth` options, plus the field `name`.
 */
export interface LoginExtraField {
  /** Field name (form key submitted to the callback). */
  name: string;
  /** HTML input type. `hidden` is submitted but not shown. */
  type: 'text' | 'password' | 'email' | 'select' | 'hidden';
  /** Field label. Defaults to the field name. */
  label?: string;
  /** Whether the field is required. */
  required?: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** Options for a `select` field. */
  options?: Array<{ value: string; label: string }>;
  /** Pre-filled value (e.g. when re-rendering after an error). */
  value?: string;
}

/**
 * Render a single custom login field's HTML.
 */
function buildLoginFieldHtml(field: LoginExtraField): string {
  const id = `field-${field.name}`;
  const safeName = escapeHtml(field.name);
  const requiredAttr = field.required ? ' required' : '';
  const labelText = escapeHtml(field.label ?? field.name);
  const safeValue = field.value !== undefined ? escapeHtml(field.value) : '';

  if (field.type === 'hidden') {
    return `<input type="hidden" name="${safeName}" value="${safeValue}">`;
  }

  const inputClass =
    'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  let control: string;
  if (field.type === 'select') {
    const opts = (field.options ?? [])
      .map(
        (o) =>
          `<option value="${escapeHtml(o.value)}"${o.value === field.value ? ' selected' : ''}>${escapeHtml(
            o.label,
          )}</option>`,
      )
      .join('');
    control = `<select id="${escapeHtml(id)}" name="${safeName}"${requiredAttr} class="${inputClass}">${opts}</select>`;
  } else {
    const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
    control = `<input type="${escapeHtml(field.type)}" id="${escapeHtml(
      id,
    )}" name="${safeName}"${requiredAttr}${placeholder} value="${safeValue}" class="${inputClass}">`;
  }

  return `<div class="mb-4">
          <label for="${escapeHtml(id)}" class="block text-sm font-medium text-gray-700 mb-2">${labelText}</label>
          ${control}
        </div>`;
}

/**
 * Build simple login page.
 *
 * The default email/name form is rendered when no `extraFields` are supplied —
 * byte-for-byte identical to the historical page (the optional params below all
 * default to falsy). When `extraFields` is provided (Checkpoint 3a local-login
 * customization), the built-in email/name fields are REPLACED by the supplied
 * fields and `title`/`subtitle`/`logoUri`/`error` customize the chrome.
 */
export function buildLoginPage(params: {
  clientName: string;
  scope: string;
  pendingAuthId: string;
  callbackPath: string;
  /** Optional page heading override. Defaults to "Sign In". */
  title?: string;
  /** Optional sub-heading. Defaults to "Authorize access to {clientName}". */
  subtitle?: string;
  /** Optional logo image URL shown above the form. */
  logoUri?: string;
  /** Optional error banner shown above the form (re-render after failed authenticate()). */
  error?: string;
  /**
   * Optional custom fields. When provided, these REPLACE the default
   * email/name inputs and are submitted to the callback as form values.
   */
  extraFields?: LoginExtraField[];
}): string {
  const { clientName, scope, pendingAuthId, callbackPath, title, subtitle, logoUri, error, extraFields } = params;

  const scopesHtml = scope
    ? `<div class="p-4 bg-gray-50 rounded-lg mb-6">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Requested permissions</p>
        <p class="text-gray-700">${
          scope
            .split(' ')
            .map((s) => escapeHtml(s))
            .join(', ') || 'Default access'
        }</p>
      </div>`
    : '';

  // Default (unchanged) email + optional name inputs. When custom fields are
  // supplied they replace these entirely.
  const defaultFieldsHtml = `
        <!-- Email -->
        <div class="mb-4">
          <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
          <input type="email" id="email" name="email" required placeholder="you@example.com"
            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>

        <!-- Name (optional) -->
        <div class="mb-6">
          <label for="name" class="block text-sm font-medium text-gray-700 mb-2">Name (optional)</label>
          <input type="text" id="name" name="name" placeholder="Your name"
            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        </div>`;

  const fieldsHtml =
    extraFields && extraFields.length > 0
      ? extraFields.map((f) => buildLoginFieldHtml(f)).join('\n')
      : defaultFieldsHtml;

  const logoHtml = logoUri
    ? `<div class="flex justify-center mb-4"><img src="${escapeHtml(
        logoUri,
      )}" alt="${escapeHtml(clientName)}" class="h-12 w-12 rounded-lg object-cover"></div>`
    : '';

  const errorHtml = error
    ? `<div class="p-3 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">${escapeHtml(error)}</div>`
    : '';

  const headingText = escapeHtml(title ?? 'Sign In');
  const subtitleText = subtitle ? escapeHtml(subtitle) : `Authorize access to ${escapeHtml(clientName)}`;

  const content = `
    <div class="bg-white rounded-2xl shadow-xl p-8">
      ${logoHtml}
      <h1 class="text-3xl font-bold text-gray-900 mb-2 text-center">${headingText}</h1>
      <p class="text-gray-600 mb-8 text-center">${subtitleText}</p>

      ${errorHtml}

      ${scopesHtml}

      <form method="GET" action="${escapeHtml(callbackPath)}">
        <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">
${fieldsHtml}

        <!-- Submit -->
        <button type="submit"
          class="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Authorize
        </button>
      </form>

      <p class="text-center text-sm text-gray-500 mt-6">Client: ${escapeHtml(clientName)}</p>
    </div>`;

  return centeredCardLayout(content, { title: title ?? 'Sign In' });
}

/**
 * Build the mid-session "connect credential" page (Checkpoint 3b).
 *
 * Renders a single-field form (reusing the {@link LoginExtraField} renderer) that
 * POSTs the framework-signed `token` plus the credential field value back to the
 * `/oauth/connect` handler. Mirrors the login page chrome so the experience is
 * consistent with the initial sign-in.
 *
 * @param params.token  The framework-signed resume token (round-tripped as a hidden field).
 * @param params.field  The single credential field to render (e.g. an API key / password input).
 * @param params.action The connect endpoint path the form submits to.
 */
export function buildConnectPage(params: {
  token: string;
  field: LoginExtraField;
  action: string;
  title?: string;
  subtitle?: string;
  logoUri?: string;
  error?: string;
}): string {
  const { token, field, action, title, subtitle, logoUri, error } = params;

  const logoHtml = logoUri
    ? `<div class="flex justify-center mb-4"><img src="${escapeHtml(
        logoUri,
      )}" alt="Connect" class="h-12 w-12 rounded-lg object-cover"></div>`
    : '';

  const errorHtml = error
    ? `<div class="p-3 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">${escapeHtml(error)}</div>`
    : '';

  const headingText = escapeHtml(title ?? 'Connect credential');
  const subtitleText = subtitle ? escapeHtml(subtitle) : `Connect "${escapeHtml(field.name)}" to continue`;

  const content = `
    <div class="bg-white rounded-2xl shadow-xl p-8">
      ${logoHtml}
      <h1 class="text-3xl font-bold text-gray-900 mb-2 text-center">${headingText}</h1>
      <p class="text-gray-600 mb-8 text-center">${subtitleText}</p>

      ${errorHtml}

      <form method="POST" action="${escapeHtml(action)}">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
${buildLoginFieldHtml(field)}

        <button type="submit"
          class="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Connect
        </button>
      </form>
    </div>`;

  return centeredCardLayout(content, { title: title ?? 'Connect credential' });
}

/**
 * Build the success page shown after a credential is connected mid-session
 * (Checkpoint 3b). No secrets are rendered — only a confirmation message.
 */
export function buildConnectSuccessPage(params: { key: string; message?: string }): string {
  const { key, message } = params;
  const content = `
    <div class="bg-white rounded-2xl shadow-xl p-8 text-center">
      <div class="flex justify-center mb-6">
        <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
      </div>
      <h1 class="text-2xl font-bold text-gray-900 mb-4">Credential connected</h1>
      <p class="text-gray-600">${escapeHtml(message ?? `"${key}" is now connected. You can return to your session.`)}</p>
    </div>`;
  return centeredCardLayout(content, { title: 'Connected' });
}

/**
 * Build error page
 */
export function buildErrorPage(params: { error: string; description: string }): string {
  const { error, description } = params;

  const content = `
    <div class="bg-white rounded-2xl shadow-xl p-8 text-center">
      <!-- Error icon -->
      <div class="flex justify-center mb-6">
        <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </div>
      </div>

      <h1 class="text-2xl font-bold text-gray-900 mb-4">Authorization Error</h1>
      <p class="mb-4">
        <code class="px-2 py-1 bg-gray-100 rounded text-red-600 font-mono text-sm">${escapeHtml(error)}</code>
      </p>
      <p class="text-gray-600">${escapeHtml(description)}</p>
    </div>`;

  return centeredCardLayout(content, { title: 'Error' });
}

// ============================================
// Legacy Compatibility - renderToHtml wrapper
// ============================================

/**
 * Simple wrapper for compatibility - just returns the HTML string
 * (Templates are already complete HTML documents)
 */
export function renderToHtml(html: string, _options?: { title?: string }): string {
  return html;
}
