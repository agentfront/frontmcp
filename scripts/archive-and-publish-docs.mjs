#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Archive current docs and publish draft docs to live
 *
 * This script:
 * 1. Archives /docs/live/docs/* to /docs/live/docs/v/{previousMinor}/* (excluding v/ folder)
 * 2. Updates /docs/live/docs.json to add archived version
 * 3. Moves content from /docs/draft to /docs/live (replacing, not merging):
 *    - docs/draft/docs → docs/live/docs (excluding v/ folder)
 *    - docs/draft/blog → docs/live/blog
 *    - docs/draft/assets → docs/live/assets
 *    - docs/draft/snippets → docs/live/snippets
 *
 * Note: updates.mdx is NOT handled by this script. It is updated by Codex
 * in the codex-mintlify-docs workflow which intelligently merges the draft
 * update into the live updates.
 *
 * Usage: node scripts/archive-and-publish-docs.mjs <previous-minor> <new-minor>
 * Example: node scripts/archive-and-publish-docs.mjs 0.3 0.4
 */

const [, , previousMinor, newMinor] = process.argv;

if (!previousMinor || !newMinor) {
  console.error("Usage: node scripts/archive-and-publish-docs.mjs <previous-minor> <new-minor>");
  console.error("Example: node scripts/archive-and-publish-docs.mjs 0.3 0.4");
  process.exit(1);
}

// Validate version format (x.y)
if (!/^\d+\.\d+$/.test(previousMinor) || !/^\d+\.\d+$/.test(newMinor)) {
  console.error(`Invalid version format. Must be x.y (e.g., 0.3)`);
  process.exit(1);
}

const LIVE_ROOT = path.join(process.cwd(), "docs/live");
const DRAFT_ROOT = path.join(process.cwd(), "docs/draft");

/**
 * Recursively copy directory
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively remove directory
 */
async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if doesn't exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Check if directory exists
 */
