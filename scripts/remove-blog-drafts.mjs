#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Remove draft attributes from BlogCard components
 * This script finds all BlogCard components with draft attributes and removes them
 * Usage: node scripts/remove-blog-drafts.mjs
 */

const DOCS_DIR = path.join(process.cwd(), "docs");

async function findBlogFiles(dir = DOCS_DIR) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function removeDraftFromFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");

    // Check if file contains BlogCard with draft
    if (!content.includes("BlogCard") || !content.includes("draft")) {
      return { modified: false };
    }

    let modified = false;
    let newContent = content;

    // Pattern 1: Remove standalone "draft" attribute (on its own line or inline)
    // Matches: draft, draft={true}, or draft={false}
    // Handles cases with various whitespace configurations
    const patterns = [
      // Pattern for draft on its own line with any whitespace
      /^(\s*)(draft\s*(?:=\s*\{?\s*(?:true|false)\s*\}?)?\s*)\n/gm,
      // Pattern for draft inline (with space before and after)
      /\s+(draft\s*(?:=\s*\{?\s*(?:true|false)\s*\}?)?\s*)\s+/g,
      // Pattern for draft at the end (before closing tag or next prop)
      /\s+(draft\s*(?:=\s*\{?\s*(?:true|false)\s*\}?)?\s*)(\s*(?:>|\w))/g,
    ];

    for (const pattern of patterns) {
      const before = newContent;
      if (pattern.source.includes('^')) {
        // For line-based patterns, remove the entire line
        newContent = newContent.replace(pattern, '');
      } else if (pattern.source.includes('(\\s*(?:>|\\w))')) {
        // For patterns at the end, keep the following character
        newContent = newContent.replace(pattern, '$2');
      } else {
        // For inline patterns, keep single space
        newContent = newContent.replace(pattern, ' ');
      }

      if (before !== newContent) {
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(filePath, newContent, "utf8");
      return { modified: true, file: path.relative(DOCS_DIR, filePath) };
    }

    return { modified: false };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return { modified: false, error: error.message };
  }
}

async function main() {
  console.log("🔍 Searching for BlogCard components with draft attributes...\n");

  const files = await findBlogFiles();
  console.log(`Found ${files.length} MDX files to check\n`);

  const results = {
    modified: [],
    unchanged: [],
    errors: [],
  };

  for (const file of files) {
    const result = await removeDraftFromFile(file);

    if (result.error) {
      results.errors.push({ file, error: result.error });
    } else if (result.modified) {
      results.modified.push(result.file);
      console.log(`✓ Removed draft from: ${result.file}`);
    } else {
      results.unchanged.push(path.relative(DOCS_DIR, file));
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("Summary:");
  console.log("=".repeat(50));
  console.log(`✓ Modified: ${results.modified.length}`);
  console.log(`- Unchanged: ${results.unchanged.length}`);
  console.log(`✗ Errors: ${results.errors.length}`);

  if (results.modified.length > 0) {
    console.log("\nModified files:");
    results.modified.forEach(file => console.log(`  - ${file}`));
  }

  if (results.errors.length > 0) {
    console.log("\nErrors:");
    results.errors.forEach(({ file, error }) => console.log(`  - ${file}: ${error}`));
  }

  console.log("\n✅ Done!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
