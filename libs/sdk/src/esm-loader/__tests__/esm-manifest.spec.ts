import 'reflect-metadata';
import { normalizeEsmExport, frontMcpPackageManifestSchema } from '../esm-manifest';
import {
  FrontMcpToolTokens,
  FrontMcpResourceTokens,
  FrontMcpPromptTokens,
  FrontMcpSkillTokens,
  FrontMcpJobTokens,
  FrontMcpAgentTokens,
  FrontMcpWorkflowTokens,
} from '../../common';
import { extendedToolMetadata } from '../../common/tokens';

/** Helper: simulate @Tool decorator metadata on a class */
function simulateTool(cls: { new (...args: unknown[]): unknown }, name: string) {
  Reflect.defineMetadata(FrontMcpToolTokens.type, true, cls);
  Reflect.defineMetadata(FrontMcpToolTokens.name, name, cls);
  Reflect.defineMetadata(extendedToolMetadata, {}, cls);
}

/** Helper: simulate @Resource decorator metadata on a class */
function simulateResource(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpResourceTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpResourceTokens.name, name, cls);
}

/** Helper: simulate @Prompt decorator metadata on a class */
function simulatePrompt(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpPromptTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpPromptTokens.name, name, cls);
}

/** Helper: simulate @Skill decorator metadata on a class */
function simulateSkill(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpSkillTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpSkillTokens.name, name, cls);
}

/** Helper: simulate @Job decorator metadata on a class */
function simulateJob(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpJobTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpJobTokens.name, name, cls);
}

/** Helper: simulate @Agent decorator metadata on a class */
function simulateAgent(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpAgentTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpAgentTokens.name, name, cls);
}

/** Helper: simulate @Workflow decorator metadata on a class */
function simulateWorkflow(cls: { new (...args: unknown[]): unknown }, name?: string) {
  Reflect.defineMetadata(FrontMcpWorkflowTokens.type, true, cls);
  if (name) Reflect.defineMetadata(FrontMcpWorkflowTokens.name, name, cls);
}

