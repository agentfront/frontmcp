/**
 * @file fmcp-badge.ts
 * @description FrontMCP Badge Web Component.
 *
 * A custom element wrapper around the badge() HTML function.
 *
 * @example Basic usage
 * ```html
 * <fmcp-badge>Default</fmcp-badge>
 * <fmcp-badge variant="success">Active</fmcp-badge>
 * <fmcp-badge variant="danger" pill>Error</fmcp-badge>
 * ```
 *
 * @example Removable badge
 * ```html
 * <fmcp-badge removable>Tag</fmcp-badge>
 * ```
 *
 * @module @frontmcp/ui/web-components/elements/fmcp-badge
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { badge, type BadgeOptions } from '../../components/badge';
import { BadgeOptionsSchema } from '../../components/badge.schema';

/**
 * FmcpBadge Web Component
 */
export class FmcpBadge extends FmcpElement<BadgeOptions> {
  protected readonly config: FmcpElementConfig<BadgeOptions> = {
    name: 'badge',
    schema: BadgeOptionsSchema,
    defaults: {
      variant: 'default',
      size: 'md',
    },
  };

  static get observedAttributes(): string[] {
    return getObservedAttributesFromSchema(BadgeOptionsSchema);
  }

  protected renderHtml(options: BadgeOptions, content: string): string {
    return badge(content, options);
  }

  // Property setters
  set variant(value: BadgeOptions['variant']) {
    this._options.variant = value;
    this._scheduleRender();
  }
  get variant(): BadgeOptions['variant'] {
    return this._options.variant;
  }

  set size(value: BadgeOptions['size']) {
    this._options.size = value;
    this._scheduleRender();
  }
  get size(): BadgeOptions['size'] {
    return this._options.size;
  }

  set pill(value: boolean) {
    this._options.pill = value;
    this._scheduleRender();
  }
  get pill(): boolean {
    return this._options.pill ?? false;
  }

  set dot(value: boolean) {
    this._options.dot = value;
    this._scheduleRender();
  }
  get dot(): boolean {
    return this._options.dot ?? false;
  }

  set removable(value: boolean) {
    this._options.removable = value;
    this._scheduleRender();
  }
  get removable(): boolean {
    return this._options.removable ?? false;
  }

  set icon(value: string | undefined) {
    this._options.icon = value;
    this._scheduleRender();
  }
  get icon(): string | undefined {
    return this._options.icon;
  }
}

/**
 * Register the fmcp-badge custom element.
 */
export function registerFmcpBadge(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-badge')) {
    customElements.define('fmcp-badge', FmcpBadge);
  }
}
