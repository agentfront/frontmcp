import { App } from '@frontmcp/sdk';

import CreateEventTool from './tools/create-event.tool';
import ListEventsTool from './tools/list-events.tool';

import EventsAllResource from './resources/events-all.resource';

import ScheduleOverviewPrompt from './prompts/schedule-overview.prompt';

@App({
  name: 'calendar',
  description: 'Calendar and events management app',
  tools: [CreateEventTool, ListEventsTool],
  resources: [EventsAllResource],
  prompts: [ScheduleOverviewPrompt],
})
export class CalendarApp {}
