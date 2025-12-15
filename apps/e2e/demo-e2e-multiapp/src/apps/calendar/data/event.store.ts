export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  location?: string;
  createdAt: number;
};

export class EventStore {
  private readonly events: Map<string, CalendarEvent> = new Map();
  private nextId = 1;

  create(title: string, description: string, startTime: number, endTime: number, location?: string): CalendarEvent {
    const id = `event-${this.nextId++}`;
    const event: CalendarEvent = {
      id,
      title,
      description,
      startTime,
      endTime,
      location,
      createdAt: Date.now(),
    };
    this.events.set(id, event);
    return event;
  }

  getById(id: string): CalendarEvent | undefined {
    return this.events.get(id);
  }

  getAll(): CalendarEvent[] {
    return Array.from(this.events.values()).sort((a, b) => a.startTime - b.startTime);
  }

  getUpcoming(fromTime: number = Date.now()): CalendarEvent[] {
    return this.getAll().filter((e) => e.startTime >= fromTime);
  }

  count(): number {
    return this.events.size;
  }
}

// Singleton instance
export const eventStore = new EventStore();
