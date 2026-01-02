import { Token } from '@frontmcp/di';
import { FrontMcpConfigType, FrontMcpScopeInterface } from '../common';
import { FrontMcpServerInstance } from '../server/server.instance';

export const FrontMcpConfig: Token<FrontMcpConfigType> = Symbol('FrontMcpConfig');
