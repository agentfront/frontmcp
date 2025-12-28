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

// Generate ESM package.json with type:module and adjusted paths
const esmDir = path.join(path.dirname(pkgPath), 'esm');
if (fs.existsSync(esmDir)) {
  const esmPkg = JSON.parse(JSON.stringify(pkg)); // Deep clone

  // Add type: module for ESM
  esmPkg.type = 'module';

  // Adjust paths: ESM files stay relative (./), CJS/types go up one level (../)
  const adjustForEsm = (v) => {
    if (typeof v !== 'string') return v;
    // ESM files (.mjs) stay relative - they're in this folder
    if (v.endsWith('.mjs')) {
      return v.replace('./esm/', './');
    }
    // CJS/types files go up one level to parent dist folder
    if (v.startsWith('./')) {
      return '..' + v.slice(1);
    }
    return v;
  };

  // Fix top-level fields
  if (esmPkg.main) esmPkg.main = adjustForEsm(esmPkg.main);
  if (esmPkg.types) esmPkg.types = adjustForEsm(esmPkg.types);
  if (esmPkg.module) esmPkg.module = adjustForEsm(esmPkg.module);

  // Fix exports map recursively
  const walkEsm = (v) => {
    if (Array.isArray(v)) return v.map(walkEsm);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = walkEsm(val);
      }
      return out;
    }
    return adjustForEsm(v);
  };

  if (esmPkg.exports) {
    esmPkg.exports = walkEsm(esmPkg.exports);
  }

  // Fix bin paths if present
  if (esmPkg.bin) {
    esmPkg.bin = walkEsm(esmPkg.bin);
  }

  const esmPkgPath = path.join(esmDir, 'package.json');
  try {
    fs.writeFileSync(esmPkgPath, JSON.stringify(esmPkg, null, 2) + '\n');
    console.log(`✅ Generated ${esmPkgPath} with type:module and adjusted paths.`);
  } catch (err) {
    console.error(`❌ Error writing ESM package.json:`, err.message);
    process.exit(1);
  }
}
