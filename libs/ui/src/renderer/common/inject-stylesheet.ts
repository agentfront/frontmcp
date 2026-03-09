/**
 * Inject a CSS stylesheet link into the document head.
 * No-ops if the stylesheet is already loaded or if running outside a browser.
 *
 * @param href - URL of the stylesheet
 * @param id - Unique ID for the link element (prevents duplicates)
 */
export function injectStylesheet(href: string, id: string): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
