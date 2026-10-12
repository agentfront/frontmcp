/**
 * Check if a tool name is the sendElicitationResult system tool.
 */
export function isSendElicitationResultTool(toolName: string): boolean {
  return toolName === 'sendElicitationResult';
}
