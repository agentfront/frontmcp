#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Bump version for all synchronized libraries
 * Usage: node scripts/bump-synchronized-versions.mjs <new-version>
 * Example: node scripts/bump-synchronized-versions.mjs 0.4.0
 */

const [, , newVersion] = process.argv;

if (!newVersion) {
  console.error("Usage: node scripts/bump-synchronized-versions.mjs <new-version>");
  console.error("Example: node scripts/bump-synchronized-versions.mjs 0.4.0");
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Invalid version format: ${newVersion}. Must be semver (e.g., 0.4.0)`);
  process.exit(1);
}

async function getSynchronizedLibs() {
  try {
    const output = execSync(
      'npx nx show projects -p tag:versioning:synchronized --type lib --json',
      { encoding: 'utf8' }
    );
    return JSON.parse(output);
  } catch (error) {
    console.error("Error fetching synchronized libraries:", error.message);
    process.exit(1);
  }
}

async function updateLibVersion(libName, newVersion) {
  const libPath = path.join(process.cwd(), "libs", libName, "package.json");

  try {
    const content = await fs.readFile(libPath, "utf8");
    const pkg = JSON.parse(content);

    const oldVersion = pkg.version;
    pkg.version = newVersion;

    await fs.writeFile(libPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

    console.log(`✓ Updated ${libName} from ${oldVersion} to ${newVersion}`);
    return { libName, oldVersion, newVersion };
  } catch (error) {
    console.error(`✗ Error updating ${libName}:`, error.message);
    return null;
  }
}

async function updateRootVersion(newVersion) {
  const rootPath = path.join(process.cwd(), "package.json");

  try {
    const content = await fs.readFile(rootPath, "utf8");
    const pkg = JSON.parse(content);

    const oldVersion = pkg.version;
    pkg.version = newVersion;

    await fs.writeFile(rootPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

    console.log(`✓ Updated root package.json from ${oldVersion} to ${newVersion}`);
  } catch (error) {
    console.error(`✗ Error updating root package.json:`, error.message);
  }
}

async function updateDependencies(libs, newVersion) {
  console.log("\nUpdating internal dependencies...");

  for (const libName of libs) {
    const libPath = path.join(process.cwd(), "libs", libName, "package.json");

    try {
      const content = await fs.readFile(libPath, "utf8");
      const pkg = JSON.parse(content);

      let updated = false;

      // Update dependencies
      for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
        if (pkg[depType]) {
          for (const dep of libs) {
            const depPkgPath = path.join(process.cwd(), "libs", dep, "package.json");
            const depPkg = JSON.parse(await fs.readFile(depPkgPath, "utf8"));
            const depName = depPkg.name;

            if (pkg[depType][depName]) {
              pkg[depType][depName] = newVersion;
              updated = true;
            }
          }
        }
      }

      if (updated) {
        await fs.writeFile(libPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        console.log(`✓ Updated dependencies in ${libName}`);
      }
    } catch (error) {
      console.error(`✗ Error updating dependencies in ${libName}:`, error.message);
    }
  }
}

async function main() {
  console.log(`Bumping all synchronized libraries to version ${newVersion}...\n`);

  const libs = await getSynchronizedLibs();

  if (!libs || libs.length === 0) {
    console.log("No synchronized libraries found.");
    return;
  }

  console.log(`Found ${libs.length} synchronized libraries: ${libs.join(", ")}\n`);

  // Update all library versions
  const results = [];
  for (const lib of libs) {
    const result = await updateLibVersion(lib, newVersion);
    if (result) results.push(result);
  }

  // Update root package.json
  await updateRootVersion(newVersion);

  // Update internal dependencies
  await updateDependencies(libs, newVersion);

  console.log(`\n✅ Successfully bumped ${results.length} synchronized libraries to ${newVersion}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
