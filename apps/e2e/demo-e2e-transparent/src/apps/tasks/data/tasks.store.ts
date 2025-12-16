export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  createdBy: string;
  createdAt: string;
}

class TasksStore {
  private tasks: Map<string, Task> = new Map();

  add(task: Task): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  getByUser(userId: string): Task[] {
    return this.getAll().filter((t) => t.createdBy === userId);
  }

  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  clear(): void {
    this.tasks.clear();
  }
}

export const tasksStore = new TasksStore();
