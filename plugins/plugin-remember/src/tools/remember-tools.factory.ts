import { Tool, type ToolType } from '@frontmcp/sdk';

import ForgetTool, { forgetToolMetadata } from './forget.tool';
import ListMemoriesTool, { listMemoriesToolMetadata } from './list-memories.tool';
import RecallTool, { recallToolMetadata } from './recall.tool';
import RememberThisTool, { rememberThisToolMetadata } from './remember-this.tool';
import { rememberToolNames } from './remember-tool-names';

/**
 * The four memory tools under `prefix`. With no prefix they are the tool classes themselves; with one
 * they are subclasses registered under the prefixed names, whose descriptions name the prefixed
 * siblings (a model told to call `recall` when only `memory_recall` exists would not find it).
 */
export function createRememberTools(prefix = ''): ToolType[] {
  if (!prefix) return [RememberThisTool, RecallTool, ForgetTool, ListMemoriesTool];

  const names = rememberToolNames(prefix);

  @Tool(rememberThisToolMetadata(names))
  class PrefixedRememberThisTool extends RememberThisTool {}

  @Tool(recallToolMetadata(names))
  class PrefixedRecallTool extends RecallTool {}

  @Tool(forgetToolMetadata(names))
  class PrefixedForgetTool extends ForgetTool {}

  @Tool(listMemoriesToolMetadata(names))
  class PrefixedListMemoriesTool extends ListMemoriesTool {}

  return [PrefixedRememberThisTool, PrefixedRecallTool, PrefixedForgetTool, PrefixedListMemoriesTool];
}
