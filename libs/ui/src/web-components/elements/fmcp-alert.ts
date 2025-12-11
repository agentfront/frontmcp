/**
 * @file fmcp-alert.ts
 * @description FrontMCP Alert Web Component.
 *
 * A custom element wrapper around the alert() HTML function.
 *
 * @example Basic usage
 * ```html
 * <fmcp-alert variant="success">Operation completed!</fmcp-alert>
 * <fmcp-alert variant="danger" title="Error">Something went wrong</fmcp-alert>
 * ```
 *
 * @example Dismissible alert
 * ```html
 * <fmcp-alert variant="info" dismissible>
 *   Click X to dismiss
 * </fmcp-alert>
 * ```
 *
 * @module @frontmcp/ui/web-components/elements/fmcp-alert
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { alert, type AlertOptions } from '../../components/alert';
import { AlertOptionsSchema } from '../../components/alert.schema';

/**
 * FmcpAlert Web Component
 */
export class FmcpAlert extends FmcpElement<AlertOptions> {
  protected readonly config: FmcpElementConfig<AlertOptions> = {
    name: 'alert',
    schema: AlertOptionsSchema,
    defaults: {
      variant: 'info',
      showIcon: true,
    },
  };

  static get observedAttributes(): string[] {
    return getObservedAttributesFromSchema(AlertOptionsSchema);
  }

  protected renderHtml(options: AlertOptions, content: string): string {
    return alert(content, options);
  }

  // Property setters
  set variant(value: AlertOptions['variant']) {
    this._options.variant = value;
    this._scheduleRender();
  }
  get variant(): AlertOptions['variant'] {
    return this._options.variant;
  }

  set alertTitle(value: string | undefined) {
    this._options.title = value;
    this._scheduleRender();
  }
  get alertTitle(): string | undefined {
    return this._options.title;
  }

  set showIcon(value: boolean) {
    this._options.showIcon = value;
    this._scheduleRender();
  }
  get showIcon(): boolean {
    return this._options.showIcon ?? true;
  }

  set dismissible(value: boolean) {
    this._options.dismissible = value;
    this._scheduleRender();
  }
  get dismissible(): boolean {
    return this._options.dismissible ?? false;
  }

  set actions(value: string | undefined) {
    this._options.actions = value;
    this._scheduleRender();
  }
  get actions(): string | undefined {
    return this._options.actions;
  }
}

/**
 * Register the fmcp-alert custom element.
 */
export function registerFmcpAlert(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-alert')) {
    customElements.define('fmcp-alert', FmcpAlert);
  }
}
