import { buildRemotePromptRecord, buildRemoteResourceRecord, buildRemoteToolRecord } from '../factories';
import type { McpClientService } from '../mcp-client.service';

const client = {} as McpClientService;

describe('remote record builders', () => {
  it("keep a remote tool's title and outputSchema", () => {
    const outputSchema = { type: 'object' as const, properties: { up: { type: 'boolean' } } };
    const record = buildRemoteToolRecord(
      { name: 'get_status', title: 'Get status', inputSchema: { type: 'object' }, outputSchema },
      client,
      'status',
      'status',
    );

    expect(record.metadata).toEqual(
      expect.objectContaining({ name: 'status:get_status', title: 'Get status', rawOutputSchema: outputSchema }),
    );
  });

  it("keep a remote resource's and prompt's title", () => {
    expect(
      buildRemoteResourceRecord({ name: 'now', title: 'Now', uri: 'status://now' }, client, 'status').metadata.title,
    ).toBe('Now');
    expect(buildRemotePromptRecord({ name: 'greet', title: 'Greet' }, client, 'status').metadata.title).toBe('Greet');
  });
});
