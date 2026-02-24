export interface ServerGeneratorSchema {
  name: string;
  directory?: string;
  deploymentTarget?: 'node' | 'vercel' | 'lambda' | 'cloudflare';
  apps: string;
  redis?: 'docker' | 'existing' | 'none';
  tags?: string;
  skipFormat?: boolean;
}
