import {FrontMcp, LogLevel} from '@frontmcp/sdk';
import ExpenseMcpApp from "./apps/expenses";


@FrontMcp({
  info: {name: 'Demo 🚀', version: '0.1.0'},
  apps: [ExpenseMcpApp],
  logging: {level: LogLevel.VERBOSE},
  http: {
    port: 3002
  },
  auth: {
    type: 'remote',
    name: 'frontegg',
    baseUrl: 'https://sample-app.frontegg.com',
  }
})
export default class Server {
}