async function dirExists(dir) {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get all entries in a directory (excluding specific items)
 */
async function getDirEntries(dir, exclude = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(entry => !exclude.includes(entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Step 1: Archive current docs to v/{previousMinor}
 */
async function archiveCurrentDocs() {
  console.log(`\n📦 Archiving current docs to v/${previousMinor}...\n`);

  const liveDocsDir = path.join(LIVE_ROOT, "docs");
  const archiveDir = path.join(LIVE_ROOT, "docs/v", previousMinor);

  // Check if live docs exist
  if (!await dirExists(liveDocsDir)) {
    console.log("⚠️  No live docs found to archive");
    return;
  }

  // Create archive directory
  await fs.mkdir(archiveDir, { recursive: true });

  // Get all entries in live docs except the 'v' folder
  const entries = await getDirEntries(liveDocsDir, ['v']);

  let archivedCount = 0;
  for (const entry of entries) {
    const srcPath = path.join(liveDocsDir, entry.name);
    const destPath = path.join(archiveDir, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      console.log(`  ✓ Archived directory: ${entry.name}`);
    } else {
      await fs.copyFile(srcPath, destPath);
      console.log(`  ✓ Archived file: ${entry.name}`);
    }
    archivedCount++;
  }

  console.log(`\n✅ Archived ${archivedCount} items to v/${previousMinor}\n`);
}

/**
 * Step 2: Update docs.json to add archived version
 */
async function updateDocsJson() {
  console.log(`📝 Updating docs.json...\n`);

  const docsJsonPath = path.join(LIVE_ROOT, "docs.json");

  try {
    const content = await fs.readFile(docsJsonPath, "utf8");
    const docs = JSON.parse(content);

    // Find Documentation dropdown
    const docDropdown = docs.navigation?.dropdowns?.find(d => d.dropdown === 'Documentation');

    if (!docDropdown || !docDropdown.versions) {
      console.log("⚠️  No Documentation dropdown with versions found in docs.json");
      return;
    }

    // Find current latest version
    const latestIndex = docDropdown.versions.findIndex(v => v.default === true);

    if (latestIndex === -1) {
      console.log("⚠️  No default version found in docs.json");
      return;
    }

    const oldLatest = docDropdown.versions[latestIndex];

    // Create archived version from old latest
    const archivedVersion = {
      version: `v${previousMinor}`,
      default: false,
      groups: JSON.parse(JSON.stringify(oldLatest.groups))
    };

    // Update paths in archived version to point to v/{previousMinor}
    function updatePathsToArchive(groups) {
      for (const group of groups) {
        if (group.tag === 'latest') {
          group.tag = `version ${previousMinor}`;
        }

        if (group.pages) {
          group.pages = group.pages.map(page => {
            if (typeof page === 'string') {
              // Don't update 'updates' path or paths already in v/
              if (page === 'updates' || page.startsWith('docs/v/')) {
                return page;
              }
              // Update docs/ paths to docs/v/{previousMinor}/
              if (page.startsWith('docs/')) {
                return page.replace('docs/', `docs/v/${previousMinor}/`);
              }
              return page;
            } else if (page.pages) {
              // Recursively update nested pages
              updatePathsToArchive([page]);
              return page;
            }
            return page;
          });
        }
      }
    }

    updatePathsToArchive(archivedVersion.groups);

    // Update old latest to new version
    oldLatest.version = `v${newMinor} (latest)`;
    oldLatest.default = true;

    // Restore paths in new latest to point to current docs (not archived)
    function restorePathsToCurrent(groups) {
      for (const group of groups) {
        if (group.tag === `version ${previousMinor}`) {
          group.tag = 'latest';
        }

        if (group.pages) {
          group.pages = group.pages.map(page => {
            if (typeof page === 'string') {
              // Update archived paths back to current
              if (page.startsWith(`docs/v/${previousMinor}/`)) {
                return page.replace(`docs/v/${previousMinor}/`, 'docs/');
              }
              return page;
            } else if (page.pages) {
              restorePathsToCurrent([page]);
              return page;
            }
            return page;
          });
        }
      }
    }

    restorePathsToCurrent(oldLatest.groups);

    // Add archived version after the latest
    docDropdown.versions.splice(latestIndex + 1, 0, archivedVersion);

    // Write updated docs.json
    await fs.writeFile(docsJsonPath, JSON.stringify(docs, null, 2) + "\n", "utf8");

    console.log(`  ✓ Added v${previousMinor} to versions`);
    console.log(`  ✓ Updated latest to v${newMinor}`);
    console.log(`\n✅ docs.json updated successfully\n`);

  } catch (error) {
    console.error(`❌ Error updating docs.json:`, error.message);
    throw error;
  }
}

/**
 * Step 3: Move content from draft to live (replace mode)
 */
async function publishDraftToLive() {
  console.log(`🚀 Publishing draft to live...\n`);

  const itemsToMove = ['docs', 'blog', 'assets', 'snippets'];
  let movedCount = 0;

  for (const item of itemsToMove) {
    const draftPath = path.join(DRAFT_ROOT, item);
    const livePath = path.join(LIVE_ROOT, item);

    if (!await dirExists(draftPath)) {
      console.log(`  ⊘ Skipping ${item} (not found in draft)`);
      continue;
    }

    // Remove existing live item (except v/ folder in docs)
    if (item === 'docs') {
      // For docs, preserve the v/ folder and only remove other content
      const entries = await getDirEntries(livePath, ['v']);
      for (const entry of entries) {
        await removeDir(path.join(livePath, entry.name));
      }
    } else {
      // For other items, remove completely
      await removeDir(livePath);
    }

    // Copy from draft to live
    if (item === 'docs') {
      // For docs, copy everything except v/ folder
      const entries = await getDirEntries(draftPath, ['v']);
      await fs.mkdir(livePath, { recursive: true });

      for (const entry of entries) {
        const srcPath = path.join(draftPath, entry.name);
        const destPath = path.join(livePath, entry.name);

        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    } else {
      await copyDir(draftPath, livePath);
    }

    console.log(`  ✓ Published ${item}`);
    movedCount++;
  }

  console.log(`\n✅ Published ${movedCount} items from draft to live\n`);
}

/**
 * Note: updates.mdx is NOT handled by this script
 * It is updated by Codex in the codex-mintlify-docs workflow
 * which intelligently merges the draft update into the live updates
 */

/**
 * Main execution
 */
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Archive and Publish Docs`);
  console.log(`  Previous: v${previousMinor} → New: v${newMinor}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Step 1: Archive current docs
    await archiveCurrentDocs();

    // Step 2: Update docs.json
    await updateDocsJson();

    // Step 3: Publish draft to live
    await publishDraftToLive();

    // Note: Step 4 (updates.mdx) is handled by Codex in codex-mintlify-docs workflow

    console.log(`${'='.repeat(60)}`);
    console.log(`  ✅ All steps completed successfully!`);
    console.log(`  Note: updates.mdx will be updated by Codex workflow`);
    console.log(`${'='.repeat(60)}\n`);

  } catch (error) {
    console.error(`\n❌ Fatal error:`, error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
