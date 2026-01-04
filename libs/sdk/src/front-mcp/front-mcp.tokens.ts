import { Token } from '@frontmcp/di';
import { FrontMcpConfigType } from '../common';

export const FrontMcpConfig: Token<FrontMcpConfigType> = Symbol('FrontMcpConfig');
