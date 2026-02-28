import { buildShell } from '@frontmcp/uipack';

export interface ExampleShellOptions {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

export function buildExampleShell(options: ExampleShellOptions) {
  const content = `<div id="app">TODO: implement ${options.toolName} shell</div>`;
  return buildShell(content, {
    toolName: options.toolName,
    input: options.input,
    output: options.output,
  });
}
