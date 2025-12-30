import { App } from '@frontmcp/sdk';
import GetSessionInfoTool from './tools/get-session-info.tool';
import IncrementCounterTool from './tools/increment-counter.tool';

@App({
  name: 'TransportTest',
  description: 'Transport recreation testing application',
  tools: [GetSessionInfoTool, IncrementCounterTool],
})
export class TransportTestApp {}
