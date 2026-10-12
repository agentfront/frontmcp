/** Redis Lua script for `deleteIfEquals`: deletes KEYS[1] only while it holds ARGV[1], returning 1 or 0. */
export const COMPARE_AND_DELETE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/** Redis Lua script for `expireIfEquals`: sets KEYS[1]'s TTL to ARGV[2] seconds only while it holds ARGV[1]. */
export const COMPARE_AND_EXPIRE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0`;
