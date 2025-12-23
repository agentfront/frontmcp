/**
 * Type definitions for the React example
 */

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export interface User {
  name: string;
  email: string;
}

export interface AppState {
  count: number;
  user: User | null;
  todos: Todo[];
  theme: 'light' | 'dark';
  lastAction: string;
}
