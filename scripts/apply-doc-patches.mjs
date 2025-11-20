#!/usr/bin/env node
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";

const [, , jsonPathArg] = process.argv;
if (!jsonPathArg) {
    console.error("Usage: node scripts/apply-doc-patches.mjs <patches.json>");
    process.exit(1);
}

const root = process.cwd();
const jsonPath = path.resolve(root, jsonPathArg);

function die(msg) {
    console.error("ERROR:", msg);
    process.exit(1);
}

function isAllowedPath(p) {
    const norm = p.replaceAll("\\", "/");
    return (
        /^docs\/.+\.(md|mdx)$/.test(norm) ||
        norm === "docs/docs.json" ||
        norm === "CHANGELOG.md" ||
        norm === "README.md" ||
        /^libs\/.+\/README\.md$/.test(norm)
    );
}

function prettySize(n) {
    return `${(n / 1024).toFixed(1)} KB`;
}

async function compileMdxOrThrow(_filePath, content) {
    const {compile} = await import("@mdx-js/mdx");
    // MDX compiler also handles plain Markdown, so this is fine for *.md and *.mdx
    await compile(content, {jsx: true, format: "mdx"});
}

async function writeFileSafe(p, content) {
    await fs.mkdir(path.dirname(p), {recursive: true});
    await fs.writeFile(p, content, "utf8");
}

(async () => {
    if (!fss.existsSync(jsonPath)) die(`Missing patches file: ${jsonPathArg}`);
    const raw = await fs.readFile(jsonPath, "utf8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        die(`Invalid JSON: ${e.message}`);
    }

    const patches = Array.isArray(parsed.patches) ? parsed.patches : [];
    if (!patches.length) {
        console.log("No patches to apply.");
        return;
    }

    const applied = [], rejected = [];
    for (const p of patches) {
        try {
            if (!p?.path || typeof p.content !== "string") throw new Error("bad patch shape");
            const rel = p.path.replaceAll("\\", "/");
            if (!isAllowedPath(rel)) throw new Error(`path not allowed: ${rel}`);

            const dest = path.resolve(root, rel);
            const size = Buffer.byteLength(p.content, "utf8");
            if (size > 500000) throw new Error(`file too large (${prettySize(size)})`);

            // Validate MDX/MD compiles (MD works with mdx compiler)
            await compileMdxOrThrow(dest, p.content);

            await writeFileSafe(dest, p.content);
            applied.push({path: rel, bytes: size, rationale: p.rationale || ""});
            console.log(`✓ updated ${rel} (${prettySize(size)})`);
        } catch (e) {
            rejected.push({path: p?.path, error: String(e.message || e)});
            console.log(`✗ rejected ${p?.path}: ${e.message || e}`);
        }
    }

    // Prettier
    try {
        if (applied.length > 0) {
            const {spawnSync} = await import("node:child_process");
            console.log("run prettier on \"docs/**/*.mdx\"")
            try {
                spawnSync("npx", ["prettier", "-w", "docs/**/*.mdx"], {stdio: "inherit"});
            } catch {
            }
            console.log("run prettier on \"docs/**/*.md\"")
            try {
                spawnSync("npx", ["prettier", "-w", "docs/**/*.md"], {stdio: "inherit"});
            } catch {
            }
            console.log("run prettier on \"CHANGELOG.md\"")
            try {
                spawnSync("npx", ["prettier", "-w", "CHANGELOG.md", "README.md",], {stdio: "inherit"});
            } catch {
            }
            console.log("run prettier on \"libs/**/README.md\"")
            try {
                spawnSync("npx", ["prettier", "-w", "libs/**/README.md"], {stdio: "inherit"});
            } catch {
            }
        }
    } catch {
    }

    const summary = [
        "# Codex docs patch summary",
        "",
        `Applied: ${applied.length}`,
        `Rejected: ${rejected.length}`,
        "",
        ...applied.map(a => `- **${a.path}** (${prettySize(a.bytes)})${a.rationale ? ` — ${a.rationale}` : ""}`),
        ...(rejected.length ? ["", "## Rejected", ...rejected.map(r => `- ${r.path}: ${r.error}`)] : []),
        ""
    ].join("\n");
    await fs.mkdir(".codex-docs", {recursive: true});
    await fs.writeFile(".codex-docs/apply.log", summary, "utf8");
    console.log(summary);
})().catch((e) => die(e.stack || e.message));
