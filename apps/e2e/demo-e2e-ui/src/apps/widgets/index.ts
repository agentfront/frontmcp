import { App } from '@frontmcp/sdk';
import HtmlTableTool from './tools/html-table.tool';
import HtmlCardTool from './tools/html-card.tool';
import ReactChartTool from './tools/react-chart.tool';
import ReactFormTool from './tools/react-form.tool';
import MdxDocTool from './tools/mdx-doc.tool';
import MdxInteractiveTool from './tools/mdx-interactive.tool';
import MarkdownReportTool from './tools/markdown-report.tool';
import MarkdownListTool from './tools/markdown-list.tool';
import StaticBadgeTool from './tools/static-badge.tool';
import HybridStatusTool from './tools/hybrid-status.tool';
import UiTemplatesResource from './resources/ui-templates.resource';
import UiShowcasePrompt from './prompts/ui-showcase.prompt';

@App({
  name: 'widgets',
  tools: [
    HtmlTableTool,
    HtmlCardTool,
    ReactChartTool,
    ReactFormTool,
    MdxDocTool,
    MdxInteractiveTool,
    MarkdownReportTool,
    MarkdownListTool,
    StaticBadgeTool,
    HybridStatusTool,
  ],
  resources: [UiTemplatesResource],
  prompts: [UiShowcasePrompt],
})
export class WidgetsApp {}
