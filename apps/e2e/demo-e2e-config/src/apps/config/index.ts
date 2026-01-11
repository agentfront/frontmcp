import { App, ConfigPlugin } from '@frontmcp/sdk';
import * as path from 'path';
import GetConfigTool from './tools/get-config.tool';
import GetRequiredConfigTool from './tools/get-required-config.tool';
import GetAllConfigTool from './tools/get-all-config.tool';
import CheckConfigTool from './tools/check-config.tool';
import TestConfigFallbackTool from './tools/test-config-fallback.tool';

// Resolve paths relative to this app's location
const basePath = path.resolve(__dirname, '../..');

@App({
  name: 'config',
  plugins: [
    ConfigPlugin.init({
      basePath,
      loadEnv: true,
      populateProcessEnv: true,
    }),
  ],
  tools: [GetConfigTool, GetRequiredConfigTool, GetAllConfigTool, CheckConfigTool, TestConfigFallbackTool],
})
export class ConfigApp {}
