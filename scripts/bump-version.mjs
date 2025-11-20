#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Bump version script for libraries
 * Usage: node scripts/bump-version.mjs <library-name> <bump-type>
 * Example: node scripts/bump-version.mjs json-schema-to-zod-v3 patch
 */

const [, , libName, bumpType] = process.argv;

if (!libName || !bumpType) {
  console.error("Usage: node scripts/bump-version.mjs <library-name> <bump-type>");
  console.error("Bump types: major, minor, patch");
  process.exit(1);
}

if (!["major", "minor", "patch"].includes(bumpType)) {
  console.error(`Invalid bump type: ${bumpType}. Must be: major, minor, or patch`);
  process.exit(1);
}

const libPath = path.join(process.cwd(), "libs", libName, "package.json");

try {
  // Read current package.json
  const content = await fs.readFile(libPath, "utf8");
  const pkg = JSON.parse(content);

  const oldVersion = pkg.version;
  if (!oldVersion) {
    console.error(`No version found in ${libPath}`);
    process.exit(1);
  }

  // Parse version
  const [major, minor, patch] = oldVersion.split(".").map(Number);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    console.error(`Invalid semver format in ${libPath}: ${oldVersion}`);
    process.exit(1);
  }

  // Bump version
  let newVersion;
  switch (bumpType) {
    case "major":
      newVersion = `${major + 1}.0.0`;
      break;
    case "minor":
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case "patch":
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
  }

  pkg.version = newVersion;

  // Write updated package.json
  await fs.writeFile(libPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  console.log(`✓ Bumped ${libName} from ${oldVersion} to ${newVersion}`);

  // Output the new version for use in workflows
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `new_version=${newVersion}\n`);
    await fs.appendFile(process.env.GITHUB_OUTPUT, `old_version=${oldVersion}\n`);
  }

} catch (error) {
  console.error(`Error bumping version for ${libName}:`, error.message);
  process.exit(1);
}
