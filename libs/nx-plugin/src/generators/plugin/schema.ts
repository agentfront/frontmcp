export interface PluginGeneratorSchema {
  name: string;
  project: string;
  withContextExtension?: boolean;
  directory?: string;
  skipFormat?: boolean;
}
