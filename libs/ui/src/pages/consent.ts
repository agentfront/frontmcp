/**
 * OAuth Consent Page Template
 *
 * OAuth/OpenID Connect consent page for authorization flows.
 */

import { consentLayout, type ConsentLayoutOptions } from '../layouts';
import { primaryButton, outlineButton } from '../components/button';
import { permissionList, type PermissionItem } from '../components/list';
import { csrfInput, hiddenInput } from '../components/form';
import { alert } from '../components/alert';
import { escapeHtml } from '../layouts/base';

// ============================================
// Consent Page Types
// ============================================

/**
 * Client/Application information
 */
export interface ClientInfo {
  /** Client ID */
  clientId: string;
  /** Client name */
  name: string;
  /** Client icon/logo URL */
  icon?: string;
  /** Client website URL */
  websiteUrl?: string;
  /** Privacy policy URL */
  privacyUrl?: string;
  /** Terms of service URL */
  termsUrl?: string;
  /** Verified client badge */
  verified?: boolean;
}

/**
 * User information
 */
export interface UserInfo {
  /** User ID */
  id?: string;
  /** User name */
  name?: string;
  /** User email */
  email?: string;
  /** Avatar URL */
  avatar?: string;
}

/**
 * Consent page options
 */
export interface ConsentPageOptions {
  /** Client/App requesting authorization */
  client: ClientInfo;
  /** Current user info */
  user?: UserInfo;
  /** Requested permissions/scopes */
  permissions: PermissionItem[];
  /** Form action URL for approval */
  approveUrl: string;
  /** Form action URL for denial (optional, uses approveUrl if not provided) */
  denyUrl?: string;
  /** CSRF token */
  csrfToken?: string;
  /** OAuth state parameter */
  state?: string;
  /** Redirect URI */
  redirectUri?: string;
  /** Response type */
  responseType?: string;
  /** Nonce */
  nonce?: string;
  /** Code challenge */
  codeChallenge?: string;
  /** Code challenge method */
  codeChallengeMethod?: string;
  /** Error message */
  error?: string;
  /** Layout options */
  layout?: Partial<ConsentLayoutOptions>;
  /** Custom warning message */
  warningMessage?: string;
  /** Allow partial scope selection */
  allowScopeSelection?: boolean;
  /** Custom approve button text */
  approveText?: string;
  /** Custom deny button text */
  denyText?: string;
}

// ============================================
// Consent Page Builder
// ============================================

/**
 * Build an OAuth consent page
 */
