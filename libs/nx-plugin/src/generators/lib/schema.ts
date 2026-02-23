export interface LibGeneratorSchema {
  name: string;
  directory?: string;
  libType?: 'generic' | 'plugin' | 'adapter' | 'tool-register';
  publishable?: boolean;
  importPath?: string;
  tags?: string;
  skipFormat?: boolean;
}
