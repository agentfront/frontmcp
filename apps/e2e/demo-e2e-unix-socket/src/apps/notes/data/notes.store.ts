export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

class NotesStore {
  private notes: Map<string, Note> = new Map();

  add(note: Note): void {
    this.notes.set(note.id, note);
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  getAll(): Note[] {
    return Array.from(this.notes.values());
  }

  delete(id: string): boolean {
    return this.notes.delete(id);
  }

  clear(): void {
    this.notes.clear();
  }
}

export const notesStore = new NotesStore();
