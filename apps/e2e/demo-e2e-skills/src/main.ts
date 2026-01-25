import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { SkillsE2EApp } from './apps/skills';

const port = parseInt(process.env['PORT'] ?? '3107', 10);

@FrontMcp({
  info: { name: 'Demo E2E Skills', version: '0.1.0' },
  apps: [SkillsE2EApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
  skillsConfig: {
    enabled: true,
    auth: 'public', // Single auth config for all HTTP endpoints
    mcpTools: true, // Keep searchSkills/loadSkills MCP tools enabled
  },
})
export default class Server {}
