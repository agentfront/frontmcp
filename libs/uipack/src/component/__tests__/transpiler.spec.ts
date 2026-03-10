/**
 * Transpiler Tests
 *
 * Tests for transpileReactSource(), bundleFileSource(), and extractDefaultExportName().
 */

import { transpileReactSource, extractDefaultExportName } from '../transpiler';

describe('transpileReactSource', () => {
  it('should transpile TSX to React.createElement calls', () => {
    const source = `
import React from 'react';
export default function Hello() {
  return <div>Hello World</div>;
}`;
    const result = transpileReactSource(source, 'component.tsx');

    expect(result).toContain('React.createElement');
    expect(result).not.toContain('jsx-runtime');
    expect(result).not.toContain('jsxDEV');
  });

  it('should transpile JSX similarly', () => {
    const source = `
import React from 'react';
export default function Hello() {
  return <span>Hi</span>;
}`;
    const result = transpileReactSource(source, 'component.jsx');

    expect(result).toContain('React.createElement');
    expect(result).not.toContain('jsx-runtime');
  });

  it('should strip TypeScript type annotations', () => {
    const source = `
import React from 'react';
interface Props {
  name: string;
  count: number;
}
export default function Hello(props: Props) {
  return <div>{props.name}</div>;
}`;
    const result = transpileReactSource(source, 'component.tsx');

    expect(result).not.toContain('interface Props');
    expect(result).not.toContain(': string');
    expect(result).not.toContain(': number');
    expect(result).toContain('React.createElement');
  });

  it('should replace process.env.NODE_ENV with "production"', () => {
    const source = `
import React from 'react';
const mode = process.env.NODE_ENV;
export default function App() {
  return <div>{mode}</div>;
}`;
    const result = transpileReactSource(source, 'component.tsx');

    expect(result).toContain('"production"');
    expect(result).not.toContain('process.env.NODE_ENV');
  });

  it('should default to jsx loader when no filename provided', () => {
    const source = `
import React from 'react';
export default function App() {
  return <div>Default loader</div>;
}`;
    const result = transpileReactSource(source);

    expect(result).toContain('React.createElement');
  });

  it('should handle React.Fragment via JSX', () => {
    const source = `
import React from 'react';
export default function App() {
  return <><span>A</span><span>B</span></>;
}`;
    const result = transpileReactSource(source, 'component.tsx');

    expect(result).toContain('React.Fragment');
  });
});

describe('extractDefaultExportName', () => {
  it('should extract from export default function declaration', () => {
    const code = `export default function EmployeeDirectory() {`;
    expect(extractDefaultExportName(code)).toBe('EmployeeDirectory');
  });

  it('should extract from export default class declaration', () => {
    const code = `export default class MyWidget {`;
    expect(extractDefaultExportName(code)).toBe('MyWidget');
  });

  it('should extract from export default identifier', () => {
    const code = `const Foo = () => {};\nexport default Foo;`;
    expect(extractDefaultExportName(code)).toBe('Foo');
  });

  it('should return null when no default export exists', () => {
    const code = `export function helper() {}`;
    expect(extractDefaultExportName(code)).toBeNull();
  });

  it('should return null for anonymous default export', () => {
    const code = `export default () => {};`;
    expect(extractDefaultExportName(code)).toBeNull();
  });
});

describe('bundleFileSource', () => {
  const mockBuildSync = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    mockBuildSync.mockReset();
    mockBuildSync.mockReturnValue({
      outputFiles: [
        {
          text: `import React from "react";\nimport { createRoot } from "react-dom/client";\nvar Widget = () => React.createElement("div", null, "hello");\ncreateRoot(document.getElementById("root")).render(React.createElement(Widget));`,
        },
      ],
    });

    jest.doMock('esbuild', () => ({
      buildSync: mockBuildSync,
      transformSync: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call esbuild.buildSync with bundle: true', () => {
    // Re-import to pick up mocked esbuild
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    expect(mockBuildSync).toHaveBeenCalledTimes(1);
    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.bundle).toBe(true);
  });

  it('should mark react and react-dom as external', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.external).toEqual(['react', 'react-dom']);
  });

  it('should set platform to browser', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.platform).toBe('browser');
  });

  it('should enable tree shaking', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.treeShaking).toBe(true);
  });

  it('should append mount code with the component name', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'MyComponent');

    const opts = mockBuildSync.mock.calls[0][0];
    const contents = opts.stdin.contents;
    expect(contents).toContain('React.createElement(MyComponent)');
    expect(contents).toContain('McpBridgeProvider');
    expect(contents).toContain('createRoot');
  });

  it('should use tsx loader for .tsx files', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.stdin.loader).toBe('tsx');
  });

  it('should use jsx loader for .jsx files', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.jsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.stdin.loader).toBe('jsx');
  });

  it('should set resolveDir from the provided directory', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/my/project/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.stdin.resolveDir).toBe('/my/project/src');
  });

  it('should return the bundled code', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    const result = bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    expect(result.code).toContain('Widget');
    expect(result.code).toContain('createRoot');
  });

  it('should wrap esbuild errors with a helpful message', () => {
    mockBuildSync.mockImplementation(() => {
      throw new Error('Could not resolve "@frontmcp/ui/components"');
    });

    const { bundleFileSource: bundle } = require('../transpiler');

    expect(() => bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget')).toThrow(
      /Failed to bundle FileSource "widget\.tsx"/,
    );
    expect(() => bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget')).toThrow(
      /Ensure workspace packages are built/,
    );
  });

  it('should use write: false and format: esm', () => {
    const { bundleFileSource: bundle } = require('../transpiler');

    bundle('const x = 1;', 'widget.tsx', '/app/src', 'Widget');

    const opts = mockBuildSync.mock.calls[0][0];
    expect(opts.write).toBe(false);
    expect(opts.format).toBe('esm');
  });
});
