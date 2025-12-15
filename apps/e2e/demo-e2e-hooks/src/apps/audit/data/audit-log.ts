/**
 * In-memory audit log storage
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  toolName: string;
  hookType: 'will' | 'did';
  stage: string;
  priority: number;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  success?: boolean;
}

class AuditLogStore {
  private entries: AuditEntry[] = [];
  private executionOrder: string[] = [];

  addEntry(entry: AuditEntry): void {
    this.entries.push(entry);
    this.executionOrder.push(`${entry.hookType}:${entry.stage}:${entry.priority}`);
  }

  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  getExecutionOrder(): string[] {
    return [...this.executionOrder];
  }

  getEntriesForTool(toolName: string): AuditEntry[] {
    return this.entries.filter((e) => e.toolName === toolName);
  }

  clear(): void {
    this.entries = [];
    this.executionOrder = [];
  }

  getStats(): { total: number; willCount: number; didCount: number } {
    const willCount = this.entries.filter((e) => e.hookType === 'will').length;
    const didCount = this.entries.filter((e) => e.hookType === 'did').length;
    return { total: this.entries.length, willCount, didCount };
  }
}

// Singleton instance
export const auditLog = new AuditLogStore();
