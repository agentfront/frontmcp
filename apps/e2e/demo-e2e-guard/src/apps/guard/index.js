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
exports.GuardApp = void 0;
const sdk_1 = require('@frontmcp/sdk');
const rate_limited_tool_1 = require('./tools/rate-limited.tool');
const concurrency_mutex_tool_1 = require('./tools/concurrency-mutex.tool');
const concurrency_queued_tool_1 = require('./tools/concurrency-queued.tool');
const timeout_tool_1 = require('./tools/timeout.tool');
const combined_guard_tool_1 = require('./tools/combined-guard.tool');
const unguarded_tool_1 = require('./tools/unguarded.tool');
const slow_tool_1 = require('./tools/slow.tool');
let GuardApp = class GuardApp {};
exports.GuardApp = GuardApp;
exports.GuardApp = GuardApp = __decorate(
  [
    (0, sdk_1.App)({
      name: 'guard',
      description: 'Guard E2E testing tools',
      tools: [
        rate_limited_tool_1.default,
        concurrency_mutex_tool_1.default,
        concurrency_queued_tool_1.default,
        timeout_tool_1.default,
        combined_guard_tool_1.default,
        unguarded_tool_1.default,
        slow_tool_1.default,
      ],
    }),
  ],
  GuardApp,
);
