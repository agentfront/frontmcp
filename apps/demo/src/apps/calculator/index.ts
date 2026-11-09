import { CachePlugin } from '@frontmcp/plugins';
import { App } from '@frontmcp/sdk';

import AbsTool from './tools/abs.tool';
import AddTool from './tools/add.tool';
import CeilTool from './tools/ceil.tool';
import DivideTool from './tools/divide.tool';
import ExpTool from './tools/exp.tool';
import FloorTool from './tools/floor.tool';
import MaxTool from './tools/max.tool';
import MinTool from './tools/min.tool';
import ModuloTool from './tools/modulo.tool';
import MultiplyTool from './tools/multiply.tool';
import PowTool from './tools/pow.tool';
import RoundTool from './tools/round.tool';
import SqrtTool from './tools/sqrt.tool';
import SubtractTool from './tools/subtract.tool';

@App({
  id: 'calculator',
  name: 'Calculator MCP app',
  providers: [],
  plugins: [
    CachePlugin.init({
      type: 'redis',
      config: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
  tools: [
    AddTool,
    SubtractTool,
    MultiplyTool,
    DivideTool,
    PowTool,
    ModuloTool,
    SqrtTool,
    AbsTool,
    FloorTool,
    CeilTool,
    RoundTool,
    MinTool,
    MaxTool,
    ExpTool,
  ],
})
export default class CalculatorMcpApp {}
