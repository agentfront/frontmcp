import { z } from 'zod';
import { McpSession } from './record/session.mcp';

export const SessionSchema = z.instanceof(McpSession);
