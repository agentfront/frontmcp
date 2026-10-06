import { render } from '@testing-library/react';
import React from 'react';

import type { CallToolResult } from '@frontmcp/sdk';

import { ComponentRegistry } from '../../components/ComponentRegistry';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../../types';
import { useDynamicTool } from '../useDynamicTool';

function ToolOwner({ label }: { label: string }) {
  useDynamicTool({
    name: 'x',
    description: 'shared tool',
    inputSchema: { type: 'object', properties: {} },
    execute: async (): Promise<CallToolResult> => ({ content: [{ type: 'text', text: label }] }),
  });
  return null;
}

function Page({ owners, registry }: { owners: string[]; registry: DynamicRegistry }) {
  const context: FrontMcpContextValue = {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry: registry,
    getDynamicRegistry: () => registry,
    connect: async () => undefined,
  };
  return (
    <FrontMcpContext.Provider value={context}>
      {owners.map((label) => (
        <ToolOwner key={label} label={label} />
      ))}
    </FrontMcpContext.Provider>
  );
}

describe('useDynamicTool shared by two components (#769)', () => {
  it('runs the mounted component after the newer registrant unmounts', async () => {
    const registry = new DynamicRegistry();
    const view = render(<Page owners={['first', 'second']} registry={registry} />);

    view.rerender(<Page owners={['first']} registry={registry} />);
    const result = await registry.findTool('x')?.execute({});
    expect(result?.content).toEqual([{ type: 'text', text: 'first' }]);

    view.rerender(<Page owners={[]} registry={registry} />);
    expect(registry.hasTool('x')).toBe(false);
  });
});
