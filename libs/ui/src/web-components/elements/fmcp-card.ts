/**
 * @file fmcp-card.ts
 * @description FrontMCP Card Web Component.
 *
 * A custom element wrapper around the card() HTML function.
 *
 * @example Basic usage
 * ```html
 * <fmcp-card title="Welcome" subtitle="Description">
 *   <p>Card content goes here</p>
 * </fmcp-card>
 * ```
 *
 * @example Clickable card
 * ```html
 * <fmcp-card clickable href="/details" title="Item">
 *   <p>Click to view details</p>
 * </fmcp-card>
 * ```
 *
 * @module @frontmcp/ui/web-components/elements/fmcp-card
 */

import { FmcpElement, type FmcpElementConfig, getObservedAttributesFromSchema } from '../core';
import { card, type CardOptions } from '../../components/card';
import { CardOptionsSchema } from '../../components/card.schema';

/**
 * FmcpCard Web Component
 */
export class FmcpCard extends FmcpElement<CardOptions> {
  protected readonly config: FmcpElementConfig<CardOptions> = {
    name: 'card',
    schema: CardOptionsSchema,
    defaults: {
      variant: 'default',
      size: 'md',
    },
  };

  static get observedAttributes(): string[] {
    return getObservedAttributesFromSchema(CardOptionsSchema);
  }

  protected renderHtml(options: CardOptions, content: string): string {
    return card(content, options);
  }

  // Property setters
  set variant(value: CardOptions['variant']) {
    this._options.variant = value;
    this._scheduleRender();
  }
  get variant(): CardOptions['variant'] {
    return this._options.variant;
  }

  set size(value: CardOptions['size']) {
    this._options.size = value;
    this._scheduleRender();
  }
  get size(): CardOptions['size'] {
    return this._options.size;
  }

  set cardTitle(value: string | undefined) {
    this._options.title = value;
    this._scheduleRender();
  }
  get cardTitle(): string | undefined {
    return this._options.title;
  }

  set subtitle(value: string | undefined) {
    this._options.subtitle = value;
    this._scheduleRender();
  }
  get subtitle(): string | undefined {
    return this._options.subtitle;
  }

  set clickable(value: boolean) {
    this._options.clickable = value;
    this._scheduleRender();
  }
  get clickable(): boolean {
    return this._options.clickable ?? false;
  }

  set href(value: string | undefined) {
    this._options.href = value;
    this._scheduleRender();
  }
  get href(): string | undefined {
    return this._options.href;
  }

  set footer(value: string | undefined) {
    this._options.footer = value;
    this._scheduleRender();
  }
  get footer(): string | undefined {
    return this._options.footer;
  }

  set headerActions(value: string | undefined) {
    this._options.headerActions = value;
    this._scheduleRender();
  }
  get headerActions(): string | undefined {
    return this._options.headerActions;
  }
}

/**
 * Register the fmcp-card custom element.
 */
export function registerFmcpCard(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('fmcp-card')) {
    customElements.define('fmcp-card', FmcpCard);
  }
}
