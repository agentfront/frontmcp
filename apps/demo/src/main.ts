import {FrontMcp, App, tool} from '@frontmcp/sdk';
import {z} from 'zod';
import {OpenapiAdapter} from "@frontmcp/adapters";


const AddTool = tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: {a: z.number(), b: z.number()}
})(async (input, ctx) => {
  return {
    result: input.a + input.b,
  };
})


@App({
  id: 'calc',
  name: 'Calculator',
  tools: [AddTool],
  adapters: [OpenapiAdapter.init({
    name: 'backend:api',
    url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
    baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
  })],
})
class CalcApp {
}

@FrontMcp({
  info: {name: 'Demo 🚀', version: '0.1.0'},
  apps: [CalcApp],
  http: {
    port: 3002
  },
  auth:{
    type: 'remote',
    name: 'frontegg',
    baseUrl: 'https://sample-app.frontegg.com',
  }
})
export default class Server {
}