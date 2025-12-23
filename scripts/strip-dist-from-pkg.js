const fs = require('fs');
const path = require('path');

const pkgPath = process.argv[2] || path.resolve(process.cwd(), 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.error(`❌ Error: package.json not found at ${pkgPath}`);
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
} catch (err) {
  console.error(`❌ Error reading or parsing ${pkgPath}:`, err.message);
  process.exit(1);
}

const stripDist = (v) => (typeof v === 'string' ? v.replace(/^\.\/dist\//, './') : v);

const walk = (v) => {
  if (Array.isArray(v)) {
    const arr = v.map(walk).filter((x) => x !== undefined);
    return arr.length ? arr : undefined;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'development') continue; // drop "development" condition
      const w = walk(val);
      if (w !== undefined) out[k] = w; // prune empties
    }
    return Object.keys(out).length ? out : undefined;
  }
  return stripDist(v);
};

// Fix top-level fields
if (pkg.main) pkg.main = stripDist(pkg.main);
if (pkg.types) pkg.types = stripDist(pkg.types);
if (pkg.module) pkg.module = stripDist(pkg.module);

// Fix exports map deeply (strip "./dist/" + remove "development")
if (pkg.exports) {
  const cleaned = walk(pkg.exports);
  if (cleaned !== undefined) pkg.exports = cleaned;
  else delete pkg.exports;
}

// Fix bin map deeply (strip "./dist/")
if (pkg.bin) {
  const cleaned = walk(pkg.bin);
  if (cleaned !== undefined) pkg.bin = cleaned;
  else delete pkg.bin;
}

delete pkg.scripts;

try {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Rewrote ${pkgPath}: removed "./dist/" and stripped "development" conditions from exports.`);
} catch (err) {
  console.error(`❌ Error writing ${pkgPath}:`, err.message);
  process.exit(1);
}

// Also handle ESM subfolder - it only needs { "type": "module" }
const distDir = path.dirname(pkgPath);
const esmPkgPath = path.join(distDir, 'esm', 'package.json');

if (fs.existsSync(esmPkgPath)) {
  try {
    const esmPkg = { type: 'module' };
    fs.writeFileSync(esmPkgPath, JSON.stringify(esmPkg, null, 2) + '\n');
    console.log(`✅ Rewrote ${esmPkgPath}: set { "type": "module" } for ESM output.`);
  } catch (err) {
    console.error(`❌ Error writing ${esmPkgPath}:`, err.message);
    // Non-fatal - continue even if esm package.json update fails
  }
}
