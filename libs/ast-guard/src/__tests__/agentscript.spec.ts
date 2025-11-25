/**
 * AgentScript Preset Tests
 *
 * Tests for the AgentScript language preset - a strict JavaScript subset
 * designed for AI agent orchestration.
 */

import { JSAstValidator } from '../validator';
import { createAgentScriptPreset } from '../presets/agentscript.preset';
import { ValidationSeverity } from '../interfaces';

describe('AgentScript Preset', () => {
  describe('Valid AgentScript Code', () => {
    it('should allow simple tool call orchestration', async () => {
      const code = `
        async function __ag_main() {
          const users = await callTool('users:list', { limit: 100 });
          const result = users.items.map(u => u.name);
          return result;
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should allow multiple tool calls in sequence', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', { role: 'admin' });
        const invoices = await callTool('billing:listInvoices', {
          userId: users.items[0].id
        });
        return invoices;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow bounded for-of loops', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', {});
        const results = [];

        for (const user of users.items) {
          const data = await callTool('users:getData', { id: user.id });
          results.push(data);
        }

        return results;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow bounded for loops', async () => {
      const code = `
        
        async function __ag_main() {const results = [];
        for (let i = 0; i < 10; i++) {
          const data = await callTool('getData', { index: i });
          results.push(data);
        }
        return results;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow array methods with arrow functions', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', {});
        const filtered = users.items.filter(u => u.active);
        const mapped = filtered.map(u => ({ id: u.id, name: u.name }));
        const total = mapped.reduce((sum, u) => sum + u.id, 0);
        return total;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow Math operations', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const max = Math.max(...data.values);
        const rounded = Math.round(data.average);
        const random = Math.random();
        return { max, rounded, random };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow JSON operations', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const str = JSON.stringify(data);
        const parsed = JSON.parse(str);
        return parsed;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow String operations', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', {});
        const names = users.items.map(u => String(u.name).toUpperCase());
        const joined = names.join(', ');
        return joined;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow Date operations', async () => {
      const code = `
        
        async function __ag_main() {const now = Date.now();
        const date = new Date();
        const iso = date.toISOString();
        return { now, iso };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow Number operations', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const num = Number(data.value);
        const parsed = Number.parseInt(data.str, 10);
        const float = Number.parseFloat(data.decimal);
        return { num, parsed, float };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow Object and Array methods', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const keys = Object.keys(data);
        const values = Object.values(data);
        const entries = Object.entries(data);
        const arr = Array.from(keys);
        const isArray = Array.isArray(data);
        return { keys, values, entries, arr, isArray };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow conditional logic', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', {});
        const results = [];

        for (const user of users.items) {
          if (user.active && user.role === 'admin') {
            const data = await callTool('getData', { id: user.id });
            if (data.value > 100) {
              results.push(data);
            }
          }
        }

        return results;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow destructuring', async () => {
      const code = `
        
        async function __ag_main() {const { items, total } = await callTool('getData', {});
        const [first, second] = items;
        const { id, name } = first;
        return { id, name, total };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow spread operators', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const combined = [...data.items, ...data.extra];
        const obj = { ...data.metadata, extra: 'value' };
        return { combined, obj };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow ternary operators', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const result = data.value > 100 ? 'high' : 'low';
        const status = data.active ? await callTool('getActive', {}) : null;
        return { result, status };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow standard globals (undefined, null, NaN, Infinity)', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const nullValue = null;
        const undefinedValue = undefined;
        const isNaN = Number.isNaN(NaN);
        const isFinite = Number.isFinite(Infinity);
        return { nullValue, undefinedValue, isNaN, isFinite };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });
  });

  describe('Blocked: Reserved Prefixes', () => {
    it('should block __ag_ prefixed identifiers', async () => {
      const code = `
        
        async function __ag_main() {const __ag_internal = 42;
        return __ag_internal;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RESERVED_PREFIX',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should block __safe_ prefixed identifiers', async () => {
      const code = `
        
        async function __ag_main() {const __safe_callTool = () => {};
        return __safe_callTool;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RESERVED_PREFIX',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should block __ag_ prefixed function declarations', async () => {
      const code = `
        
        async function __ag_main() {async function __ag_helper() {
          return 42;
        }
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // Should have both RESERVED_PREFIX and NO_USER_FUNCTION_DECLARATION
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Blocked: Unknown Globals', () => {
    it('should block unknown global identifiers', async () => {
      const code = `
        
        async function __ag_main() {const result = unknownGlobal.something();
        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should block console.log', async () => {
      const code = `
        
        async function __ag_main() {console.log('hello');
        return 42;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });

    it('should block undeclared variables', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        return undeclaredVariable + data.value;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });
  });

  describe('Blocked: User-Defined Functions', () => {
    it('should block function declarations', async () => {
      const code = `
        
        async function __ag_main() {function helper() {
          return 42;
        }
        const result = helper();
        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NO_USER_FUNCTION_DECLARATION',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should block function expressions', async () => {
      const code = `
        
        async function __ag_main() {const helper = function() {
          return 42;
        };
        return helper();
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NO_USER_FUNCTION_EXPRESSION',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should block async function declarations', async () => {
      const code = `
        
        async function __ag_main() {async function helper() {
          return await callTool('getData', {});
        }
        return await helper();
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NO_USER_FUNCTION_DECLARATION',
          }),
        ]),
      );
    });

    it('should block method definitions in objects', async () => {
      const code = `
        
        async function __ag_main() {const obj = {
          method() {
            return 42;
          }
        };
        return obj.method();
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NO_USER_METHOD_SHORTHAND',
            severity: ValidationSeverity.ERROR,
          }),
        ]),
      );
    });

    it('should allow __ag_main wrapper function', async () => {
      const code = `
        async function __ag_main() {
          const data = await callTool('getData', {});
          return data;
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });
  });

  describe('Blocked: Dangerous Identifiers', () => {
    it('should block process access', async () => {
      const code = `
        
        async function __ag_main() {const env = process.env;
        return env;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block require', async () => {
      const code = `
        
        async function __ag_main() {const fs = require('fs');
        return fs;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block eval', async () => {
      const code = `
        
        async function __ag_main() {const result = eval('1 + 1');
        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // Should have both DISALLOWED_IDENTIFIER and NO_EVAL
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
    });

    it('should block Function constructor', async () => {
      const code = `
        
        async function __ag_main() {const fn = new Function('return 1 + 1');
        return fn();
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block constructor access', async () => {
      const code = `
        
        async function __ag_main() {const obj = {};
        const ctor = obj.constructor;
        return ctor;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block __proto__ access', async () => {
      const code = `
        
        async function __ag_main() {const obj = {};
        const proto = obj.__proto__;
        return proto;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block fetch', async () => {
      const code = `
        
        async function __ag_main() {const response = await fetch('https://example.com');
        return response;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block setTimeout', async () => {
      const code = `
        
        async function __ag_main() {setTimeout(() => {}, 1000);
        return 42;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block setInterval', async () => {
      const code = `
        
        async function __ag_main() {setInterval(() => {}, 1000);
        return 42;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should block WebAssembly', async () => {
      const code = `
        
        async function __ag_main() {const module = new WebAssembly.Module(bytes);
        return module;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });
  });

  describe('Blocked: Global Object Access', () => {
    it('should block window access', async () => {
      const code = `

        async function __ag_main() {const win = window;
        return win;

        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // window is caught by UnknownGlobalRule as it's not in the allowed globals list
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });

    it('should block globalThis access', async () => {
      const code = `

        async function __ag_main() {const global = globalThis;
        return global;

        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // globalThis is caught by UnknownGlobalRule as it's not in the allowed globals list
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });

    it('should block global access', async () => {
      const code = `

        async function __ag_main() {const g = global;
        return g;

        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // global is caught by UnknownGlobalRule as it's not in the allowed globals list
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });

    it('should block self access', async () => {
      const code = `

        async function __ag_main() {const s = self;
        return s;

        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      // self is caught by UnknownGlobalRule as it's not in the allowed globals list
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'UNKNOWN_GLOBAL',
          }),
        ]),
      );
    });
  });

  describe('Blocked: Unbounded Loops', () => {
    it('should block while loops', async () => {
      const code = `
        
        async function __ag_main() {let i = 0;
        while (i < 10) {
          i++;
        }
        return i;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'FORBIDDEN_LOOP',
          }),
        ]),
      );
    });

    it('should block do-while loops', async () => {
      const code = `
        
        async function __ag_main() {let i = 0;
        do {
          i++;
        } while (i < 10);
        return i;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'FORBIDDEN_LOOP',
          }),
        ]),
      );
    });

    it('should block for-in loops (prototype walking)', async () => {
      const code = `
        
        async function __ag_main() {const obj = { a: 1, b: 2 };
        for (const key in obj) {
          console.log(key);
        }
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'FORBIDDEN_LOOP',
          }),
        ]),
      );
    });
  });

  describe('Custom Configuration', () => {
    it('should allow custom allowed globals', async () => {
      const code = `
        
        async function __ag_main() {const result = customGlobal.doSomething();
        return result;
      
        }
      `;

      const validator = new JSAstValidator(
        createAgentScriptPreset({
          allowedGlobals: ['callTool', 'customGlobal'],
        }),
      );

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should allow disabling arrow functions', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const mapped = data.items.map(x => x * 2);
        return mapped;
      
        }
      `;

      const strictValidator = new JSAstValidator(
        createAgentScriptPreset({
          allowArrowFunctions: false,
        }),
      );

      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'NO_USER_ARROW_FUNCTION',
          }),
        ]),
      );
    });

    it('should allow additional disallowed identifiers', async () => {
      const code = `
        
        async function __ag_main() {const result = customDangerous();
        return result;
      
        }
      `;

      const validator = new JSAstValidator(
        createAgentScriptPreset({
          allowedGlobals: ['callTool', 'customDangerous'],
          additionalDisallowedIdentifiers: ['customDangerous'],
        }),
      );

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'DISALLOWED_IDENTIFIER',
          }),
        ]),
      );
    });

    it('should allow custom reserved prefixes', async () => {
      const code = `
        
        async function __ag_main() {const __custom_internal = 42;
        return __custom_internal;
      
        }
      `;

      const validator = new JSAstValidator(
        createAgentScriptPreset({
          reservedPrefixes: ['__custom_'],
        }),
      );

      const result = await validator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'RESERVED_PREFIX',
          }),
        ]),
      );
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should validate complex orchestration script', async () => {
      const code = `
        async function __ag_main() {
          // Get all active admin users
          const users = await callTool('users:list', {
            limit: 100,
            filter: { role: 'admin', active: true }
          });

          // Get unpaid invoices for each admin
          const results = [];
          for (const user of users.items) {
            const invoices = await callTool('billing:listInvoices', {
              userId: user.id,
              status: 'unpaid'
            });

            if (invoices.items.length > 0) {
              const totalAmount = invoices.items.reduce((sum, inv) => sum + inv.amount, 0);
              results.push({
                userId: user.id,
                userName: user.name,
                unpaidCount: invoices.items.length,
                totalAmount: Math.round(totalAmount * 100) / 100
              });
            }
          }

          // Sort by total amount descending
          const sorted = results.sort((a, b) => b.totalAmount - a.totalAmount);
          return sorted;
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should validate data aggregation with error handling', async () => {
      const code = `
        
        async function __ag_main() {const users = await callTool('users:list', { limit: 50 });
        const aggregated = [];

        for (const user of users.items) {
          const data = await callTool('users:getData', { id: user.id });

          if (!data || !data.metrics) {
            continue;
          }

          const metrics = {
            userId: user.id,
            total: data.metrics.reduce((sum, m) => sum + m.value, 0),
            average: data.metrics.length > 0
              ? data.metrics.reduce((sum, m) => sum + m.value, 0) / data.metrics.length
              : 0,
            max: Math.max(...data.metrics.map(m => m.value)),
            min: Math.min(...data.metrics.map(m => m.value))
          };

          aggregated.push(metrics);
        }

        return aggregated;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should validate batch processing with transformation', async () => {
      const code = `
        
        async function __ag_main() {const batchSize = 10;
        const allResults = [];

        for (let offset = 0; offset < 100; offset += batchSize) {
          const batch = await callTool('getData', {
            limit: batchSize,
            offset: offset
          });

          const transformed = batch.items
            .filter(item => item.active)
            .map(item => ({
              id: item.id,
              name: String(item.name).toUpperCase(),
              value: Number(item.value),
              timestamp: Date.now()
            }));

          allResults.push(...transformed);
        }

        return allResults;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should throw error for empty code', async () => {
      const code = '';

      const validator = new JSAstValidator(createAgentScriptPreset());

      // Empty code should throw InvalidSourceError
      await expect(validator.validate(code)).rejects.toThrow('Source cannot be empty');
    });

    it('should handle only comments', async () => {
      const code = `
        // This is a comment
        /* This is a block comment */
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should handle nested arrow functions', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const result = data.items
          .map(x => x.values.map(v => v * 2))
          .filter(arr => arr.length > 0)
          .reduce((acc, arr) => [...acc, ...arr], []);
        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should handle complex destructuring patterns', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        const {
          items: [first, ...rest],
          metadata: { total, page }
        } = data;
        return { first, rest, total, page };
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should handle template literals', async () => {
      const code = `
        async function __ag_main() {
          const user = await callTool('getUser', { id: 123 });
          const message = \`Hello \${user.name}, you have \${user.count} items\`;
          return message;
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should handle try-catch blocks', async () => {
      const code = `
        
        async function __ag_main() {let result;
        try {
          result = await callTool('getData', {});
        } catch (err) {
          result = { error: true, message: err.message };
        }
        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });

    it('should handle switch statements', async () => {
      const code = `
        
        async function __ag_main() {const data = await callTool('getData', {});
        let result;

        switch (data.type) {
          case 'user':
            result = await callTool('getUser', { id: data.id });
            break;
          case 'admin':
            result = await callTool('getAdmin', { id: data.id });
            break;
          default:
            result = null;
        }

        return result;
      
        }
      `;

      const validator = new JSAstValidator(createAgentScriptPreset());

      const result = await validator.validate(code);
      expect(result.valid).toBe(true);
    });
  });
});
