import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadDecoratorConfig } from '../project';
import { buildServerJson } from '../server-json';
import { validateServerJson } from '../validate';

describe('loadDecoratorConfig with a real @FrontMcp() entry', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-project-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('reads the registry option the SDK keeps on the decorated class', async () => {
    const entry = path.join(projectDir, 'main.js');
    fs.writeFileSync(
      entry,
      `const { FrontMcp } = require('@frontmcp/sdk');
class WeatherServer {}
FrontMcp({
  info: { name: 'weather', title: 'Acme Weather', version: '1.2.0' },
  apps: [],
  registry: {
    name: 'com.acme/weather',
    description: 'Forecasts for any city',
    repository: { url: 'https://github.com/acme/weather', source: 'github' },
  },
})(WeatherServer);
module.exports = WeatherServer;
`,
    );

    const decoratorConfig = await loadDecoratorConfig(projectDir, entry);
    const { serverJson } = buildServerJson({
      decoratorConfig,
      packageJson: {},
      remoteUrl: 'https://mcp.acme.com/mcp',
    });

    expect(serverJson).toEqual(
      expect.objectContaining({
        name: 'com.acme/weather',
        description: 'Forecasts for any city',
        version: '1.2.0',
        title: 'Acme Weather',
        repository: { url: 'https://github.com/acme/weather', source: 'github' },
      }),
    );
    expect(validateServerJson(serverJson)).toEqual([]);
  });
});
