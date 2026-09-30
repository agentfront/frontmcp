/** Names the four memory tools go by, so the text that points the model at one tool can name it as registered. */
export interface RememberToolNames {
  rememberThis: string;
  recall: string;
  forget: string;
  listMemories: string;
}

export function rememberToolNames(prefix = ''): RememberToolNames {
  return {
    rememberThis: `${prefix}remember_this`,
    recall: `${prefix}recall`,
    forget: `${prefix}forget`,
    listMemories: `${prefix}list_memories`,
  };
}