describe('normalizeEsmExport', () => {
  describe('plain manifest object via default export', () => {
    it('should normalize a valid manifest from default export', () => {
      const moduleExport = {
        default: {
          name: '@acme/tools',
          version: '1.0.0',
          description: 'Test tools',
          tools: [{ name: 'my-tool', execute: jest.fn() }],
        },
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('@acme/tools');
      expect(result.version).toBe('1.0.0');
      expect(result.tools).toHaveLength(1);
    });

    it('should handle manifest without optional fields', () => {
      const moduleExport = {
        default: {
          name: 'minimal',
          version: '0.1.0',
        },
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('minimal');
      expect(result.version).toBe('0.1.0');
      expect(result.tools).toBeUndefined();
    });
  });

  describe('named exports', () => {
    it('should collect named exports into a manifest', () => {
      const moduleExport = {
        name: 'named-pkg',
        version: '2.0.0',
        tools: [{ name: 'tool-a' }],
        prompts: [{ name: 'prompt-a' }],
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('named-pkg');
      expect(result.tools).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
    });

    it('should handle module with only primitive arrays (no name/version)', () => {
      const moduleExport = {
        tools: [{ name: 'tool-a' }],
      };

      const result = normalizeEsmExport(moduleExport);
      expect(result.name).toBe('unknown');
      expect(result.version).toBe('0.0.0');
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('error cases', () => {
    it('should throw for null export', () => {
      expect(() => normalizeEsmExport(null)).toThrow('must be an object');
    });

    it('should throw for undefined export', () => {
      expect(() => normalizeEsmExport(undefined)).toThrow('must be an object');
    });

    it('should throw for primitive export', () => {
      expect(() => normalizeEsmExport('string')).toThrow('must be an object');
    });

    it('should throw for empty object with no recognizable structure', () => {
      expect(() => normalizeEsmExport({})).toThrow('does not export a valid');
    });
  });

  describe('decorated class named exports', () => {
    it('should detect a single @Tool named export and collect into manifest', () => {
      class EchoTool {}
      simulateTool(EchoTool, 'echo');

      const moduleExport = { EchoTool };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]).toBe(EchoTool);
    });

    it('should detect multiple @Tool named exports', () => {
      class EchoTool {}
      class AddTool {}
      simulateTool(EchoTool, 'echo');
      simulateTool(AddTool, 'add');

      const moduleExport = { EchoTool, AddTool };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(2);
    });

    it('should detect mixed primitive types as named exports', () => {
      class MyTool {}
      class MyResource {}
      class MyPrompt {}
      simulateTool(MyTool, 'my-tool');
      simulateResource(MyResource);
      simulatePrompt(MyPrompt);

      const moduleExport = { MyTool, MyResource, MyPrompt };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
      expect(result.resources).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
    });

    it('should detect @Skill and @Job decorated exports', () => {
      class MySkill {}
      class MyJob {}
      simulateSkill(MySkill);
      simulateJob(MyJob);

      const moduleExport = { MySkill, MyJob };
      const result = normalizeEsmExport(moduleExport);
      expect(result.skills).toHaveLength(1);
      expect(result.jobs).toHaveLength(1);
    });

    it('should detect all 7 primitive types in a single module', () => {
      class T {}
      class R {}
      class P {}
      class S {}
      class J {}
      class AG {}
      class WF {}
      simulateTool(T, 't');
      simulateResource(R, 'r');
      simulatePrompt(P, 'p');
      simulateSkill(S, 's');
      simulateJob(J, 'j');
      simulateAgent(AG, 'ag');
      simulateWorkflow(WF, 'wf');

      const moduleExport = { T, R, P, S, J, AG, WF };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
      expect(result.resources).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
      expect(result.skills).toHaveLength(1);
      expect(result.jobs).toHaveLength(1);
      expect(result.agents).toHaveLength(1);
      expect(result.workflows).toHaveLength(1);
    });

    it('should detect @Agent and @Workflow decorated exports', () => {
      class MyAgent {}
      class MyWorkflow {}
      simulateAgent(MyAgent, 'my-agent');
      simulateWorkflow(MyWorkflow, 'my-workflow');

      const moduleExport = { MyAgent, MyWorkflow };
      const result = normalizeEsmExport(moduleExport);
      expect(result.agents).toHaveLength(1);
      expect(result.agents![0]).toBe(MyAgent);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows![0]).toBe(MyWorkflow);
    });

    it('should ignore non-class exports when scanning decorated classes', () => {
      class MyTool {}
      simulateTool(MyTool, 'my-tool');

      const moduleExport = {
        MyTool,
        someString: 'hello',
        someNumber: 42,
        someObject: { foo: 'bar' },
        __esModule: true,
      };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('single decorated default export', () => {
    it('should detect a single @Tool as default export', () => {
      class EchoTool {}
      simulateTool(EchoTool, 'echo');

      const moduleExport = { default: EchoTool };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]).toBe(EchoTool);
    });

    it('should detect a single @Resource as default export', () => {
      class StatusResource {}
      simulateResource(StatusResource, 'status');

      const moduleExport = { default: StatusResource };
      const result = normalizeEsmExport(moduleExport);
      expect(result.resources).toHaveLength(1);
    });

    it('should detect a single @Agent as default export', () => {
      class ResearchAgent {}
      simulateAgent(ResearchAgent, 'research');

      const moduleExport = { default: ResearchAgent };
      const result = normalizeEsmExport(moduleExport);
      expect(result.agents).toHaveLength(1);
      expect(result.agents![0]).toBe(ResearchAgent);
    });

    it('should detect a single @Workflow as default export', () => {
      class PipelineWorkflow {}
      simulateWorkflow(PipelineWorkflow, 'pipeline');

      const moduleExport = { default: PipelineWorkflow };
      const result = normalizeEsmExport(moduleExport);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows![0]).toBe(PipelineWorkflow);
    });
  });

  describe('decorated class exports nested in default', () => {
    it('should scan default export object for decorated classes', () => {
      class MyTool {}
      class MyPrompt {}
      simulateTool(MyTool, 'my-tool');
      simulatePrompt(MyPrompt);

      const moduleExport = { default: { MyTool, MyPrompt } };
      const result = normalizeEsmExport(moduleExport);
      expect(result.tools).toHaveLength(1);
      expect(result.prompts).toHaveLength(1);
    });
  });
});

describe('frontMcpPackageManifestSchema', () => {
  it('should validate a complete manifest', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      name: 'test',
      version: '1.0.0',
      tools: [],
      prompts: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject manifest without name', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      version: '1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('should reject manifest without version', () => {
    const result = frontMcpPackageManifestSchema.safeParse({
      name: 'test',
    });
    expect(result.success).toBe(false);
  });
});