export function consentPage(options: ConsentPageOptions): string {
  const {
    client,
    user,
    permissions,
    approveUrl,
    denyUrl,
    csrfToken,
    state,
    redirectUri,
    responseType,
    nonce,
    codeChallenge,
    codeChallengeMethod,
    error,
    layout = {},
    warningMessage,
    allowScopeSelection = false,
    approveText = 'Allow',
    denyText = 'Deny',
  } = options;

  // Error alert
  const errorAlert = error ? alert(error, { variant: 'danger', dismissible: true }) : '';

  // Warning for unverified apps
  const unverifiedWarning = !client.verified
    ? alert(warningMessage || 'This application has not been verified. Only authorize applications you trust.', {
        variant: 'warning',
        title: 'Unverified Application',
      })
    : '';

  // Client header
  const clientHeader = `
    <div class="text-center mb-6">
      ${
        client.icon
          ? `<img src="${escapeHtml(client.icon)}" alt="${escapeHtml(
              client.name,
            )}" class="w-16 h-16 rounded-xl mx-auto mb-4 shadow-md">`
          : `<div class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-secondary text-white font-bold text-2xl mx-auto mb-4 shadow-md">
            ${escapeHtml(client.name.charAt(0).toUpperCase())}
          </div>`
      }
      <h1 class="text-xl font-bold text-text-primary">
        ${
          client.verified
            ? `<span class="inline-flex items-center gap-1">
          ${escapeHtml(client.name)}
          <svg class="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg>
        </span>`
            : escapeHtml(client.name)
        }
      </h1>
      <p class="text-text-secondary mt-1">wants to access your account</p>
    </div>
  `;

  // User info section
  const userSection = user
    ? `
    <div class="flex items-center gap-3 p-4 bg-gray-50 rounded-lg mb-6">
      ${
        user.avatar
          ? `<img src="${escapeHtml(user.avatar)}" class="w-12 h-12 rounded-full">`
          : `<div class="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-lg">
            ${escapeHtml((user.name || user.email || 'U').charAt(0).toUpperCase())}
          </div>`
      }
      <div class="flex-1 min-w-0">
        ${user.name ? `<div class="font-medium text-text-primary truncate">${escapeHtml(user.name)}</div>` : ''}
        ${user.email ? `<div class="text-sm text-text-secondary truncate">${escapeHtml(user.email)}</div>` : ''}
      </div>
      <a href="/login?prompt=select_account" class="text-sm text-primary hover:text-primary/80">
        Switch account
      </a>
    </div>
  `
    : '';

  // Permissions section
  const permissionsSection = `
    <div class="mb-6">
      <h3 class="font-medium text-text-primary mb-3">This will allow ${escapeHtml(client.name)} to:</h3>
      ${permissionList(permissions, {
        checkable: allowScopeSelection,
        inputName: 'scope',
      })}
    </div>
  `;

  // Hidden form fields
  const hiddenFields = [
    csrfToken ? csrfInput(csrfToken) : '',
    state ? hiddenInput('state', state) : '',
    redirectUri ? hiddenInput('redirect_uri', redirectUri) : '',
    responseType ? hiddenInput('response_type', responseType) : '',
    nonce ? hiddenInput('nonce', nonce) : '',
    codeChallenge ? hiddenInput('code_challenge', codeChallenge) : '',
    codeChallengeMethod ? hiddenInput('code_challenge_method', codeChallengeMethod) : '',
    hiddenInput('client_id', client.clientId),
    // Include all scopes if not selectable
    !allowScopeSelection ? permissions.map((p) => hiddenInput('scope[]', p.scope)).join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Action buttons
  const actionsHtml = `
    <div class="flex gap-3 pt-4">
      <form action="${escapeHtml(denyUrl || approveUrl)}" method="post" class="flex-1">
        ${hiddenFields}
        <input type="hidden" name="action" value="deny">
        ${outlineButton(denyText, { type: 'submit', fullWidth: true })}
      </form>
      <form action="${escapeHtml(approveUrl)}" method="post" class="flex-1">
        ${hiddenFields}
        <input type="hidden" name="action" value="approve">
        ${primaryButton(approveText, { type: 'submit', fullWidth: true })}
      </form>
    </div>
  `;

  // Privacy/Terms links
  const linksHtml =
    client.privacyUrl || client.termsUrl || client.websiteUrl
      ? `
    <div class="text-center text-xs text-text-secondary mt-6 space-x-3">
      ${
        client.websiteUrl
          ? `<a href="${escapeHtml(
              client.websiteUrl,
            )}" target="_blank" rel="noopener" class="hover:text-primary">Website</a>`
          : ''
      }
      ${
        client.privacyUrl
          ? `<a href="${escapeHtml(
              client.privacyUrl,
            )}" target="_blank" rel="noopener" class="hover:text-primary">Privacy Policy</a>`
          : ''
      }
      ${
        client.termsUrl
          ? `<a href="${escapeHtml(
              client.termsUrl,
            )}" target="_blank" rel="noopener" class="hover:text-primary">Terms of Service</a>`
          : ''
      }
    </div>
  `
      : '';

  // Combine all content
  const content = `
    ${errorAlert}
    ${unverifiedWarning}
    ${clientHeader}
    ${userSection}
    ${permissionsSection}
    ${actionsHtml}
    ${linksHtml}
  `;

  return consentLayout(content, {
    title: `Authorize ${client.name}`,
    clientName: client.name,
    clientIcon: client.icon,
    userInfo: user,
    ...layout,
  });
}

// ============================================
// Consent Success Page
// ============================================

/**
 * Consent success page options
 */
export interface ConsentSuccessOptions {
  /** Client info */
  client: ClientInfo;
  /** Redirect URL */
  redirectUrl?: string;
  /** Auto redirect delay (ms) */
  autoRedirectDelay?: number;
  /** Layout options */
  layout?: Partial<ConsentLayoutOptions>;
}

/**
 * Build a consent success page
 */
export function consentSuccessPage(options: ConsentSuccessOptions): string {
  const { client, redirectUrl, autoRedirectDelay = 3000, layout = {} } = options;

  const redirectScript =
    redirectUrl && autoRedirectDelay > 0
      ? `
    <script>
      setTimeout(() => {
        window.location.href = '${escapeHtml(redirectUrl)}';
      }, ${autoRedirectDelay});
    </script>
  `
      : '';

  const content = `
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-6">
        <svg class="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-text-primary mb-2">Authorization Successful</h1>
      <p class="text-text-secondary mb-4">
        You have authorized <strong>${escapeHtml(client.name)}</strong> to access your account.
      </p>
      ${
        redirectUrl
          ? `<p class="text-sm text-text-secondary">Redirecting you back to ${escapeHtml(client.name)}...</p>`
          : ''
      }
    </div>
    ${redirectScript}
  `;

  return consentLayout(content, {
    title: 'Authorization Successful',
    clientName: client.name,
    clientIcon: client.icon,
    ...layout,
  });
}

// ============================================
// Consent Denied Page
// ============================================

/**
 * Consent denied page options
 */
export interface ConsentDeniedOptions {
  /** Client info */
  client: ClientInfo;
  /** Redirect URL */
  redirectUrl?: string;
  /** Layout options */
  layout?: Partial<ConsentLayoutOptions>;
}

/**
 * Build a consent denied page
 */
export function consentDeniedPage(options: ConsentDeniedOptions): string {
  const { client, redirectUrl, layout = {} } = options;

  const content = `
    <div class="text-center">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-6">
        <svg class="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-text-primary mb-2">Authorization Denied</h1>
      <p class="text-text-secondary mb-6">
        You denied <strong>${escapeHtml(client.name)}</strong> access to your account.
      </p>
      ${
        redirectUrl
          ? `
        <a href="${escapeHtml(
          redirectUrl,
        )}" class="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors">
          Return to ${escapeHtml(client.name)}
        </a>
      `
          : ''
      }
    </div>
  `;

  return consentLayout(content, {
    title: 'Authorization Denied',
    clientName: client.name,
    clientIcon: client.icon,
    ...layout,
  });
}
