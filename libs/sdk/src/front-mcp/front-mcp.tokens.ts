import { FrontMcpConfigType, FrontMcpScopeInterface, Token } from '../common';
import { FrontMcpServerInstance } from '../server/server.instance';


export const FrontMcpConfig: Token<FrontMcpConfigType> = Symbol('FrontMcpConfig');
