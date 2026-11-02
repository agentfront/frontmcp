import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import * as path from 'node:path';

import * as ts from 'typescript';

import { fileExists, mkdir, readdir, readFile, readJSON } from '@frontmcp/utils';

export const WORKSPACE = path.resolve(__dirname, '../../../../..');

export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
}

export interface PublishedScript {
  path: string;
  source: string;
}

export interface PublishedPackage {
  manifest: PackageManifest;
  scripts: PublishedScript[];
}

export async function workspaceDistDirs(): Promise<Map<string, string>> {
  const distDirs = new Map<string, string>();
  for (const group of ['libs', 'plugins']) {
    for (const entry of await readdir(path.join(WORKSPACE, group))) {
      const manifest = await readJSON<PackageManifest>(path.join(WORKSPACE, group, entry, 'package.json'));
      if (manifest) distDirs.set(manifest.name, path.join(WORKSPACE, group, entry, 'dist'));
    }
  }
  return distDirs;
}

export async function builtDistDir(distDirs: Map<string, string>, name: string): Promise<string> {
  const distDir = distDirs.get(name);
  if (!distDir || !(await fileExists(path.join(distDir, 'package.json')))) {
    throw new Error(`${name} is not built: run its build target first`);
  }
  return distDir;
}

export function packPackage(distDir: string, destination: string): { tarball: string; files: string[] } {
  const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
    cwd: distDir,
    encoding: 'utf8',
  });
  const [result] = JSON.parse(output) as Array<{ filename: string; files: Array<{ path: string }> }>;
  return { tarball: path.join(destination, result.filename), files: result.files.map((file) => file.path) };
}

export async function readPublishedPackage(distDir: string, workDir: string): Promise<PublishedPackage> {
  const { tarball, files } = packPackage(distDir, workDir);
  const extracted = path.join(workDir, path.basename(tarball, '.tgz'));
  await mkdir(extracted, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', extracted]);
  const root = path.join(extracted, 'package');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'))) as PackageManifest;
  const scripts: PublishedScript[] = [];
  for (const file of files.filter((name) => /\.[cm]?js$/.test(name))) {
    scripts.push({ path: file, source: await readFile(path.join(root, file)) });
  }
  return { manifest, scripts };
}

// The @frontmcp packages npm installs with `names`: dependencies and non-optional peers, transitively
export async function internalClosure(names: readonly string[], distDirs: Map<string, string>): Promise<string[]> {
  const closure = new Set<string>();
  const pending = [...names];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || closure.has(name)) continue;
    closure.add(name);
    const manifest = await readJSON<PackageManifest>(path.join(await builtDistDir(distDirs, name), 'package.json'));
    const requiredPeers = Object.keys(manifest?.peerDependencies ?? {}).filter(
      (peer) => !manifest?.peerDependenciesMeta?.[peer]?.optional,
    );
    const installed = [...Object.keys(manifest?.dependencies ?? {}), ...requiredPeers];
    pending.push(...installed.filter((dependency) => dependency.startsWith('@frontmcp/')));
  }
  return [...closure].sort();
}

function parse(script: PublishedScript): ts.SourceFile {
  return ts.createSourceFile(script.path, script.source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
}

// esbuild's ESM output loads a CommonJS-only external through its `__require` shim
function isModuleLoad(callee: ts.Expression): boolean {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(callee) && (callee.text === 'require' || callee.text === '__require');
}

export function loadedSpecifiers(script: PublishedScript): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && isModuleLoad(node.expression)) {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first)) specifiers.push(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(script));
  return specifiers;
}

// undefined for relative paths, `#` imports, URLs and Node builtins
export function packageNameOf(specifier: string): string | undefined {
  if (/^[./#]/.test(specifier) || specifier.includes(':') || isBuiltin(specifier)) return undefined;
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

export function undeclaredImports(published: PublishedPackage): string[] {
  const { manifest } = published;
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const undeclared = new Set<string>();
  for (const script of published.scripts) {
    for (const specifier of loadedSpecifiers(script)) {
      const name = packageNameOf(specifier);
      if (name && !declared.has(name)) undeclared.add(`${script.path}: ${specifier}`);
    }
  }
  return [...undeclared].sort();
}

export function exportedNames(script: PublishedScript): Set<string> {
  const names = new Set<string>();
  for (const statement of parse(script).statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    }
  }
  return names;
}

function definedName(node: ts.Node): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isFunctionExpression(node.initializer) ||
      ts.isArrowFunction(node.initializer) ||
      ts.isClassExpression(node.initializer))
  ) {
    return node.name.text;
  }
  return undefined;
}

function definedNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = definedName(node);
    if (name) names.push(name);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

export function definitionsNamed(script: PublishedScript, names: ReadonlySet<string>): string[] {
  return definedNames(parse(script))
    .filter((name) => names.has(name))
    .map((name) => `${script.path}: ${name}`);
}

export async function sourceDefinitions(packageRoot: string): Promise<Set<string>> {
  const { config } = ts.readConfigFile(path.join(packageRoot, 'tsconfig.lib.json'), ts.sys.readFile);
  const { fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, packageRoot);
  const names = new Set<string>();
  for (const fileName of fileNames) {
    const sourceFile = ts.createSourceFile(fileName, await readFile(fileName), ts.ScriptTarget.Latest);
    for (const name of definedNames(sourceFile)) names.add(name);
  }
  return names;
}
