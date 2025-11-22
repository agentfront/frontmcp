#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Remove draft attributes from BlogCard components in docs
 *
 * This script scans all .mdx and .md files in docs/ and removes
 * the 'draft' prop from BlogCard components to make them visible in production.
 *
 * Usage: node scripts/remove-blog-drafts.mjs
 */

const DOCS_ROOT = path.join(process.cwd(), "docs");

/**
 * Recursively find all .mdx and .md files
 */
async function findDocFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await findDocFiles(fullPath, files);
    } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Remove draft attributes from BlogCard components in content
 */
function removeDraftAttributes(content) {
  // Pattern to match BlogCard with draft prop
  // Handles: draft={true}, draft={false}, draft="true", draft="false", draft
  const draftPattern = /(<BlogCard[^>]*?)\s+draft(?:=(?:\{(?:true|false)\}|"(?:true|false)"))?/g;

  return content.replace(draftPattern, '$1');
}

/**
 * Process a single file
 */
async function processFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");

    // Check if file contains draft attributes
    if (!content.includes('draft')) {
      return { processed: false, changed: false };
    }

    const updatedContent = removeDraftAttributes(content);

    if (updatedContent !== content) {
      await fs.writeFile(filePath, updatedContent, "utf8");
      return { processed: true, changed: true };
    }

    return { processed: true, changed: false };

  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return { processed: false, changed: false, error: error.message };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Remove Draft Attributes from Blog Cards");
  console.log("=".repeat(60) + "\n");

  try {
    // Find all doc files
    console.log("🔍 Scanning for .mdx and .md files...\n");
    const files = await findDocFiles(DOCS_ROOT);
    console.log(`Found ${files.length} files to scan\n`);

    if (files.length === 0) {
      console.log("No files found to process");
      return;
    }

    // Process each file
    console.log("🔧 Processing files...\n");
    const results = await Promise.all(files.map(processFile));

    const changed = results.filter(r => r.changed).length;
    const processed = results.filter(r => r.processed).length;
    const errors = results.filter(r => r.error).length;

    console.log("\n" + "=".repeat(60));
    console.log(`  Results:`);
    console.log(`  - Files scanned: ${files.length}`);
    console.log(`  - Files processed: ${processed}`);
    console.log(`  - Files changed: ${changed}`);
    if (errors > 0) {
      console.log(`  - Errors: ${errors}`);
    }
    console.log("=".repeat(60) + "\n");

    if (changed > 0) {
      console.log("✅ Draft attributes removed successfully\n");
    } else {
      console.log("ℹ️  No draft attributes found to remove\n");
    }

  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main();
