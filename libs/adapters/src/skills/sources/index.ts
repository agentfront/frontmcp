// file: plugins/plugin-skilled-openapi/src/sources/index.ts

import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { BundleSourceOptions } from '../source-options';
import { NpmSource } from './npm.source';
import { SaasPullSource } from './saas-pull.source';
import type { SkillBundleSource } from './skill-bundle-source.interface';
import { StaticSource } from './static.source';

export { StaticSource, NpmSource, SaasPullSource };
export type { SkillBundleSource, BundleSourceListener } from './skill-bundle-source.interface';

export function createBundleSource(
  source: BundleSourceOptions,
  cacheDir: string | undefined,
  logger: FrontMcpLogger,
): SkillBundleSource {
  switch (source.type) {
    case 'static':
      return new StaticSource(source, logger);
    case 'npm':
      return new NpmSource(source, logger);
    case 'saas':
      return new SaasPullSource(source, cacheDir, logger);
  }
}
