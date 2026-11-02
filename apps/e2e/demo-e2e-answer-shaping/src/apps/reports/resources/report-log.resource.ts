import { Resource, ResourceContext } from '@frontmcp/sdk';

/** About 300 KB of JSON log entries. */
@Resource({ name: 'report-log', uri: 'reports://log', mimeType: 'application/json' })
export default class ReportLogResource extends ResourceContext {
  async execute(uri: string) {
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      id: index,
      line: `entry ${index} `.padEnd(280, '.'),
    }));
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ entries }) }] };
  }
}
