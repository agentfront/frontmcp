import { App } from '@frontmcp/sdk';

import UiShowcasePrompt from './prompts/ui-showcase.prompt';
import UiTemplatesResource from './resources/ui-templates.resource';
import { BundledDynamicNoteTool, BundledStaticNoteTool } from './tools/bundled-notes.tool';
import CustomUriTool from './tools/custom-uri.tool';
import CustomUrlForecastTool from './tools/custom-url-forecast.tool';
import DirectUrlForecastTool from './tools/direct-url-forecast.tool';
import DualPayloadWeatherTool from './tools/dual-payload-weather.tool';
import HtmlCardTool from './tools/html-card.tool';
import HtmlTableTool from './tools/html-table.tool';
import HybridStatusTool from './tools/hybrid-status.tool';
import HydratedCounterTool from './tools/hydrated-counter.tool';
import LeakyReportTool from './tools/leaky-report.tool';
import MarkdownListTool from './tools/markdown-list.tool';
import MarkdownReportTool from './tools/markdown-report.tool';
import MarkdownTableTool from './tools/markdown-table.tool';
import MdxDocTool from './tools/mdx-doc.tool';
import MdxInteractiveTool from './tools/mdx-interactive.tool';
import ReactChartTool from './tools/react-chart.tool';
import ReactFormTool from './tools/react-form.tool';
import ReactWeatherTool from './tools/react-weather.tool';
import SanitizedSummaryTool from './tools/sanitized-summary.tool';
import StaticBadgeTool from './tools/static-badge.tool';
import StatusCardTool from './tools/status-card.tool';

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
    SanitizedSummaryTool,
    MarkdownTableTool,
    StatusCardTool,
    HydratedCounterTool,
    DirectUrlForecastTool,
    CustomUrlForecastTool,
    BundledStaticNoteTool,
    BundledDynamicNoteTool,
    DualPayloadWeatherTool,
  ],
  resources: [UiTemplatesResource],
  prompts: [UiShowcasePrompt],
})
export class WidgetsApp {}
