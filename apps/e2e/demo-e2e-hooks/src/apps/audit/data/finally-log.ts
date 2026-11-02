/**
 * What the Finally hooks of the finally-recorder plugin saw, per tool call stage.
 */
export interface FinallyEntry {
  toolName: string;
  stage: string;
  outcome: string;
}

class FinallyLogStore {
  private entries: FinallyEntry[] = [];

  add(entry: FinallyEntry): void {
    this.entries.push(entry);
  }

  entriesFor(toolName: string): FinallyEntry[] {
    return this.entries.filter((entry) => entry.toolName === toolName);
  }

  clear(): void {
    this.entries = [];
  }
}

export const finallyLog = new FinallyLogStore();
