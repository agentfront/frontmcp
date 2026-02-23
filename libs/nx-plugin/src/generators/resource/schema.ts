export interface ResourceGeneratorSchema {
  name: string;
  project: string;
  template?: boolean;
  directory?: string;
  skipFormat?: boolean;
}
