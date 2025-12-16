export type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export class NoteStore {
  private readonly notes: Map<string, Note> = new Map();
  private nextId = 1;

  create(title: string, content: string): Note {
    const id = `note-${this.nextId++}`;
    const now = Date.now();
    const note: Note = {
      id,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(id, note);
    return note;
  }

  getById(id: string): Note | undefined {
    return this.notes.get(id);
  }

  getAll(): Note[] {
    return Array.from(this.notes.values());
  }

  count(): number {
    return this.notes.size;
  }
}

// Singleton instance
export const noteStore = new NoteStore();
