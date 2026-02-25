export interface JobGeneratorSchema {
  name: string;
  project: string;
  directory?: string;
  skipFormat?: boolean;
}
