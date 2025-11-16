import {FrontMcp, LogLevel} from '@frontmcp/sdk';
import ExpenseMcpApp from "./apps/expenses";
import CalculatorMcpApp from "./apps/calculator";
import EmployeeTimeMcpApp from "./apps/employee-time";


@FrontMcp({
  info: {name: 'Demo 🚀', version: '0.1.0'},
  apps: [ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp],
  logging: {level: LogLevel.VERBOSE},
  splitByApp: true,
  http: {
    port: 3002
  }
})
export default class Server {
}