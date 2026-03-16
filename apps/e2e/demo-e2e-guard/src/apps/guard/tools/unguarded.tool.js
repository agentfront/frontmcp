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
  value: zod_1.z.string().default('test'),
};
let UnguardedTool = class UnguardedTool extends sdk_1.ToolContext {
  async execute(input) {
    return { echo: input.value };
  }
};
UnguardedTool = __decorate(
  [
    (0, sdk_1.Tool)({
      name: 'unguarded',
      description: 'An unguarded echo tool (no rate limit, no concurrency, no timeout)',
      inputSchema,
    }),
  ],
  UnguardedTool,
);
exports.default = UnguardedTool;
