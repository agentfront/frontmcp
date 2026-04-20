import * as path from 'path';

import { c } from '../../core/colors';
import { validateMcpb } from '../build/mcpb/validate';

export async function runValidate(archivePath: string): Promise<void> {
  const abs = path.resolve(process.cwd(), archivePath);
  console.log(`${c('cyan', '[mcpb:validate]')} ${path.relative(process.cwd(), abs)}`);

  const result = await validateMcpb(abs);

  if (result.manifest) {
    console.log(`${c('gray', '[mcpb:validate]')} name=${result.manifest.name} version=${result.manifest.version}`);
    console.log(
      `${c('gray', '[mcpb:validate]')} tools=${result.manifest.tools?.length ?? 0} prompts=${result.manifest.prompts?.length ?? 0} user_config=${Object.keys(result.manifest.user_config ?? {}).length}`,
    );
  }

  for (const w of result.warnings) {
    console.log(`${c('yellow', '[mcpb:validate]')} warning: ${w}`);
  }

  if (result.ok) {
    console.log(`${c('green', '[mcpb:validate]')} archive is valid`);
    return;
  }

  for (const e of result.errors) {
    console.error(`${c('red', '[mcpb:validate]')} ${e}`);
  }
  throw new Error(`MCPB validation failed (${result.errors.length} error${result.errors.length === 1 ? '' : 's'})`);
}
