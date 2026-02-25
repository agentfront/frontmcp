/**
 * Layout Presets
 *
 * Pre-configured layouts for common page types:
 * - Auth pages (login, register, etc.)
 * - Consent pages (OAuth, permissions)
 * - Error pages
 * - Loading states
 * - Success pages
 * - Widget mode (embedded)
 * - Resource display (OpenAI SDK)
 */

import { baseLayout, createLayoutBuilder, type BaseLayoutOptions, escapeHtml } from './base';

// ============================================
// Auth Layout
// ============================================

/**
 * Auth layout options
 */
export interface AuthLayoutOptions extends Omit<BaseLayoutOptions, 'pageType'> {
  /** Show branding/logo */
  showBranding?: boolean;
  /** Custom logo HTML */
  logo?: string;
  /** Footer content */
  footer?: string;
}

/**
 * Build auth page layout (login, register, etc.)
 */
export function authLayout(content: string, options: AuthLayoutOptions): string {
  const { showBranding = true, logo, footer, ...baseOptions } = options;

  const brandingHtml =
    showBranding && logo
      ? `<div class="text-center mb-8">${logo}</div>`
      : showBranding
        ? `<div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-secondary mb-4">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
          </div>
        </div>`
        : '';

  const footerHtml = footer ? `<div class="mt-8 text-center text-sm text-text-secondary">${footer}</div>` : '';

  const wrappedContent = `
    <div class="bg-white rounded-2xl shadow-xl p-8">
      ${brandingHtml}
      ${content}
    </div>
    ${footerHtml}
  `;

  return baseLayout(wrappedContent, {
    ...baseOptions,
    pageType: 'auth',
    size: baseOptions.size ?? 'sm',
    alignment: 'center',
    background: 'gradient',
  });
}

// ============================================
// Consent Layout
// ============================================

/**
 * Consent layout options
 */
export interface ConsentLayoutOptions extends Omit<BaseLayoutOptions, 'pageType'> {
  /** App/client name requesting consent */
  clientName?: string;
  /** App icon URL */
  clientIcon?: string;
  /** User info display */
  userInfo?: {
    name?: string;
    email?: string;
    avatar?: string;
  };
}

/**
 * Build consent page layout (OAuth consent, permissions)
 */
