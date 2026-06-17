/**
 * Unit tests for `buildFrontMcpConfigFromManifest` — the deterministic
 * projection of a parsed `frontmcp.deploy.yaml` onto FrontMCP config inputs.
 *
 * The function is pure over `server` / `specs` / `skills`, so tests build a
 * focused manifest slice (cast to DeployManifest — full-schema validity is
 * covered by the deploy-manifest.schema tests) and assert the mapping.
 */
import type { DeployManifest } from '../deploy/deploy-manifest.schema';
import { buildFrontMcpConfigFromManifest } from '../deploy/manifest-to-config';

type ManifestParts = {
  server: DeployManifest['server'];
  specs: DeployManifest['specs'];
  skills: DeployManifest['skills'];
};

const mk = (parts: ManifestParts): DeployManifest => parts as unknown as DeployManifest;

const baseServer = { info: { name: 'acme-mcp', version: '1.2.3' } } as DeployManifest['server'];
const baseSkills = { source: './skills/' } as DeployManifest['skills'];

describe('buildFrontMcpConfigFromManifest', () => {
  describe('server → info / instructions', () => {
    it('maps name + version, omits title when absent', () => {
      const cfg = buildFrontMcpConfigFromManifest(mk({ server: baseServer, specs: [], skills: baseSkills }));
      expect(cfg.info).toEqual({ name: 'acme-mcp', version: '1.2.3' });
      expect('title' in cfg.info).toBe(false);
      expect(cfg.instructions).toBeUndefined();
    });

    it('carries title + instructions when present', () => {
      const cfg = buildFrontMcpConfigFromManifest(
        mk({
          server: { info: { name: 'a', version: '1', title: 'Acme API' }, instructions: 'Be concise.' } as DeployManifest['server'],
          specs: [],
          skills: baseSkills,
        }),
      );
      expect(cfg.info).toEqual({ name: 'a', version: '1', title: 'Acme API' });
      expect(cfg.instructions).toBe('Be concise.');
    });
  });

  describe('skillsConfig', () => {
    it('always enables skills with append instruction policy', () => {
      const cfg = buildFrontMcpConfigFromManifest(mk({ server: baseServer, specs: [], skills: baseSkills }));
      expect(cfg.skillsConfig).toEqual({ enabled: true, injectInstructions: 'append' });
    });
  });

  describe('skills', () => {
    it('maps source and omits optional fields when absent', () => {
      const cfg = buildFrontMcpConfigFromManifest(mk({ server: baseServer, specs: [], skills: { source: './my-skills/' } as DeployManifest['skills'] }));
      expect(cfg.skills).toEqual({ source: './my-skills/' });
    });

    it('carries alwaysLoad and tag filter when present', () => {
      const cfg = buildFrontMcpConfigFromManifest(
        mk({
          server: baseServer,
          specs: [],
          skills: { source: './s/', alwaysLoad: ['intro'], tags: { include: ['prod'], exclude: ['beta'] } } as DeployManifest['skills'],
        }),
      );
      expect(cfg.skills).toEqual({ source: './s/', alwaysLoad: ['intro'], tags: { include: ['prod'], exclude: ['beta'] } });
    });
  });

  describe('specs normalization', () => {
    it('treats a single string as a spec directory (auto-discover)', () => {
      const cfg = buildFrontMcpConfigFromManifest(mk({ server: baseServer, specs: './openapi/', skills: baseSkills }));
      expect(cfg.specsDir).toBe('./openapi/');
      expect(cfg.specs).toEqual([]);
    });

    it('derives id + bindingName from the filename stem for bare string refs', () => {
      const cfg = buildFrontMcpConfigFromManifest(
        mk({ server: baseServer, specs: ['./specs/petstore.yaml', 'https://api.example.com/v1/openapi.json?ts=9'], skills: baseSkills }),
      );
      expect(cfg.specsDir).toBeUndefined();
      expect(cfg.specs).toEqual([
        { id: 'petstore', spec: './specs/petstore.yaml', bindingName: 'petstore' },
        { id: 'openapi', spec: 'https://api.example.com/v1/openapi.json?ts=9', bindingName: 'openapi' },
      ]);
    });

    it('passes detail objects through and defaults bindingName to id', () => {
      const cfg = buildFrontMcpConfigFromManifest(
        mk({
          server: baseServer,
          specs: [
            { id: 'billing', spec: './billing.yaml', baseUrl: 'https://billing.example.com' },
            { id: 'crm', spec: './crm.yaml', bindingName: 'salesforce' },
          ],
          skills: baseSkills,
        }),
      );
      expect(cfg.specs).toEqual([
        { id: 'billing', spec: './billing.yaml', baseUrl: 'https://billing.example.com', bindingName: 'billing' },
        { id: 'crm', spec: './crm.yaml', bindingName: 'salesforce' },
      ]);
    });

    it('sanitizes unsafe characters in a derived stem id', () => {
      const cfg = buildFrontMcpConfigFromManifest(mk({ server: baseServer, specs: ['./My Spec (v2).yaml'], skills: baseSkills }));
      expect(cfg.specs[0].id).toBe('My-Spec--v2-');
      expect(cfg.specs[0].spec).toBe('./My Spec (v2).yaml');
    });
  });
});
