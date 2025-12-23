/**
 * Type definitions for the Component Registration example
 */

export interface TableData {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
}

export interface ChartData {
  labels: string[];
  values: number[];
  type: 'bar' | 'line' | 'pie';
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'number' | 'select';
  options?: string[];
  required?: boolean;
}

export interface AppState {
  users: TableData[];
  chartData: ChartData | null;
  formData: Record<string, string>;
  lastAction: string;
}
