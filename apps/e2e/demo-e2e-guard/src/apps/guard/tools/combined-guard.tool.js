'use strict';
var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d;
    if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function')
      r = Reflect.decorate(decorators, target, key, desc);
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return (c > 3 && r && Object.defineProperty(target, key, r), r);
  };
Object.defineProperty(exports, '__esModule', { value: true });
const sdk_1 = require('@frontmcp/sdk');
const zod_1 = require('zod');
const inputSchema = {
  delayMs: zod_1.z.number().default(0),
};
let CombinedGuardTool = class CombinedGuardTool extends sdk_1.ToolContext {
  async execute(input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
};
CombinedGuardTool = __decorate(
  [
    (0, sdk_1.Tool)({
      name: 'combined-guard',
      description: 'A tool with rate limit, concurrency, and timeout guards',
      inputSchema,
      rateLimit: {
        maxRequests: 5,
        windowMs: 5000,
        partitionBy: 'global',
      },
      concurrency: {
        maxConcurrent: 2,
        queueTimeoutMs: 1000,
      },
      timeout: {
        executeMs: 2000,
      },
    }),
  ],
  CombinedGuardTool,
);
exports.default = CombinedGuardTool;
