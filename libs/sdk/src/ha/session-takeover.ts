/**
 * Session Takeover — Decentralized Lua CAS
 *
 * When a pod dies, surviving pods race to claim orphaned sessions.
 * The Lua script atomically checks and updates the nodeId (compare-and-swap),
 * ensuring exactly-once ownership transfer with no leader election.
 */

import type { TakeoverResult } from './ha.types';

/**
 * Minimal Redis client interface for Lua script execution.
 */
export interface TakeoverRedisClient {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Lua CAS script for atomic session takeover.
 *
 * KEYS[1] = session key (e.g., "mcp:transport:{sessionId}")
 * ARGV[1] = expected old nodeId (the dead pod)
 * ARGV[2] = new nodeId (the claiming pod)
 * ARGV[3] = current timestamp (epoch ms)
 *
 * Returns 1 if claimed, 0 if already claimed or session not found.
 */
const TAKEOVER_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end

local ok, data = pcall(cjson.decode, raw)
if not ok then return 0 end

local nodeId = nil
if data.session and data.session.nodeId then
  nodeId = data.session.nodeId
elseif data.nodeId then
  nodeId = data.nodeId
end

if nodeId ~= ARGV[1] then return 0 end

if data.session then
  data.session.nodeId = ARGV[2]
else
  data.nodeId = ARGV[2]
end
data.reassignedAt = tonumber(ARGV[3])
data.reassignedFrom = ARGV[1]

redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return 1
`;

/**
 * Attempt to claim an orphaned session via atomic Lua CAS.
 *
 * Multiple pods may call this concurrently for the same session.
 * Exactly one will succeed (return claimed=true), others get claimed=false.
 *
 * @param redis - Redis client supporting eval
 * @param sessionKey - Full Redis key for the session
 * @param expectedOldNodeId - The dead pod's nodeId (from StoredSession)
 * @param newNodeId - This pod's nodeId (getMachineId())
 * @returns Whether this pod successfully claimed the session
 */
export async function attemptSessionTakeover(
  redis: TakeoverRedisClient,
  sessionKey: string,
  expectedOldNodeId: string,
  newNodeId: string,
): Promise<TakeoverResult> {
  const result = await redis.eval(TAKEOVER_LUA, 1, sessionKey, expectedOldNodeId, newNodeId, Date.now().toString());

  return {
    claimed: result === 1,
    sessionId: sessionKey,
    previousNodeId: result === 1 ? expectedOldNodeId : undefined,
  };
}
