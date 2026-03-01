export interface RendererFixture {
  name: string;
  content: string;
  description: string;
}

export interface RendererGroup {
  id: string;
  label: string;
  fixtures: RendererFixture[];
}

export const RENDERER_GROUPS: RendererGroup[] = [
  {
    id: 'charts',
    label: 'Charts',
    fixtures: [
      {
        name: 'Bar Chart',
        description: 'Simple bar chart with categories',
        content: JSON.stringify(
          {
            type: 'bar',
            data: [
              { name: 'Jan', sales: 400, revenue: 240 },
              { name: 'Feb', sales: 300, revenue: 139 },
              { name: 'Mar', sales: 200, revenue: 980 },
              { name: 'Apr', sales: 278, revenue: 390 },
              { name: 'May', sales: 189, revenue: 480 },
            ],
            xKey: 'name',
            yKeys: ['sales', 'revenue'],
            title: 'Monthly Sales & Revenue',
          },
          null,
          2,
        ),
      },
      {
        name: 'Line Chart',
        description: 'Time series line chart',
        content: JSON.stringify(
          {
            type: 'line',
            data: [
              { name: 'Mon', users: 120, sessions: 200 },
              { name: 'Tue', users: 150, sessions: 250 },
              { name: 'Wed', users: 180, sessions: 300 },
              { name: 'Thu', users: 140, sessions: 220 },
              { name: 'Fri', users: 200, sessions: 350 },
            ],
            xKey: 'name',
            yKeys: ['users', 'sessions'],
            title: 'Weekly Traffic',
          },
          null,
          2,
        ),
      },
      {
        name: 'Area Chart',
        description: 'Stacked area chart',
        content: JSON.stringify(
          {
            type: 'area',
            data: [
              { name: 'Q1', mobile: 400, desktop: 600 },
              { name: 'Q2', mobile: 500, desktop: 550 },
              { name: 'Q3', mobile: 600, desktop: 500 },
              { name: 'Q4', mobile: 700, desktop: 480 },
            ],
            xKey: 'name',
            yKeys: ['mobile', 'desktop'],
            title: 'Platform Usage by Quarter',
          },
          null,
          2,
        ),
      },
      {
        name: 'Pie Chart',
        description: 'Distribution pie chart',
        content: JSON.stringify(
          {
            type: 'pie',
            data: [
              { name: 'Chrome', value: 62 },
              { name: 'Safari', value: 19 },
              { name: 'Firefox', value: 10 },
              { name: 'Edge', value: 6 },
              { name: 'Other', value: 3 },
            ],
            title: 'Browser Market Share',
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'mermaid',
    label: 'Mermaid Diagrams',
    fixtures: [
      {
        name: 'Flowchart',
        description: 'Simple flowchart with decisions',
        content: `flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B`,
      },
      {
        name: 'Sequence Diagram',
        description: 'API request sequence',
        content: `sequenceDiagram
    participant Client
    participant Server
    participant DB
    Client->>Server: POST /api/data
    Server->>DB: INSERT query
    DB-->>Server: OK
    Server-->>Client: 201 Created`,
      },
      {
        name: 'Class Diagram',
        description: 'Object-oriented class relationships',
        content: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +fetch()
    }
    class Cat {
        +purr()
    }
    Animal <|-- Dog
    Animal <|-- Cat`,
      },
      {
        name: 'ER Diagram',
        description: 'Entity relationship diagram',
        content: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    USER {
        int id PK
        string name
        string email
    }
    ORDER {
        int id PK
        date created_at
    }`,
      },
    ],
  },
  {
    id: 'flow',
    label: 'Flow Diagrams',
    fixtures: [
      {
        name: 'Simple Pipeline',
        description: 'Three-node linear flow',
        content: JSON.stringify(
          {
            nodes: [
              { id: '1', data: { label: 'Input' }, position: { x: 0, y: 100 } },
              { id: '2', data: { label: 'Process' }, position: { x: 250, y: 100 } },
              { id: '3', data: { label: 'Output' }, position: { x: 500, y: 100 } },
            ],
            edges: [
              { id: 'e1-2', source: '1', target: '2', animated: true },
              { id: 'e2-3', source: '2', target: '3', animated: true },
            ],
            title: 'Data Pipeline',
          },
          null,
          2,
        ),
      },
      {
        name: 'Branching Flow',
        description: 'Flow with conditional branches',
        content: JSON.stringify(
          {
            nodes: [
              { id: '1', data: { label: 'Start' }, position: { x: 200, y: 0 } },
              { id: '2', data: { label: 'Validate' }, position: { x: 200, y: 100 } },
              { id: '3', data: { label: 'Success Path' }, position: { x: 50, y: 200 } },
              { id: '4', data: { label: 'Error Path' }, position: { x: 350, y: 200 } },
              { id: '5', data: { label: 'Complete' }, position: { x: 200, y: 300 } },
            ],
            edges: [
              { id: 'e1-2', source: '1', target: '2' },
              { id: 'e2-3', source: '2', target: '3', label: 'valid' },
              { id: 'e2-4', source: '2', target: '4', label: 'invalid' },
              { id: 'e3-5', source: '3', target: '5' },
              { id: 'e4-5', source: '4', target: '5' },
            ],
            title: 'Validation Flow',
            fitView: true,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'math',
    label: 'Math (LaTeX)',
    fixtures: [
      {
        name: 'Display Math',
        description: 'Quadratic formula in display mode',
        content: '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
      },
      {
        name: 'Inline Math',
        description: 'Inline math in a sentence',
        content:
          "The identity $e^{i\\pi} + 1 = 0$ is known as Euler's identity. It relates the five most important constants: $e$, $i$, $\\pi$, $1$, and $0$.",
      },
      {
        name: 'Mixed Text and Math',
        description: 'Paragraph with both display and inline math',
        content: `The Gaussian integral is given by:

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

This result is fundamental in probability theory, where the normal distribution $f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$ describes many natural phenomena.`,
      },
    ],
  },
  {
    id: 'maps',
    label: 'Maps',
    fixtures: [
      {
        name: 'Markers',
        description: 'Map with multiple markers',
        content: JSON.stringify(
          {
            center: [40.7128, -74.006],
            zoom: 12,
            markers: [
              { position: [40.7128, -74.006], popup: 'New York City' },
              { position: [40.7484, -73.9857], popup: 'Empire State Building' },
              { position: [40.6892, -74.0445], popup: 'Statue of Liberty' },
            ],
            title: 'NYC Landmarks',
          },
          null,
          2,
        ),
      },
      {
        name: 'GeoJSON',
        description: 'GeoJSON FeatureCollection',
        content: JSON.stringify(
          {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: 'Central Park' },
                geometry: {
                  type: 'Point',
                  coordinates: [-73.9654, 40.7829],
                },
              },
              {
                type: 'Feature',
                properties: { name: 'Brooklyn Bridge' },
                geometry: {
                  type: 'Point',
                  coordinates: [-73.9969, 40.7061],
                },
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: 'image',
    label: 'Images',
    fixtures: [
      {
        name: 'URL Image',
        description: 'Image loaded from URL',
        content: 'https://picsum.photos/600/400',
      },
      {
        name: 'SVG Data URI',
        description: 'Inline SVG as data URI',
        content:
          'data:image/svg+xml;base64,' +
          btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
              '<rect width="200" height="200" fill="#4a90d9" rx="20"/>' +
              '<text x="100" y="110" text-anchor="middle" fill="white" font-size="24" font-family="sans-serif">FrontMCP</text>' +
              '</svg>',
          ),
      },
    ],
  },
  {
    id: 'video',
    label: 'Video',
    fixtures: [
      {
        name: 'YouTube Video',
        description: 'Embedded YouTube video',
        content: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      {
        name: 'MP4 Video',
        description: 'Direct MP4 video file',
        content: 'https://www.w3schools.com/html/mov_bbb.mp4',
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    fixtures: [
      {
        name: 'MP3 Audio',
        description: 'Direct MP3 audio file',
        content: 'https://www.w3schools.com/html/horse.mp3',
      },
    ],
  },
  {
    id: 'csv',
    label: 'CSV / TSV',
    fixtures: [
      {
        name: 'Comma-Delimited',
        description: 'Standard CSV with headers',
        content: `Name,Age,City,Score
Alice,30,New York,95
Bob,25,San Francisco,88
Carol,35,Chicago,92
David,28,Austin,78
Eve,32,Seattle,85
Frank,29,Boston,91
Grace,31,Denver,87`,
      },
      {
        name: 'Tab-Delimited',
        description: 'TSV format data',
        content: `Product\tPrice\tQuantity\tCategory
Widget A\t$9.99\t150\tHardware
Widget B\t$14.99\t85\tSoftware
Widget C\t$4.99\t300\tAccessories
Widget D\t$24.99\t45\tHardware
Widget E\t$19.99\t120\tSoftware`,
      },
    ],
  },
  {
    id: 'mdx',
    label: 'Markdown / MDX',
    fixtures: [
      {
        name: 'Headings & Lists',
        description: 'Markdown with headings and lists',
        content: `# Getting Started

## Installation

Install the package using your preferred package manager:

- **npm**: \`npm install @frontmcp/ui\`
- **yarn**: \`yarn add @frontmcp/ui\`
- **pnpm**: \`pnpm add @frontmcp/ui\`

## Features

1. MUI-based components
2. Content renderers
3. Theme system
4. MCP bridge hooks`,
      },
      {
        name: 'Code Blocks',
        description: 'Markdown with fenced code blocks',
        content:
          '# Code Example\n\nHere is a TypeScript example:\n\n```typescript\nimport { registerAllRenderers, ContentView } from \'@frontmcp/ui/renderer\';\n\n// Register all renderers\nregisterAllRenderers();\n\n// Use ContentView to auto-detect and render\nfunction App() {\n  return <ContentView content={myContent} />;\n}\n```\n\nAnd some JSON config:\n\n```json\n{\n  "theme": "dark",\n  "renderers": ["charts", "mermaid"]\n}\n```',
      },
      {
        name: 'Tables',
        description: 'Markdown table with alignment',
        content: `# Renderer Comparison

| Renderer | Priority | Library | Optional |
|----------|:--------:|---------|:--------:|
| PDF      | 90       | react-pdf | Yes |
| Charts   | 80       | recharts | Yes |
| Flow     | 70       | @xyflow/react | Yes |
| Maps     | 60       | react-leaflet | Yes |
| Mermaid  | 50       | mermaid | Yes |
| Math     | 40       | katex | Yes |
| HTML     | 0        | dompurify | Yes |`,
      },
    ],
  },
  {
    id: 'html',
    label: 'HTML',
    fixtures: [
      {
        name: 'Styled Div',
        description: 'HTML with inline styles',
        content: `<div style="padding: 24px; border-radius: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-family: sans-serif;">
  <h2 style="margin: 0 0 12px 0;">Welcome to FrontMCP</h2>
  <p style="margin: 0; opacity: 0.9;">This is rendered HTML content with inline styles. The HTML renderer sanitizes content with DOMPurify.</p>
</div>`,
      },
      {
        name: 'Table',
        description: 'HTML table with styling',
        content: `<table style="border-collapse: collapse; width: 100%; font-family: sans-serif;">
  <thead>
    <tr style="background: #f0f0f0;">
      <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left;">Status</th>
      <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left;">Count</th>
      <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left;">Percentage</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd;">Passed</td><td style="padding: 8px 12px; border: 1px solid #ddd;">142</td><td style="padding: 8px 12px; border: 1px solid #ddd;">89%</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd;">Failed</td><td style="padding: 8px 12px; border: 1px solid #ddd;">12</td><td style="padding: 8px 12px; border: 1px solid #ddd;">8%</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd;">Skipped</td><td style="padding: 8px 12px; border: 1px solid #ddd;">6</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3%</td></tr>
  </tbody>
</table>`,
      },
    ],
  },
  {
    id: 'pdf',
    label: 'PDF',
    fixtures: [
      {
        name: 'Minimal PDF',
        description: 'Base64-encoded minimal PDF document',
        // Minimal valid PDF
        content:
          'JVBER' +
          'i0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUg' +
          'L1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu' +
          'dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8' +
          'PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQKL0YxIDE4' +
          'IFRmCjEwMCA3MDAgVGQKKEhlbGxvIEZyb250TUNQISkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9U' +
          'eXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAw' +
          'MDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAw' +
          'MDAwMCBuIAowMDAwMDAwMzA2IDAwMDAwIG4gCjAwMDAwMDA0MDAgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9S' +
          'b290IDEgMCBSID4+CnN0YXJ0eHJlZgo0ODMKJSVFT0YK',
      },
    ],
  },
  {
    id: 'react',
    label: 'React / JSX',
    fixtures: [
      {
        name: 'Dashboard Card',
        description: 'Polished dashboard card with gradient header and stats',
        content: `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';

const stats = [
  { label: 'Active Users', value: '12,847', change: '+14%', up: true },
  { label: 'Revenue', value: '$48.2K', change: '+8.3%', up: true },
  { label: 'Bounce Rate', value: '24.1%', change: '-3.2%', up: false },
  { label: 'Avg Session', value: '4m 32s', change: '+12%', up: true },
];

function Dashboard() {
  const [selected, setSelected] = useState(0);
  const stat = stats[selected];

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480 }}>
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '12px 12px 0 0',
        padding: '24px 20px 16px',
        color: 'white',
      }}>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>{stat.label}</div>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{stat.value}</div>
        <div style={{
          display: 'inline-block',
          marginTop: 8,
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 600,
          background: stat.up ? 'rgba(255,255,255,0.25)' : 'rgba(255,100,100,0.3)',
        }}>
          {stat.change} vs last month
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        borderRadius: '0 0 12px 12px',
        overflow: 'hidden',
        border: '1px solid #e0e0e0',
        borderTop: 'none',
      }}>
        {stats.map((s, i) => (
          <button
            key={s.label}
            onClick={() => setSelected(i)}
            style={{
              padding: '12px 8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: selected === i ? 700 : 400,
              color: selected === i ? '#667eea' : '#666',
              background: selected === i ? '#f0f0ff' : '#fff',
              borderRight: i < 3 ? '1px solid #e0e0e0' : 'none',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{s.value}</div>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Dashboard;`,
      },
      {
        name: 'Todo List',
        description: 'Interactive todo list with add/remove/toggle',
        content: `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';

function TodoApp() {
  const [todos, setTodos] = useState([
    { id: 1, text: 'Set up FrontMCP renderers', done: true },
    { id: 2, text: 'Add esm.sh CDN fallback', done: true },
    { id: 3, text: 'Write integration tests', done: false },
  ]);
  const [input, setInput] = useState('');

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos((t) => [...t, { id: Date.now(), text: input.trim(), done: false }]);
    setInput('');
  };

  const toggle = (id) => setTodos((t) => t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  const remove = (id) => setTodos((t) => t.filter((x) => x.id !== id));

  const done = todos.filter((t) => t.done).length;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Tasks</h3>
        <span style={{ fontSize: 13, color: '#888' }}>{done}/{todos.length} done</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          placeholder="Add a task..."
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #d0d0d0', fontSize: 14 }}
        />
        <button
          onClick={addTodo}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#667eea', color: 'white', fontWeight: 600, fontSize: 14,
          }}
        >+</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {todos.map((todo) => (
          <div
            key={todo.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 8, background: '#f8f9fa',
              border: '1px solid #eee', transition: 'opacity 0.2s',
              opacity: todo.done ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggle(todo.id)}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{
              flex: 1, fontSize: 14,
              textDecoration: todo.done ? 'line-through' : 'none',
              color: todo.done ? '#999' : '#333',
            }}>{todo.text}</span>
            <button
              onClick={() => remove(todo.id)}
              style={{
                border: 'none', background: 'none', color: '#ccc', cursor: 'pointer',
                fontSize: 18, lineHeight: 1, padding: '0 4px',
              }}
            >x</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TodoApp;`,
      },
      {
        name: 'Data Table',
        description: 'Sortable data table with status badges',
        content: `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';

const data = [
  { name: 'Charts Renderer', type: 'recharts', status: 'active', priority: 80 },
  { name: 'Mermaid Renderer', type: 'mermaid', status: 'active', priority: 50 },
  { name: 'Flow Renderer', type: '@xyflow/react', status: 'active', priority: 70 },
  { name: 'Math Renderer', type: 'katex', status: 'active', priority: 40 },
  { name: 'Maps Renderer', type: 'react-leaflet', status: 'beta', priority: 60 },
  { name: 'PDF Renderer', type: 'react-pdf', status: 'active', priority: 90 },
  { name: 'MDX Renderer', type: 'react-markdown', status: 'active', priority: 5 },
  { name: 'HTML Renderer', type: 'dompurify', status: 'active', priority: 0 },
];

const badge = (status) => ({
  display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
  background: status === 'active' ? '#e6f4ea' : '#fff3e0',
  color: status === 'active' ? '#1b7a3d' : '#e65100',
});

function DataTable() {
  const [sortKey, setSortKey] = useState('priority');
  const [asc, setAsc] = useState(false);

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });

  const onSort = (key) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  };

  const arrow = (key) => sortKey === key ? (asc ? ' \\u25B2' : ' \\u25BC') : '';

  const th = { padding: '10px 14px', textAlign: 'left', cursor: 'pointer', userSelect: 'none', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '2px solid #e0e0e0' };
  const td = { padding: '10px 14px', borderBottom: '1px solid #f0f0f0', fontSize: 14 };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
        <thead>
          <tr>
            <th style={th} onClick={() => onSort('name')}>Name{arrow('name')}</th>
            <th style={th} onClick={() => onSort('type')}>Library{arrow('type')}</th>
            <th style={th} onClick={() => onSort('status')}>Status{arrow('status')}</th>
            <th style={th} onClick={() => onSort('priority')}>Priority{arrow('priority')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.name} style={{ transition: 'background 0.15s' }}>
              <td style={{ ...td, fontWeight: 600 }}>{row.name}</td>
              <td style={td}><code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>{row.type}</code></td>
              <td style={td}><span style={badge(row.status)}>{row.status}</span></td>
              <td style={td}>{row.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;`,
      },
      {
        name: 'Theme Switcher',
        description: 'Live theme toggle with color palette preview',
        content: `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';

const themes = {
  ocean: { bg: '#0f172a', card: '#1e293b', text: '#e2e8f0', accent: '#38bdf8', name: 'Ocean' },
  forest: { bg: '#14532d', card: '#166534', text: '#dcfce7', accent: '#4ade80', name: 'Forest' },
  sunset: { bg: '#431407', card: '#7c2d12', text: '#fed7aa', accent: '#fb923c', name: 'Sunset' },
  lavender: { bg: '#2e1065', card: '#3b0764', text: '#e9d5ff', accent: '#c084fc', name: 'Lavender' },
};

function ThemeSwitcher() {
  const [active, setActive] = useState('ocean');
  const t = themes[active];

  return (
    <div style={{ background: t.bg, borderRadius: 12, padding: 24, fontFamily: 'system-ui, sans-serif', color: t.text, transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {Object.entries(themes).map(([key, theme]) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: active === key ? 700 : 400,
              background: active === key ? t.accent : 'rgba(255,255,255,0.1)',
              color: active === key ? t.bg : t.text,
              transition: 'all 0.2s',
            }}
          >{theme.name}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: t.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>Primary Color</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: t.accent }} />
            <span style={{ fontWeight: 600 }}>{t.accent}</span>
          </div>
        </div>
        <div style={{ background: t.card, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>Background</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: t.bg, border: '1px solid rgba(255,255,255,0.2)' }} />
            <span style={{ fontWeight: 600 }}>{t.bg}</span>
          </div>
        </div>
      </div>
      <div style={{ background: t.card, borderRadius: 8, padding: 16, marginTop: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Preview</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 0.7, 0.4, 0.2].map((opacity) => (
            <div key={opacity} style={{ flex: 1, height: 32, borderRadius: 6, background: t.accent, opacity }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default ThemeSwitcher;`,
      },
      {
        name: 'Mini Chart',
        description: 'Pure CSS bar chart with animated bars and hover tooltips',
        content: `import React from 'https://esm.sh/react@19';
import { useState } from 'https://esm.sh/react@19';

const months = [
  { month: 'Jan', value: 65 }, { month: 'Feb', value: 78 },
  { month: 'Mar', value: 52 }, { month: 'Apr', value: 91 },
  { month: 'May', value: 84 }, { month: 'Jun', value: 72 },
  { month: 'Jul', value: 96 }, { month: 'Aug', value: 68 },
  { month: 'Sep', value: 88 }, { month: 'Oct', value: 55 },
  { month: 'Nov', value: 79 }, { month: 'Dec', value: 93 },
];

const max = Math.max(...months.map((m) => m.value));

function MiniChart() {
  const [hovered, setHovered] = useState(null);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 500, padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Monthly Performance</div>
          <div style={{ fontSize: 13, color: '#888' }}>Score out of 100</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#667eea' }}>
          {hovered !== null ? months[hovered].value : Math.round(months.reduce((s, m) => s + m.value, 0) / months.length)}
          <span style={{ fontSize: 14, color: '#aaa', fontWeight: 400 }}> {hovered !== null ? months[hovered].month : 'avg'}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
        {months.map((m, i) => (
          <div
            key={m.month}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer',
            }}
          >
            <div style={{
              width: '100%',
              height: (m.value / max) * 100,
              borderRadius: '4px 4px 0 0',
              background: hovered === i
                ? 'linear-gradient(180deg, #667eea, #764ba2)'
                : m.value >= 80 ? '#667eea' : m.value >= 60 ? '#a5b4fc' : '#e0e7ff',
              transition: 'all 0.2s',
              transform: hovered === i ? 'scaleY(1.05)' : 'scaleY(1)',
              transformOrigin: 'bottom',
            }} />
            <div style={{ fontSize: 10, color: hovered === i ? '#667eea' : '#aaa', marginTop: 4, fontWeight: hovered === i ? 700 : 400 }}>
              {m.month}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MiniChart;`,
      },
    ],
  },
];

export function getGroup(id: string): RendererGroup | undefined {
  return RENDERER_GROUPS.find((g) => g.id === id);
}
