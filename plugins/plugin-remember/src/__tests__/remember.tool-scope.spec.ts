/**
 * `scope: 'tool'` memory belongs to the tool that stores it (for the same caller).
 *
 * The tool name was read from `FrontMcpContext.flow`, which nothing sets, so every tool fell back
 * to `'unknown'` and shared one tool namespace per caller: any tool read and overwrote any other
 * tool's "tool-scoped" values.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { App, connect, LogLevel, Tool, ToolContext, type DirectClient } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

@Tool({ name: 'notes_a', inputSchema: { note: z.string().optional() } })
class NotesATool extends ToolContext {
  async execute(input: { note?: string }) {
    const remember = this.get(RememberAccessorToken);
    if (input.note !== undefined) await remember.set('note', input.note, { scope: 'tool' });
    return { note: (await remember.get<string>('note', { scope: 'tool' })) ?? null };
  }
}

@Tool({ name: 'notes_b', inputSchema: { note: z.string().optional() } })
class NotesBTool extends ToolContext {
  async execute(input: { note?: string }) {
    const remember = this.get(RememberAccessorToken);
    if (input.note !== undefined) await remember.set('note', input.note, { scope: 'tool' });
    return { note: (await remember.get<string>('note', { scope: 'tool' })) ?? null };
  }
}

/** Writes its own tool memory, calls `notes_b` (which writes its own), then reads its own again. */
@Tool({ name: 'notes_outer', inputSchema: {} })
class NotesOuterTool extends ToolContext {
  async execute() {
    const remember = this.get(RememberAccessorToken);
    await remember.set('note', 'outer', { scope: 'tool' });
    await Promise.all([this.callTool('notes_b', { note: 'inner' }), this.callTool('notes_a', { note: 'sibling' })]);
    return { note: (await remember.get<string>('note', { scope: 'tool' })) ?? null };
  }
}

@App({
  id: 'notebook',
  name: 'Notebook',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [NotesATool, NotesBTool, NotesOuterTool],
})
class NotebookApp {}

const config = {
  info: { name: 'remember-tool-scope', version: '1.0.0' },
  apps: [NotebookApp],
  logging: { level: LogLevel.Off },
};

function noteOf(result: unknown): unknown {
  return (result as { structuredContent?: { note?: unknown } }).structuredContent?.note;
}

describe('Remember tool scope', () => {
  let client: DirectClient;
  let other: DirectClient;

  beforeEach(async () => {
    client = await connect(config);
    other = await connect(config);
  });

  afterEach(async () => {
    await Promise.all([client.close(), other.close()]);
  });

  it('keeps one tool’s tool-scoped memory away from another tool of the same caller', async () => {
    await client.callTool('notes_a', { note: 'from-a' });

    expect({
      a: noteOf(await client.callTool('notes_a', {})),
      b: noteOf(await client.callTool('notes_b', {})),
    }).toEqual({ a: 'from-a', b: null });
  });

  it('does not let another tool overwrite it', async () => {
    await client.callTool('notes_a', { note: 'from-a' });
    await client.callTool('notes_b', { note: 'from-b' });

    expect(noteOf(await client.callTool('notes_a', {}))).toBe('from-a');
  });

  it('keys by the tool running, when a tool calls other tools in parallel', async () => {
    expect(noteOf(await client.callTool('notes_outer', {}))).toBe('outer');
    expect({
      a: noteOf(await client.callTool('notes_a', {})),
      b: noteOf(await client.callTool('notes_b', {})),
    }).toEqual({ a: 'sibling', b: 'inner' });
  });

  it('still keeps the same tool’s memory apart for another caller', async () => {
    await client.callTool('notes_a', { note: 'from-a' });

    expect(noteOf(await other.callTool('notes_a', {}))).toBeNull();
  });
});