export function consentLayout(content: string, options: ConsentLayoutOptions): string {
  const { clientName, clientIcon, userInfo, ...baseOptions } = options;

  const headerHtml = clientName
    ? `<div class="text-center mb-6">
        ${
          clientIcon
            ? `<img src="${escapeHtml(clientIcon)}" alt="${escapeHtml(
                clientName,
              )}" class="w-16 h-16 rounded-xl mx-auto mb-4">`
            : `<div class="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-primary to-secondary text-white font-bold text-2xl mx-auto mb-4">
              ${escapeHtml(clientName.charAt(0).toUpperCase())}
            </div>`
        }
        <h1 class="text-2xl font-bold text-text-primary">${escapeHtml(clientName)}</h1>
      </div>`
    : '';

  const userInfoHtml = userInfo
    ? `<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-6">
        ${
          userInfo.avatar
            ? `<img src="${escapeHtml(userInfo.avatar)}" class="w-10 h-10 rounded-full">`
            : `<div class="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-medium">
              ${escapeHtml((userInfo.name || userInfo.email || 'U').charAt(0).toUpperCase())}
            </div>`
        }
        <div>
          ${userInfo.name ? `<div class="font-medium text-text-primary">${escapeHtml(userInfo.name)}</div>` : ''}
          ${userInfo.email ? `<div class="text-sm text-text-secondary">${escapeHtml(userInfo.email)}</div>` : ''}
        </div>
      </div>`
    : '';

  const wrappedContent = `
    ${headerHtml}
    ${userInfoHtml}
    ${content}
  `;

  return baseLayout(wrappedContent, {
    ...baseOptions,
    pageType: 'consent',
    size: baseOptions.size ?? 'lg',
    alignment: 'top',
    background: 'solid',
  });
}

// ============================================
// Error Layout
// ============================================

/**
 * Error layout options
 */
export interface ErrorLayoutOptions extends Omit<BaseLayoutOptions, 'pageType'> {
  /** Error code */
  errorCode?: string;
  /** Error title */
  errorTitle?: string;
  /** Error message */
  errorMessage?: string;
  /** Show retry button */
  showRetry?: boolean;
  /** Retry URL */
  retryUrl?: string;
  /** Show home button */
  showHome?: boolean;
  /** Home URL */
  homeUrl?: string;
}

/**
 * Build error page layout
 */
export function errorLayout(content: string, options: ErrorLayoutOptions): string {
  const {
    errorCode,
    errorTitle = 'Something went wrong',
    errorMessage,
    showRetry = true,
    retryUrl,
    showHome = true,
    homeUrl = '/',
    ...baseOptions
  } = options;

  const errorHtml = `
    <div class="text-center">
      <!-- Error icon -->
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-danger/10 mb-6">
        <svg class="w-10 h-10 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
      </div>

      ${errorCode ? `<p class="text-6xl font-bold text-danger mb-2">${escapeHtml(errorCode)}</p>` : ''}
      <h1 class="text-2xl font-bold text-text-primary mb-4">${escapeHtml(errorTitle)}</h1>
      ${errorMessage ? `<p class="text-text-secondary mb-8">${escapeHtml(errorMessage)}</p>` : ''}

      ${content}

      <div class="flex gap-4 justify-center mt-8">
        ${
          showRetry
            ? `<button onclick="${
                retryUrl ? `window.location.href='${escapeHtml(retryUrl)}'` : 'window.location.reload()'
              }" class="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors">Try Again</button>`
            : ''
        }
        ${
          showHome
            ? `<a href="${escapeHtml(
                homeUrl,
              )}" class="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-text-primary font-medium rounded-lg transition-colors">Go Home</a>`
            : ''
        }
      </div>
    </div>
  `;

  return baseLayout(errorHtml, {
    ...baseOptions,
    pageType: 'error',
    size: 'sm',
    alignment: 'center',
    background: 'solid',
    title: baseOptions.title ?? errorTitle,
  });
}

// ============================================
// Loading Layout
// ============================================

/**
 * Loading layout options
 */
export interface LoadingLayoutOptions extends Omit<BaseLayoutOptions, 'pageType'> {
  /** Loading message */
  message?: string;
  /** Show spinner */
  showSpinner?: boolean;
  /** Show progress bar */
  showProgress?: boolean;
  /** Progress value (0-100) */
  progress?: number;
}

/**
 * Build loading page layout
 */
export function loadingLayout(content: string, options: LoadingLayoutOptions): string {
  const { message = 'Loading...', showSpinner = true, showProgress = false, progress = 0, ...baseOptions } = options;

  const spinnerHtml = showSpinner
    ? `<div class="inline-flex items-center justify-center w-16 h-16 mb-6">
        <svg class="animate-spin w-12 h-12 text-primary" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>`
    : '';

  const progressHtml = showProgress
    ? `<div class="w-full bg-gray-200 rounded-full h-2 mb-4">
        <div class="bg-primary h-2 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
      </div>`
    : '';

  const loadingHtml = `
    <div class="text-center">
      ${spinnerHtml}
      <h2 class="text-xl font-medium text-text-primary mb-2">${escapeHtml(message)}</h2>
      ${progressHtml}
      ${content}
    </div>
  `;

  return baseLayout(loadingHtml, {
    ...baseOptions,
    pageType: 'loading',
    size: 'sm',
    alignment: 'center',
    background: 'solid',
    title: baseOptions.title ?? 'Loading',
  });
}

// ============================================
// Success Layout
// ============================================

/**
 * Success layout options
 */
export interface SuccessLayoutOptions extends Omit<BaseLayoutOptions, 'pageType'> {
  /** Success title */
  successTitle?: string;
  /** Success message */
  successMessage?: string;
  /** Continue button text */
  continueText?: string;
  /** Continue URL */
  continueUrl?: string;
  /** Auto-close countdown (seconds) */
  autoClose?: number;
}

/**
 * Build success page layout
 */
export function successLayout(content: string, options: SuccessLayoutOptions): string {
  const {
    successTitle = 'Success!',
    successMessage,
    continueText = 'Continue',
    continueUrl,
    autoClose,
    ...baseOptions
  } = options;

  const autoCloseScript = autoClose
    ? `<script>
        let countdown = ${autoClose};
        const countdownEl = document.getElementById('countdown');
        const interval = setInterval(() => {
          countdown--;
          if (countdownEl) countdownEl.textContent = countdown;
          if (countdown <= 0) {
            clearInterval(interval);
            ${continueUrl ? `window.location.href = '${escapeHtml(continueUrl)}';` : 'window.close();'}
          }
        }, 1000);
      </script>`
    : '';

  const successHtml = `
    <div class="text-center">
      <!-- Success icon -->
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10 mb-6">
        <svg class="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
      </div>

      <h1 class="text-2xl font-bold text-text-primary mb-4">${escapeHtml(successTitle)}</h1>
      ${successMessage ? `<p class="text-text-secondary mb-8">${escapeHtml(successMessage)}</p>` : ''}

      ${content}

      ${
        continueUrl
          ? `<a href="${escapeHtml(
              continueUrl,
            )}" class="inline-block mt-6 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors">${escapeHtml(
              continueText,
            )}</a>`
          : ''
      }

      ${
        autoClose
          ? `<p class="mt-4 text-sm text-text-secondary">Closing in <span id="countdown">${autoClose}</span> seconds...</p>`
          : ''
      }
    </div>
    ${autoCloseScript}
  `;

  return baseLayout(successHtml, {
    ...baseOptions,
    pageType: 'success',
    size: 'sm',
    alignment: 'center',
    background: 'solid',
    title: baseOptions.title ?? successTitle,
  });
}

// ============================================
// Widget Layout
// ============================================

/**
 * Widget layout options (for embedded widgets)
 */
export interface WidgetLayoutOptions extends Omit<BaseLayoutOptions, 'pageType' | 'alignment'> {
  /** Widget max width */
  maxWidth?: string;
  /** Show border */
  showBorder?: boolean;
  /** Transparent background */
  transparent?: boolean;
}

/**
 * Build widget layout (for embedding)
 */
export function widgetLayout(content: string, options: WidgetLayoutOptions): string {
  const { maxWidth = '100%', showBorder = false, transparent = true, ...baseOptions } = options;

  const containerClasses = [
    'widget-container',
    showBorder ? 'border border-border rounded-lg' : '',
    transparent ? '' : 'bg-surface',
  ]
    .filter(Boolean)
    .join(' ');

  const wrappedContent = `
    <div class="${containerClasses}" style="max-width: ${escapeHtml(maxWidth)}">
      ${content}
    </div>
  `;

  return baseLayout(wrappedContent, {
    ...baseOptions,
    pageType: 'widget',
    size: 'full',
    alignment: 'start',
    background: 'none',
  });
}

// ============================================
// Layout Builders
// ============================================

/**
 * Pre-configured auth layout builder
 */
export const authLayoutBuilder = createLayoutBuilder({
  pageType: 'auth',
  size: 'sm',
  alignment: 'center',
  background: 'gradient',
});

/**
 * Pre-configured consent layout builder
 */
export const consentLayoutBuilder = createLayoutBuilder({
  pageType: 'consent',
  size: 'lg',
  alignment: 'top',
  background: 'solid',
});

/**
 * Pre-configured error layout builder
 */
export const errorLayoutBuilder = createLayoutBuilder({
  pageType: 'error',
  size: 'sm',
  alignment: 'center',
  background: 'solid',
});
