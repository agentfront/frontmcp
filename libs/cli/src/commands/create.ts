import * as path from 'path';
import { promises as fsp } from 'fs';
import { c } from '../colors';
import { ensureDir, fileExists, isDirEmpty, writeJSON } from '../utils/fs';
import { runInit } from '../tsconfig';
import { getSelfVersion } from '../version';
import { readJSON } from '../utils/fs';

function sanitizeForFolder(name: string): string {
  const seg = name.startsWith('@') && name.includes('/') ? name.split('/')[1] : name;
  return (
    seg
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'frontmcp-app'
  );
}

function sanitizeForNpm(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    const [scope, pkg] = name.split('/');
    const s = scope.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const p = pkg.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
    return `@${s}/${p || 'frontmcp-app'}`;
  }
  return name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase() || 'frontmcp-app';
}

function pkgNameFromCwd(cwd: string) {
  return (
    path
      .basename(cwd)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .toLowerCase() || 'frontmcp-app'
  );
}

async function upsertPackageJson(cwd: string, nameOverride: string | undefined, selfVersion: string) {
  const pkgPath = path.join(cwd, 'package.json');
  const existing = await readJSON<Record<string, any>>(pkgPath);

  const frontmcpLibRange = `^${selfVersion}`;

  const base = {
    name: nameOverride ?? pkgNameFromCwd(cwd),
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    main: 'src/main.ts',
    scripts: {
      dev: 'frontmcp dev',
      build: 'frontmcp build',
      inspect: 'frontmcp inspector',
      doctor: 'frontmcp doctor',
    },
    engines: {
      node: '>=22',
      npm: '>=10',
    },
    dependencies: {
      '@frontmcp/sdk': frontmcpLibRange,
      '@frontmcp/plugins': frontmcpLibRange,
      '@frontmcp/adapters': frontmcpLibRange,
      zod: '^3.25.76',
      'reflect-metadata': '^0.2.2',
    },
    devDependencies: {
      frontmcp: selfVersion,
      tsx: '^4.20.6',
      '@types/node': '^22.0.0',
      typescript: '^5.5.3',
    },
  };

  if (!existing) {
    await writeJSON(pkgPath, base);
    console.log(c('green', '✅ Created package.json (synced @frontmcp libs to CLI version + exact frontmcp)'));
    return;
  }

  const merged: any = { ...base, ...existing };

  merged.name = existing.name || base.name;
  merged.main = existing.main || base.main;
  merged.type = existing.type || base.type;

  merged.scripts = {
    ...base.scripts,
    ...(existing.scripts || {}),
    dev: existing.scripts?.dev ?? base.scripts.dev,
    build: existing.scripts?.build ?? base.scripts.build,
    inspect: existing.scripts?.inspect ?? base.scripts.inspect,
    doctor: existing.scripts?.doctor ?? base.scripts.doctor,
  };

  merged.engines = {
    ...(existing.engines || {}),
    node: existing.engines?.node || base.engines.node,
    npm: existing.engines?.npm || base.engines.npm,
  };

  merged.dependencies = {
    ...(existing.dependencies || {}),
    ...base.dependencies,
    '@frontmcp/sdk': frontmcpLibRange,
    '@frontmcp/plugins': frontmcpLibRange,
    '@frontmcp/adapters': frontmcpLibRange,
    zod: '^3.25.76',
    'reflect-metadata': '^0.2.2',
  };

  merged.devDependencies = {
    ...(existing.devDependencies || {}),
    ...base.devDependencies,
    frontmcp: selfVersion,
    tsx: '^4.20.6',
    typescript: '^5.5.3',
  };

  await writeJSON(pkgPath, merged);
  console.log(c('green', '✅ Updated package.json (synced @frontmcp libs + frontmcp to current CLI version)'));
}

async function scaffoldFileIfMissing(baseDir: string, p: string, content: string) {
  if (await fileExists(p)) {
    console.log(c('gray', `skip: ${path.relative(baseDir, p)} already exists`));
    return;
  }
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, content.replace(/^\n/, ''), 'utf8');
  console.log(c('green', `✓ created ${path.relative(baseDir, p)}`));
}

const TEMPLATE_MAIN_TS = `
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { CalcApp } from './calc.app';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [CalcApp],
})
export default class Server {}
`;

const TEMPLATE_CALC_APP_TS = `
import { App } from '@frontmcp/sdk';
import AddTool from './tools/add.tool';

@App({
  id: 'calc',
  name: 'Calculator',
  tools: [AddTool],
})
export class CalcApp {}
`;

const TEMPLATE_ADD_TOOL_TS = `
import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: {a: z.number(), b: z.number()},
  outputSchema: {result: z.number()}
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number, b: number }) {
    return {
      result: input.a + input.b,
    };
  }
}
`;

export async function runCreate(projectArg?: string): Promise<void> {
  if (!projectArg) {
    console.error(c('red', 'Error: project name is required.\n'));
    console.log(`Usage: ${c('bold', 'npx frontmcp create <project-name>')}`);
    process.exit(1);
  }

  const folder = sanitizeForFolder(projectArg);
  const pkgName = sanitizeForNpm(projectArg);
  const targetDir = path.resolve(process.cwd(), folder);

  try {
    const stat = await fsp.stat(targetDir);
    if (!stat.isDirectory()) {
      console.error(
        c('red', `Refusing to scaffold into non-directory path: ${path.relative(process.cwd(), targetDir)}`),
      );
      console.log(c('gray', 'Pick a different project name or remove/rename the existing file.'));
      process.exit(1);
    }
    if (!(await isDirEmpty(targetDir))) {
      console.error(
        c('red', `Refusing to scaffold into non-empty directory: ${path.relative(process.cwd(), targetDir)}`),
      );
      console.log(c('gray', 'Pick a different name or start with an empty folder.'));
      process.exit(1);
    }
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      await ensureDir(targetDir);
    } else {
      throw e;
    }
  }

  console.log(
    `${c('cyan', '[create]')} Creating project in ${c('bold', './' + path.relative(process.cwd(), targetDir))}`,
  );
  process.chdir(targetDir);

  await runInit(targetDir);

  const selfVersion = getSelfVersion();
  await upsertPackageJson(targetDir, pkgName, selfVersion);

  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'main.ts'), TEMPLATE_MAIN_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'calc.app.ts'), TEMPLATE_CALC_APP_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'tools', 'add.tool.ts'), TEMPLATE_ADD_TOOL_TS);

  console.log('\nNext steps:');
  console.log(`  1) cd ${folder}`);
  console.log('  2) npm install');
  console.log('  3) npm run dev     ', c('gray', '# tsx watcher + async tsc type-check'));
  console.log('  4) npm run inspect ', c('gray', '# launch MCP Inspector'));
  console.log('  5) npm run build   ', c('gray', '# compile with tsc via frontmcp build'));
}
