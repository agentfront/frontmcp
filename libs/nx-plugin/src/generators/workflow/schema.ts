export interface WorkflowGeneratorSchema {
  name: string;
  project: string;
  directory?: string;
  skipFormat?: boolean;
}
