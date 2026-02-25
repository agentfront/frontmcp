export interface AuthProviderGeneratorSchema {
  name: string;
  project: string;
  type?: 'oauth' | 'api-key' | 'bearer' | 'basic' | 'custom';
  directory?: string;
  skipFormat?: boolean;
}
