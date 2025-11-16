import {App} from '@frontmcp/sdk';

import AddTool from "./tools/add.tool";
import SubtractTool from "./tools/subtract.tool";
import MultiplyTool from "./tools/multiply.tool";
import DivideTool from "./tools/divide.tool";
import PowTool from "./tools/pow.tool";
import ModuloTool from "./tools/modulo.tool";
import SqrtTool from "./tools/sqrt.tool";
import AbsTool from "./tools/abs.tool";
import FloorTool from "./tools/floor.tool";
import CeilTool from "./tools/ceil.tool";
import RoundTool from "./tools/round.tool";
import MinTool from "./tools/min.tool";
import MaxTool from "./tools/max.tool";
import ExpTool from "./tools/exp.tool";
import {CachePlugin} from "@frontmcp/plugins";

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
      }
    })
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
export default class CalculatorMcpApp {
}
