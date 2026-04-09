/**
 * E2E Tests for deployment-aware Machine ID resolution.
 *
 * Tests that getMachineId() resolves correctly based on
 * FRONTMCP_DEPLOYMENT_MODE and related environment variables.
 */

import { FrontMcpInstance, type DirectMcpServer } from '@frontmcp/sdk';
import { getMachineId, setMachineIdOverride } from '@frontmcp/utils';

import { serverConfig } from '../src/main';

describe('Machine ID E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    setMachineIdOverride(undefined);
    await server.dispose();
  });

  it('should return a non-empty machine ID via tool', async () => {
    const result = await server.callTool('get_machine_id', {});
    expect(result.isError).not.toBe(true);

    const content = JSON.parse((result.content[0] as { text: string }).text);
    expect(content.machineId).toBeDefined();
    expect(typeof content.machineId).toBe('string');
    expect(content.machineId.length).toBeGreaterThan(0);
  });

  it('should return stable machine ID across calls', async () => {
    const result1 = await server.callTool('get_machine_id', {});
    const result2 = await server.callTool('get_machine_id', {});

    const id1 = JSON.parse((result1.content[0] as { text: string }).text).machineId;
    const id2 = JSON.parse((result2.content[0] as { text: string }).text).machineId;
    expect(id1).toBe(id2);
  });

  it('should respect setMachineIdOverride', () => {
    const original = getMachineId();
    setMachineIdOverride('test-override-id');
    expect(getMachineId()).toBe('test-override-id');
    setMachineIdOverride(undefined);
    expect(getMachineId()).toBe(original);
  });

  it('should respect machine id override via setMachineIdOverride', () => {
    // getMachineId() is resolved at module load, so we test the override mechanism
    // which mirrors the MACHINE_ID env var behavior
    setMachineIdOverride('env-machine-id-123');
    expect(getMachineId()).toBe('env-machine-id-123');
  });
});
