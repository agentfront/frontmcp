import 'reflect-metadata';

import {
  detectUIType as uipackDetectUIType,
  warnIfComponentReference as uipackWarnIfComponentReference,
} from '@frontmcp/uipack/adapters';

import { LogLevel, Tool, ToolContext } from '../../../common';
import { create } from '../../../direct/create';
import type { Scope } from '../../../scope/scope.instance';
import { ScopeRegistry } from '../../../scope/scope.registry';
import { detectUIType, warnIfComponentReference } from '../template-detection';

class ClassWidget {
  render(): null {
    return null;
  }
}

function OrderCard(ctx: { output: { id: string } }): string {
  return `<b>${ctx.output.id}</b>`;
}

const compiledComponent = new Function(
  'return function Badge(props) { return _jsx("b", { children: props.label }); }',
)();

const templates: Array<[label: string, template: unknown]> = [
  ['nothing', undefined],
  ['null', null],
  ['an HTML string', '<div>{{output}}</div>'],
  ['a markdown string', '# Report'],
  ['a .tsx file', { file: './widget.tsx' }],
  ['a .JSX file', { file: './widget.JSX' }],
  ['an .html file', { file: './widget.html' }],
  ['a class component', ClassWidget],
  ['a memo/forwardRef object', { $$typeof: Symbol.for('react.memo'), type: () => null }],
  ['a function with $$typeof', Object.assign(() => null, { $$typeof: Symbol.for('react.forward_ref') })],
  ['a capitalized HTML builder', OrderCard],
  ['a capitalized function with compiled JSX', compiledComponent],
  ['a lowercase HTML builder', (ctx: unknown) => `<i>${String(ctx)}</i>`],
  ['a number', 42],
  ['a plain object', { html: '<b>hi</b>' }],
];

const silent = { warn: () => undefined };

describe('the tool UI template checks without the renderer', () => {
  it.each(templates)('detects the UI type of %s as @frontmcp/uipack does', (_label, template) => {
    expect(detectUIType(template)).toBe(uipackDetectUIType(template));
  });

  it.each(templates)('tells whether %s is a component reference as @frontmcp/uipack does', (_label, template) => {
    expect(warnIfComponentReference('same_tool', template, silent)).toBe(
      uipackWarnIfComponentReference('same_tool', template, silent),
    );
  });

  it('warns once per tool for a component reference', () => {
    const warnings: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message) };
    const widget = class Widget {
      render(): null {
        return null;
      }
    };

    warnIfComponentReference('first_tool', widget, logger);
    warnIfComponentReference('first_tool', widget, logger);
    warnIfComponentReference('second_tool', widget, logger);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"first_tool"');
  });

  it('serves detectUIType and checkTemplate on a scope with no UI tools, whose renderer never loads', async () => {
    @Tool({ name: 'ping', inputSchema: {} })
    class PingTool extends ToolContext {
      async execute() {
        return { pong: true };
      }
    }
    const primaryScope = jest.spyOn(ScopeRegistry.prototype, 'getPrimaryScope');
    const server = await create({
      info: { name: 'no-ui', version: '1.0.0' },
      tools: [PingTool],
      logging: { level: LogLevel.Off },
    });
    const scope = primaryScope.mock.results[0]?.value as Scope;
    primaryScope.mockRestore();
    try {
      expect(scope.toolUI.detectUIType('<b>hi</b>')).toBe('html');
      expect(scope.toolUI.detectUIType(ClassWidget)).toBe('react');
      expect(() => scope.toolUI.checkTemplate('class_widget', ClassWidget)).not.toThrow();
    } finally {
      await server.dispose();
    }
  });
});
