export function resolveDemoSessionId(ctxSessionId?: string, authSessionId?: string): string {
  return ctxSessionId?.trim() || authSessionId?.trim() || 'mock-session-default';
}
