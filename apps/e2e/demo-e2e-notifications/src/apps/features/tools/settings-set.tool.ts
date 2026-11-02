import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';
import { readFile, writeFile } from '@frontmcp/utils';

import { featuresFile } from '../reviews.signal';

@Tool({
  name: 'settings_set',
  description: 'Turns a feature on or off',
  inputSchema: { feature: z.string(), on: z.boolean() },
})
export default class SettingsSetTool extends ToolContext {
  async execute({ feature, on }: { feature: string; on: boolean }) {
    const features = await readFile(featuresFile).then(
      (content) => JSON.parse(content) as Record<string, boolean>,
      () => ({}),
    );
    await writeFile(featuresFile, JSON.stringify({ ...features, [feature]: on }));
    return { feature, on };
  }
}
