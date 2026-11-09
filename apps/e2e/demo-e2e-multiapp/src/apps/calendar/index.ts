import { App } from '@frontmcp/sdk';

import ScheduleOverviewPrompt from './prompts/schedule-overview.prompt';
import EventsAllResource from './resources/events-all.resource';
import CreateEventTool from './tools/create-event.tool';
import ListEventsTool from './tools/list-events.tool';

@App({
  name: 'calendar',
  description: 'Calendar and events management app',
  tools: [CreateEventTool, ListEventsTool],
  resources: [EventsAllResource],
  prompts: [ScheduleOverviewPrompt],
})
export class CalendarApp {}
