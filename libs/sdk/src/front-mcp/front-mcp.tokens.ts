import { type Token } from '@frontmcp/di';

import { type FrontMcpConfigType } from '../common';

export const FrontMcpConfig: Token<FrontMcpConfigType> = Symbol('FrontMcpConfig');
