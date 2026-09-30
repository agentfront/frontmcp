import { App } from '@frontmcp/sdk';

import UiShowcasePrompt from './prompts/ui-showcase.prompt';
import UiTemplatesResource from './resources/ui-templates.resource';
import CustomUriTool from './tools/custom-uri.tool';
import HtmlCardTool from './tools/html-card.tool';
import HtmlTableTool from './tools/html-table.tool';
import HybridStatusTool from './tools/hybrid-status.tool';
import LeakyReportTool from './tools/leaky-report.tool';
import MarkdownListTool from './tools/markdown-list.tool';
import MarkdownReportTool from './tools/markdown-report.tool';
import MdxDocTool from './tools/mdx-doc.tool';
import MdxInteractiveTool from './tools/mdx-interactive.tool';
import ReactChartTool from './tools/react-chart.tool';
import ReactFormTool from './tools/react-form.tool';
import ReactWeatherTool from './tools/react-weather.tool';
import StaticBadgeTool from './tools/static-badge.tool';

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
    ReactWeatherTool,
    LeakyReportTool,
    CustomUriTool,
  ],
  resources: [UiTemplatesResource],
  prompts: [UiShowcasePrompt],
})
export class WidgetsApp {}
