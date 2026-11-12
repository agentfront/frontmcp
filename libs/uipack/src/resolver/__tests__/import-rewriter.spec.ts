/**
 * rewriteImports matches the clause between `import` / `export` and `from` in time that does not
 * grow with every way to split a run of whitespace.
 */
import { rewriteImports } from '../import-rewriter';

const overrides = { react: 'https://cdn.example/react' };

describe('rewriteImports', () => {
  it('rewrites static imports and re-exports with any whitespace around the clause', () => {
    const source = "import   {a,\n b}   from   'react';\nexport * from \"react\";\nimport\tReact from 'react';";

    expect(rewriteImports(source, { overrides }).code).toBe(
      "import   {a,\n b}   from   'https://cdn.example/react';\n" +
        'export * from "https://cdn.example/react";\n' +
        "import\tReact from 'https://cdn.example/react';",
    );
  });

  it('leaves a 20,000-space export with no from as it is', () => {
    const tail = `export${' '.repeat(20_000)}x;`;
    const source = `import React from 'react';\n${tail}`;

    expect(rewriteImports(source, { overrides }).code).toBe(`import React from 'https://cdn.example/react';\n${tail}`);
  });
});
