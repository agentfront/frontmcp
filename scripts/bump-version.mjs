#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Bump version script for libraries
 * Usage: node scripts/bump-version.mjs <library-name> <bump-type>
 * Example: node scripts/bump-version.mjs json-schema-to-zod-v3 patch
 *
 * This script:
 * 1. Bumps the version of the specified library
 * 2. Updates all packages that depend on this library to use the new version
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

/**
 * Get all library directories in libs/
 */
async function getAllLibs() {
  const libsDir = path.join(process.cwd(), "libs");
  const entries = await fs.readdir(libsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Update dependencies in a package.json that reference the bumped library
 */
async function updateDependenciesInPackage(pkgPath, packageName, newVersion) {
  try {
    const content = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(content);
    let updated = false;

    for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (pkg[depType] && pkg[depType][packageName]) {
        const oldDep = pkg[depType][packageName];
        pkg[depType][packageName] = newVersion;
        updated = true;
        console.log(`  ✓ Updated ${depType}.${packageName}: ${oldDep} → ${newVersion} in ${path.basename(path.dirname(pkgPath))}`);
      }
    }

    if (updated) {
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    }

    return updated;
  } catch {
    // Package doesn't exist or can't be read, skip
    return false;
  }
}

const libPath = path.join(process.cwd(), "libs", libName, "package.json");

try {
  // Read current package.json
  const content = await fs.readFile(libPath, "utf8");
  const pkg = JSON.parse(content);

  const packageName = pkg.name;
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

  // Update dependencies in all other packages that reference this library
  console.log(`\nUpdating dependencies on ${packageName} across all packages...`);

  const allLibs = await getAllLibs();
  let updatedCount = 0;

  for (const lib of allLibs) {
    if (lib === libName) continue; // Skip the library we just bumped

    const otherPkgPath = path.join(process.cwd(), "libs", lib, "package.json");
    const wasUpdated = await updateDependenciesInPackage(otherPkgPath, packageName, newVersion);
    if (wasUpdated) updatedCount++;
  }

  // Also check root package.json
  const rootPkgPath = path.join(process.cwd(), "package.json");
  const rootUpdated = await updateDependenciesInPackage(rootPkgPath, packageName, newVersion);
  if (rootUpdated) updatedCount++;

  if (updatedCount > 0) {
    console.log(`✓ Updated ${updatedCount} package(s) with new dependency version`);
  } else {
    console.log(`  No other packages depend on ${packageName}`);
  }

  // Output the new version for use in workflows
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `new_version=${newVersion}\n`);
    await fs.appendFile(process.env.GITHUB_OUTPUT, `old_version=${oldVersion}\n`);
  }

} catch (error) {
  console.error(`Error bumping version for ${libName}:`, error.message);
  process.exit(1);
}
