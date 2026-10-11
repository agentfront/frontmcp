import * as path from 'path';

import { fileExists, mkdir, rm, writeFile } from '@frontmcp/utils';

import { c } from '../../core/colors';
import { RegistryError } from './errors';
import { defaultKeyPath, formatProofRecord, generateRegistryKeyPair } from './keys';
import { proofUrl } from './proof';

export interface KeygenOptions {
  out?: string;
  force?: boolean;
}

export async function generateRegistryKey(options: KeygenOptions): Promise<void> {
  const keyPath = path.resolve(options.out ?? defaultKeyPath());
  if (!options.force && (await fileExists(keyPath))) {
    throw new RegistryError(
      `${keyPath} already exists. Pass --force to replace it; the proof you published for the old key then stops working.`,
    );
  }
  const { privateKeySeedHex, publicKeyBase64 } = generateRegistryKeyPair();
  await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  await rm(keyPath, { force: true });
  await writeFile(keyPath, `${privateKeySeedHex}\n`, { mode: 0o600 });

  console.log(c('green', `Wrote the private key to ${keyPath} (mode 0600).`));
  console.log(
    'Keep it secret: it publishes to your namespace. mcp-publisher accepts it too (login http --private-key).',
  );
  console.log(`\n${c('bold', 'Public key')}\n  ${publicKeyBase64}`);
  console.log(
    `\n${c('bold', 'HTTP proof')}: set this on the deployed FrontMCP server, which then serves ${proofUrl('<domain>')}`,
  );
  console.log(`  MCP_REGISTRY_PUBLIC_KEY=${publicKeyBase64}`);
  console.log(`\n${c('bold', 'DNS proof')}: or add this TXT record at the domain apex (it also covers subdomains)`);
  console.log(`  ${formatProofRecord(publicKeyBase64)}`);
  console.log(`\n${c('bold', 'Next steps')}`);
  console.log("  1. Set @FrontMcp({ registry: { name: 'com.example/my-server', description: '...' } }) and redeploy.");
  console.log('  2. Preview the listing:  frontmcp registry publish --dry-run');
  const keyFileFlag = keyPath === defaultKeyPath() ? '' : ` --key-file ${keyPath}`;
  console.log(`  3. Publish:              frontmcp registry publish${keyFileFlag}`);
  console.log('     In CI, store the file content as a secret and expose it as MCP_REGISTRY_PRIVATE_KEY.');
}
