/** How a lazy app boots: from a manifest, eagerly in development without one, and refused when it cannot be lazy. */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { App, Job, JobContext, LogLevel, Skill, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';
import { LazyAppConfigurationError } from '../../errors';
import { buildManifest } from '../../manifest/build-manifest';
import { SERVER_MANIFEST_FILE, type ServerManifest } from '../../manifest/server-manifest.schema';
import { normalizeApp } from '../app.utils';
import { BillingApp, billingImport, capturedLogs, lazyServer } from './lazy-app.fixtures';

async function boot(config: FrontMcpConfigInput) {
  const client = await connect(config);
  await client.close();
}

function infoLines(): string[] {
  return capturedLogs.filter(({ level }) => level === LogLevel.Info).map(({ message }) => message);
}

function withNodeEnv<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = value;
  return run().finally(() => {
    process.env['NODE_ENV'] = previous;
  });
}

afterEach(() => {
  capturedLogs.length = 0;
});

describe('lazy app config', () => {
  it('normalizes a lazy app to a record that joins the server scope', () => {
    const lazy = billingImport();
    const record = normalizeApp({ name: 'Billing', id: 'billing', lazy });

    expect(record).toEqual(
      expect.objectContaining({
        kind: 'LAZY_IMPORT',
        metadata: expect.objectContaining({ id: 'billing', name: 'Billing', lazy, standalone: false }),
      }),
    );
    expect(lazy).not.toHaveBeenCalled();
  });

  it.each([
    [{ lazy: billingImport() }, /name/],
    [{ name: 'Billing', lazy: 'nope' }, /lazy/],
    [{ name: 'Billing', lazy: billingImport(), tools: [] }, /tools/],
    [{ name: 'Billing', lazy: billingImport(), enabled: 'yes' }, /enabled/],
  ])('refuses an invalid lazy app config %#', (config, message) => {
    expect(() => normalizeApp(config as never)).toThrow(LazyAppConfigurationError);
    expect(() => normalizeApp(config as never)).toThrow(message);
  });
});

describe('a lazy app without a manifest', () => {
  it('is loaded at startup in development, with one log line', async () => {
    const lazy = billingImport();
    const client = await connect(lazyServer(lazy));

    expect(lazy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await client.listTools())).toContain('charge');
    await client.close();
    expect(infoLines().filter((line) => line.includes(SERVER_MANIFEST_FILE))).toEqual([
      expect.stringMatching(/No frontmcp\.manifest\.json .*lazy apps are loaded at startup.*frontmcp build/),
    ]);
  });

  it('stops a production server from starting, with a remedy', async () => {
    const lazy = billingImport();

    await withNodeEnv('production', async () => {
      await expect(boot(lazyServer(lazy))).rejects.toThrow(LazyAppConfigurationError);
      await expect(boot(lazyServer(lazy))).rejects.toThrow(
        /App "billing" is lazy.*frontmcp\.manifest\.json.*Run `frontmcp build`/,
      );
    });
    expect(lazy).not.toHaveBeenCalled();
  });

  it('is never loaded when its enabled is false', async () => {
    const lazy = billingImport();

    await boot(lazyServer(lazy, {}, { enabled: false }));

    expect(lazy).not.toHaveBeenCalled();
  });
});

