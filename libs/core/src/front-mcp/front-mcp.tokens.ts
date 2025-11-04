import { FrontMcpConfigType, FrontMcpScopeInterface, Token } from '@frontmcp/sdk';
import { FrontMcpServerInstance } from '../server/server.instance';


export const FrontMcpConfig: Token<FrontMcpConfigType> = Symbol('FrontMcpConfig');
