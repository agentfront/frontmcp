const fs = require('fs');
const path = require('path');

const pkgPath = process.argv[2] || path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const stripDist = (v) =>
    typeof v === 'string' ? v.replace(/^\.\/dist\//, './') : v;

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
            if (w !== undefined) out[k] = w;   // prune empties
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

try {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(
        `✅ Rewrote ${pkgPath}: removed "./dist/" and stripped "development" conditions from exports.`
    );
} catch (err) {
    console.error(`❌ Error writing ${pkgPath}:`, err.message);
    process.exit(1);
}