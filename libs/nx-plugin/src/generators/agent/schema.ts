export interface AgentGeneratorSchema {
  name: string;
  project: string;
  model?: string;
  tools?: string;
  directory?: string;
  skipFormat?: boolean;
}
