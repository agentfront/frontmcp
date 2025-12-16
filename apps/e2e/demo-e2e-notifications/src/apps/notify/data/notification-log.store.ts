export type NotificationLogEntry = {
  id: string;
  timestamp: number;
  type: 'resource_change' | 'progress' | 'message' | 'tools_changed' | 'prompts_changed';
  details: Record<string, unknown>;
};

class NotificationLogStore {
  private readonly entries: NotificationLogEntry[] = [];
  private nextId = 1;

  log(type: NotificationLogEntry['type'], details: Record<string, unknown>): NotificationLogEntry {
    const entry: NotificationLogEntry = {
      id: `notif-${this.nextId++}`,
      timestamp: Date.now(),
      type,
      details,
    };
    this.entries.push(entry);
    return entry;
  }

  getAll(): NotificationLogEntry[] {
    return [...this.entries];
  }

  getByType(type: NotificationLogEntry['type']): NotificationLogEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  count(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
    this.nextId = 1;
  }
}

export const notificationLogStore = new NotificationLogStore();
