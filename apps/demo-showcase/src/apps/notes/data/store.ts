export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

class NotesStore {
  private notes: Map<string, Note> = new Map();
  private idCounter = 1;

  create(data: { title: string; content: string; tags?: string[] }): Note {
    const id = String(this.idCounter++);
    const now = new Date().toISOString();
    const note: Note = {
      id,
      title: data.title,
      content: data.content,
      tags: data.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(id, note);
    return note;
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  list(tag?: string): Note[] {
    const allNotes = Array.from(this.notes.values());
    if (tag) {
      return allNotes.filter((note) => note.tags.includes(tag));
    }
    return allNotes;
  }

  update(id: string, data: Partial<Pick<Note, 'title' | 'content' | 'tags'>>): Note | undefined {
    const note = this.notes.get(id);
    if (!note) return undefined;

    const updated: Note = {
      ...note,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.notes.delete(id);
  }

  clear(): void {
    this.notes.clear();
    this.idCounter = 1;
  }
}

// Global singleton store
export const notesStore = new NotesStore();
