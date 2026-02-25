export interface ProviderGeneratorSchema {
  name: string;
  project: string;
  scope?: 'singleton' | 'request' | 'context';
  directory?: string;
  skipFormat?: boolean;
}
