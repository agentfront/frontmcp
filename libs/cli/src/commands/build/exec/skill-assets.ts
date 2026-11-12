/**
 * Skill asset staging — copies skill instruction files and resource directories
 * into a flat `_skills/` layout so they can be packaged alongside the compiled
 * server bundle.
 *
 * The flat layout (`<skill>--<file>` naming) is deliberate: skills often
 * reference files outside their own directory (e.g., `../../docs/guide.md`),
 * which would produce path-traversal issues if we preserved the original tree.
 *
 * Consumers (exec runner, MCPB stage) resolve paths via the emitted
 * `manifest.json` so they don't depend on the flat layout directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExtractedSkillAsset } from './cli-runtime/schema-extractor';

/**
 * Name of a skill's instructions under `_skills/`. Inline and URL-sourced skills have no
 * source file, so their content is staged as `<skill>--instructions.md`.
 */
export function stagedInstructionsName(asset: ExtractedSkillAsset): string | undefined {
  const skillName = stagedSkillName(asset.skillName);
  if (asset.instructionFile) return `${skillName}--${path.basename(asset.instructionFile)}`;
  if (asset.instructionContent) return `${skillName}--instructions.md`;
  return undefined;
}

/** Name of a skill's resource folder (`references`, `examples`, ...) under `_skills/`. */
export function stagedResourceDirName(skillName: string, kind: string): string {
  return `${stagedSkillName(skillName)}--${kind}`;
}

/** The skill name as part of one file name in `_skills/`: `%`, `/` and `\` are percent-encoded, so it cannot name another folder. */
function stagedSkillName(skillName: string): string {
  return skillName.replace(/%/g, '%25').replace(/\//g, '%2F').replace(/\\/g, '%5C');
}

export interface SkillAssetsResult {
  /** Absolute path to the created `_skills/` directory (empty string if no assets copied). */
  skillsDir: string;
  /** Total number of files/directories copied. */
  copiedCount: number;
}

/**
 * Copy skill instruction files + resource dirs into `{outDir}/_skills/` and
 * emit a manifest.json mapping each skill's assets back to their relative path.
 *
 * Safe to call with an empty list — returns `{ skillsDir: '', copiedCount: 0 }`
 * without creating anything.
 */
export function copySkillAssets(
  outDir: string,
  skillAssets: ExtractedSkillAsset[],
): SkillAssetsResult {
  if (skillAssets.length === 0) {
    return { skillsDir: '', copiedCount: 0 };
  }

  const skillsDir = path.join(outDir, '_skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const manifest: Record<
    string,
    { instructions?: string; references?: string; examples?: string; scripts?: string; assets?: string }
  > = {};
  let copiedCount = 0;

  for (const asset of skillAssets) {
    const entry: (typeof manifest)[string] = {};

    const stagedInstructions = stageInstructions(asset, skillsDir);
    if (stagedInstructions) {
      entry.instructions = stagedInstructions;
      copiedCount++;
    }

    if (asset.resourceDirs) {
      for (const [key, dirPath] of Object.entries(asset.resourceDirs)) {
        if (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const stagedDir = stagedResourceDirName(asset.skillName, key);
          fs.cpSync(dirPath, path.join(skillsDir, stagedDir), { recursive: true });
          entry[key as keyof typeof entry] = `_skills/${stagedDir}`;
          copiedCount++;
        }
      }
    }

    if (Object.keys(entry).length > 0) {
      manifest[asset.skillName] = entry;
    }
  }

  fs.writeFileSync(
    path.join(skillsDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  return { skillsDir, copiedCount };
}

function stageInstructions(asset: ExtractedSkillAsset, skillsDir: string): string | undefined {
  const stagedName = stagedInstructionsName(asset);
  if (!stagedName) return undefined;

  const dest = path.join(skillsDir, stagedName);
  if (asset.instructionFile) {
    if (!fs.existsSync(asset.instructionFile)) return undefined;
    fs.copyFileSync(asset.instructionFile, dest);
  } else {
    fs.writeFileSync(dest, asset.instructionContent ?? '');
  }
  return `_skills/${stagedName}`;
}
