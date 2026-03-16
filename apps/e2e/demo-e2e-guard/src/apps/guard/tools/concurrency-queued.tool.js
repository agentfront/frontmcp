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
let ConcurrencyQueuedTool = class ConcurrencyQueuedTool extends sdk_1.ToolContext {
  async execute(input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
};
ConcurrencyQueuedTool = __decorate(
  [
    (0, sdk_1.Tool)({
      name: 'concurrency-queued',
      description: 'A mutex tool with queue (maxConcurrent: 1, queueTimeout: 3s)',
      inputSchema,
      concurrency: {
        maxConcurrent: 1,
        queueTimeoutMs: 3000,
      },
    }),
  ],
  ConcurrencyQueuedTool,
);
exports.default = ConcurrencyQueuedTool;
