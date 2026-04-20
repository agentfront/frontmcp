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

    if (asset.instructionFile && fs.existsSync(asset.instructionFile)) {
      const filename = path.basename(asset.instructionFile);
      const dest = path.join(skillsDir, `${asset.skillName}--${filename}`);
      fs.copyFileSync(asset.instructionFile, dest);
      entry.instructions = `_skills/${asset.skillName}--${filename}`;
      copiedCount++;
    }

    if (asset.resourceDirs) {
      for (const [key, dirPath] of Object.entries(asset.resourceDirs)) {
        if (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const destDir = path.join(skillsDir, `${asset.skillName}--${key}`);
          fs.cpSync(dirPath, destDir, { recursive: true });
          entry[key as keyof typeof entry] = `_skills/${asset.skillName}--${key}`;
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
