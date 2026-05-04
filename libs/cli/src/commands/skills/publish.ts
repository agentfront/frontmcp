// file: libs/cli/src/commands/skills/publish.ts
//
// `frontmcp skills publish --target smithery|glama [--token X] [--dry-run]`
//
// Maps a catalog skill onto each registry's submission shape and POSTs.
// Production hosts run this from CI with the registry token set as a secret.
// `--dry-run` prints the URL + payload without sending so authors can inspect.

import { c } from '../../core/colors';
import { loadCatalog } from './catalog';
import {
  buildGlamaPayload,
  buildSmitheryPayload,
  GLAMA_ENDPOINT,
  SMITHERY_ENDPOINT,
  type PublishableSkill,
  type PublishTarget,
} from './targets';

export interface PublishSkillsOptions {
  target: PublishTarget;
  /** Skill name; required when not in --dry-run-all mode. */
  name: string;
  token?: string;
  dryRun?: boolean;
  /** Optional repository URL override (for skills authored outside the monorepo). */
  repository?: string;
}

export async function publishSkill(options: PublishSkillsOptions): Promise<void> {
  const manifest = loadCatalog();
  const skill = manifest.skills.find((s) => s.name === options.name);
  if (!skill) {
    console.error(c('red', `Skill "${options.name}" not found in catalog.`));
    process.exit(1);
  }

  const publishable: PublishableSkill = {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    tags: skill.tags,
    repository: options.repository,
    install: { type: 'npm', reference: '@frontmcp/skills', command: `frontmcp skills install ${skill.name}` },
  };

  const { url, payload } = renderTarget(options.target, publishable);

  if (options.dryRun) {
    console.log(c('bold', `\n[dry-run] POST ${url}\n`));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const token = options.token ?? envTokenFor(options.target);
  if (!token) {
    console.error(
      c('red', `Missing API token for ${options.target}. Pass --token or set ${envVarFor(options.target)}.`),
    );
    process.exit(1);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await safeText(res);
    console.error(c('red', `Publish failed (${res.status} ${res.statusText}): ${body}`));
    process.exit(1);
  }
  console.log(c('green', `Published "${skill.name}" to ${options.target}.`));
}

function renderTarget(target: PublishTarget, skill: PublishableSkill): { url: string; payload: unknown } {
  switch (target) {
    case 'smithery':
      return { url: SMITHERY_ENDPOINT, payload: buildSmitheryPayload(skill) };
    case 'glama':
      return { url: GLAMA_ENDPOINT, payload: buildGlamaPayload(skill) };
  }
}

function envTokenFor(target: PublishTarget): string | undefined {
  return process.env[envVarFor(target)];
}

function envVarFor(target: PublishTarget): string {
  return target === 'smithery' ? 'SMITHERY_TOKEN' : 'GLAMA_TOKEN';
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
