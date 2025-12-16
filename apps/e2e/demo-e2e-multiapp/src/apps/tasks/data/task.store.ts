export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type Task = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: number;
  dueDate?: number;
};

export class TaskStore {
  private readonly tasks: Map<string, Task> = new Map();
  private nextId = 1;

  create(title: string, description: string, priority: TaskPriority = 'medium', dueDate?: number): Task {
    const id = `task-${this.nextId++}`;
    const task: Task = {
      id,
      title,
      description,
      priority,
      status: 'pending',
      createdAt: Date.now(),
      dueDate,
    };
    this.tasks.set(id, task);
    return task;
  }

  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  getByPriority(priority: TaskPriority): Task[] {
    return this.getAll().filter((t) => t.priority === priority);
  }

  getByStatus(status: TaskStatus): Task[] {
    return this.getAll().filter((t) => t.status === status);
  }

  count(): number {
    return this.tasks.size;
  }
}

// Singleton instance
export const taskStore = new TaskStore();