describe('the manifest of a lazy app', () => {
  it('is built by importing the app, as frontmcp build does', async () => {
    const lazy = billingImport();

    const manifest = await buildManifest(lazyServer(lazy));

    expect(lazy).toHaveBeenCalledTimes(1);
    expect(manifest.apps).toContainEqual(expect.objectContaining({ id: 'billing', name: 'Billing' }));
    expect(manifest.tools.find((tool) => tool.name === 'charge')).toEqual(
      expect.objectContaining({ app: 'billing', owner: 'app:billing', aliases: ['billing.charge'] }),
    );
  });

  it("records the entries' own switches, not the lazy app's", async () => {
    const manifest = await buildManifest(lazyServer(billingImport(), {}, { enabled: false }));

    expect(manifest.tools.find((tool) => tool.name === 'charge')).not.toHaveProperty('enabled');
    expect(manifest.tools.find((tool) => tool.name === 'invoice_export')).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('is read from the path in @FrontMcp({ manifest })', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lazy-app-manifest-'));
    try {
      const file = path.join(dir, SERVER_MANIFEST_FILE);
      await writeFile(file, JSON.stringify(await buildManifest(lazyServer(billingImport()))));
      const lazy = billingImport();

      await withNodeEnv('production', () => boot(lazyServer(lazy, { manifest: file })));

      expect(lazy).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is found next to the server's entry script", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lazy-app-entry-'));
    const entry = process.argv[1];
    try {
      await writeFile(
        path.join(dir, SERVER_MANIFEST_FILE),
        JSON.stringify(await buildManifest(lazyServer(billingImport()))),
      );
      process.argv[1] = path.join(dir, 'main.js');
      const lazy = billingImport();

      await withNodeEnv('production', () => boot(lazyServer(lazy)));

      expect(lazy).not.toHaveBeenCalled();
    } finally {
      process.argv[1] = entry;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a manifest that is not a frontmcp.manifest.json', async () => {
    const config = lazyServer(billingImport(), { manifest: { manifestVersion: 99 } as unknown as ServerManifest });

    await expect(boot(config)).rejects.toThrow(/manifest/);
  });

  it('refuses a lazy app the manifest lists with skills', async () => {
    const manifest = await buildManifest(lazyServer(billingImport()));
    const withSkill: ServerManifest = {
      ...manifest,
      skills: [
        {
          name: 'refunds',
          owner: 'app:billing',
          app: 'billing',
          path: 'refunds',
          description: 'Refunds',
          visibility: 'both',
          tools: [],
        },
      ],
    };

    await expect(boot(lazyServer(billingImport(), { manifest: withSkill }))).rejects.toThrow(
      /App "billing" cannot be lazy: .*skill "refunds"/,
    );
  });
});

@Skill({ name: 'refunds', description: 'How to refund', instructions: 'Refund within 30 days.' })
class RefundsSkill {}

@Job({ name: 'nightly', inputSchema: {}, outputSchema: {} })
class NightlyJob extends JobContext {
  async execute() {
    return {};
  }
}

@Tool({ name: 'gated', inputSchema: { reason: z.string() }, authorities: 'admin' })
class GatedTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'live', inputSchema: {}, enabled: { get: () => true, subscribe: () => () => undefined } })
class LiveTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

describe('an app that cannot be lazy', () => {
  it.each([
    ['skills', { skills: [RefundsSkill] }, /skills/],
    ['jobs', { jobs: [NightlyJob] }, /jobs/],
    ['its own auth', { auth: { mode: 'public' } }, /auth/],
    ['a standalone scope', { standalone: true }, /standalone/],
    ['an entry with authorities', { tools: [GatedTool] }, /tool "gated".*authorities/],
    ['an entry with its own enabled source', { tools: [LiveTool] }, /tool "live".*enabled/],
  ])('fails startup when it declares %s', async (_what, extra, message) => {
    @App({ id: 'billing', name: 'Billing', ...extra })
    class UnsupportedApp {}

    const failure = connect(lazyServer(billingImport({ UnsupportedApp })));

    await expect(failure).rejects.toThrow(LazyAppConfigurationError);
    await expect(failure).rejects.toThrow(message);
  });

  it('fails startup when the import is not an @App class', async () => {
    await expect(connect(lazyServer(billingImport({ notAnApp: 1 })))).rejects.toThrow(
      /App "billing": the lazy import resolved to no @App class/,
    );
  });

  it('fails startup when the imported app has another id', async () => {
    @App({ id: 'payments', name: 'Payments' })
    class PaymentsApp {}

    await expect(connect(lazyServer(billingImport({ default: PaymentsApp })))).rejects.toThrow(
      /App "billing".*imported app "payments"/,
    );
  });

  it('accepts a module whose default export is the app', async () => {
    const client = await connect(lazyServer(billingImport({ default: BillingApp })));

    expect(JSON.stringify(await client.listTools())).toContain('charge');
    await client.close();
  });
});
