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

import { wideLayout, extraWideLayout, centeredCardLayout, escapeHtml as baseEscapeHtml } from './base-layout';

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
 * Build consent page for tool selection
 */
export function buildToolConsentPage(params: {
  tools: ToolCard[];
  clientName: string;
  pendingAuthId: string;
  csrfToken: string;
  callbackPath: string;
  userName?: string;
  userEmail?: string;
}): string {
  const { tools, clientName, pendingAuthId, csrfToken, callbackPath, userName, userEmail } = params;

  // Group tools by app
  const toolsByApp: Record<string, { appName: string; tools: ToolCard[] }> = {};
  for (const tool of tools) {
    if (!toolsByApp[tool.appId]) {
      toolsByApp[tool.appId] = { appName: tool.appName, tools: [] };
    }
    toolsByApp[tool.appId].tools.push(tool);
  }

  const userInfo =
    userName || userEmail
      ? `<div class="p-3 bg-gray-50 rounded-lg mb-6 text-sm">
        <span class="text-gray-500">Signed in as: </span>
        <span class="font-medium text-gray-900">${escapeHtml(userName || userEmail || '')}</span>
      </div>`
      : '';

  const appGroups = Object.entries(toolsByApp)
    .map(([appId, { appName, tools: appTools }]) => {
      const toolItems = appTools
        .map((tool) => {
          const desc = tool.description
            ? `<p class="text-sm text-gray-500 mt-0.5">${escapeHtml(tool.description)}</p>`
            : '';
          return `<label class="flex items-start gap-3 p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-50">
        <input type="checkbox" name="tools" value="${escapeHtml(
          tool.toolId,
        )}" class="mt-0.5 w-5 h-5 rounded border-gray-300" checked>
        <div>
          <span class="font-medium text-gray-900">${escapeHtml(tool.toolName)}</span>
          ${desc}
        </div>
      </label>`;
        })
        .join('\n');

      return `<div class="bg-gray-50 rounded-xl overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 bg-gray-100">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            ${escapeHtml(appName.charAt(0).toUpperCase())}
          </div>
          <span class="font-semibold text-gray-900">${escapeHtml(appName)}</span>
        </div>
        <button type="button" class="text-sm text-blue-600 hover:text-blue-800"
          onclick="const container = this.closest('.bg-gray-50').querySelector('[data-app]'); const cbs = container.querySelectorAll('input[name=tools]'); const allChecked = [...cbs].every(cb => cb.checked); cbs.forEach(cb => cb.checked = !allChecked); updateCount();">
          Toggle All
        </button>
      </div>
      <div class="p-4 space-y-2" data-app="${escapeHtml(appId)}">
        ${toolItems}
      </div>
    </div>`;
    })
    .join('\n');

  const updateCountScript = `
  <script>
    function updateCount() {
      const all = document.querySelectorAll('input[name="tools"]');
      const checked = document.querySelectorAll('input[name="tools"]:checked');
      document.getElementById('selection-count').textContent = checked.length + ' of ' + all.length + ' selected';
      document.getElementById('select-all').checked = all.length > 0 && all.length === checked.length;
    }
    document.querySelectorAll('input[name="tools"]').forEach(cb => cb.addEventListener('change', updateCount));
  </script>`;

  const content = `
    <h1 class="text-3xl font-bold text-gray-900 mb-4">Select Tools to Enable</h1>
    <p class="text-gray-600 mb-6">
      Choose which tools ${escapeHtml(clientName)} can access. You can change this later.
    </p>

    ${userInfo}

    <form method="POST" action="${escapeHtml(callbackPath)}" id="consent-form">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">

      <!-- Select all toggle -->
      <div class="flex items-center justify-between mb-6">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" id="select-all" class="w-5 h-5 rounded border-gray-300" checked
            onchange="document.querySelectorAll('input[name=tools]').forEach(cb => cb.checked = this.checked); updateCount();">
          <span class="text-gray-700">Select all tools</span>
        </label>
        <span id="selection-count" class="text-sm text-gray-500">${tools.length} of ${tools.length} selected</span>
      </div>

      <!-- Tool groups by app -->
      <div class="space-y-6 mb-8">
        ${appGroups}
      </div>

      <!-- Buttons -->
      <div class="flex gap-4">
        <button type="button" onclick="history.back()"
          class="flex-1 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit"
          class="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Confirm Selection
        </button>
      </div>
    </form>
    ${updateCountScript}`;

  return extraWideLayout(content, { title: 'Select Tools' });
}

/**
 * Build simple login page
 */
export function buildLoginPage(params: {
  clientName: string;
  scope: string;
  pendingAuthId: string;
  callbackPath: string;
}): string {
  const { clientName, scope, pendingAuthId, callbackPath } = params;

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

  const content = `
    <div class="bg-white rounded-2xl shadow-xl p-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2 text-center">Sign In</h1>
      <p class="text-gray-600 mb-8 text-center">Authorize access to ${escapeHtml(clientName)}</p>

      ${scopesHtml}

      <form method="GET" action="${escapeHtml(callbackPath)}">
        <input type="hidden" name="pending_auth_id" value="${escapeHtml(pendingAuthId)}">

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
        </div>

        <!-- Submit -->
        <button type="submit"
          class="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Authorize
        </button>
      </form>

      <p class="text-center text-sm text-gray-500 mt-6">Client: ${escapeHtml(clientName)}</p>
    </div>`;

  return centeredCardLayout(content, { title: 'Sign In' });
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
