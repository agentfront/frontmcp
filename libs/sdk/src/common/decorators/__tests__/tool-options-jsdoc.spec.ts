/**
 * Regression guard for #452 — `@Tool`/`@Agent` option fields must carry JSDoc so
 * editors show hover docs.
 *
 * `ToolMetadataOptions` / `AgentMetadataOptions` `Omit` the guard fields
 * (`concurrency`, `rateLimit`, `timeout`, and for tools `ui`) from the base
 * metadata and re-declare them with the permissive `*Input` types. `Omit` drops
 * the base field's JSDoc, so the re-declarations previously had NONE — hovering
 * those keys in `@Tool({ … })` showed no documentation. They must each carry
 * their own JSDoc block.
 *
 * This test parses the decorator sources (no type-checking needed) and asserts
 * the JSDoc is present, so a future refactor can't silently drop it again.
 */
import { join } from 'node:path';

import * as ts from 'typescript';

import { readFile } from '@frontmcp/utils';

/**
 * Collect the names of every `PropertySignature` declared anywhere under a named
 * type alias that carries a JSDoc comment.
 */
async function documentedFieldsOfAlias(filePath: string, aliasName: string): Promise<Set<string>> {
  const source = ts.createSourceFile(
    filePath,
    await readFile(filePath),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const documented = new Set<string>();
  let alias: ts.TypeAliasDeclaration | undefined;

  source.forEachChild(function find(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === aliasName) {
      alias = node;
    }
  });

  if (!alias) {
    throw new Error(`type alias ${aliasName} not found in ${filePath}`);
  }

  const walk = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.name && ts.isIdentifier(node.name)) {
      const jsDoc = ts.getJSDocCommentsAndTags(node);
      if (jsDoc.length > 0) {
        documented.add(node.name.text);
      }
    }
    node.forEachChild(walk);
  };
  walk(alias.type);

  return documented;
}

describe('Tool/Agent option JSDoc (#452)', () => {
  const decoratorsDir = join(__dirname, '..');

  it('ToolMetadataOptions documents every re-declared guard/ui field', async () => {
    const documented = await documentedFieldsOfAlias(join(decoratorsDir, 'tool.decorator.ts'), 'ToolMetadataOptions');

    for (const field of ['concurrency', 'rateLimit', 'timeout', 'ui']) {
      expect(documented).toContain(field);
    }
  });

  it('AgentMetadataOptions documents every re-declared guard field', async () => {
    const documented = await documentedFieldsOfAlias(join(decoratorsDir, 'agent.decorator.ts'), 'AgentMetadataOptions');

    for (const field of ['concurrency', 'rateLimit', 'timeout']) {
      expect(documented).toContain(field);
    }
  });

  it('base ToolMetadata documents ui and annotations (no field left without hover docs)', async () => {
    const metadataFile = join(decoratorsDir, '..', 'metadata', 'tool.metadata.ts');
    const documented = await collectInterfaceJsDocFields(metadataFile, 'ToolMetadata');

    for (const field of ['ui', 'annotations', 'name', 'description', 'inputSchema']) {
      expect(documented).toContain(field);
    }
  });
});

/**
 * Like {@link documentedFieldsOfAlias} but for an `interface` declaration.
 */
async function collectInterfaceJsDocFields(filePath: string, interfaceName: string): Promise<Set<string>> {
  const source = ts.createSourceFile(filePath, await readFile(filePath), ts.ScriptTarget.Latest, true);
  const documented = new Set<string>();
  let iface: ts.InterfaceDeclaration | undefined;

  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      iface = node;
    }
  });

  if (!iface) {
    throw new Error(`interface ${interfaceName} not found in ${filePath}`);
  }

  for (const member of iface.members) {
    if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
      if (ts.getJSDocCommentsAndTags(member).length > 0) {
        documented.add(member.name.text);
      }
    }
  }

  return documented;
}
