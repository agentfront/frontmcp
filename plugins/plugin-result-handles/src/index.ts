export { default, default as ResultHandlesPlugin } from './result-handles.plugin';
export { default as ResultQueryTool, RESULT_QUERY_TOOL_NAME } from './result-query.tool';
export { foldedAnswerSchema, type AnswerShape, type FoldedAnswer } from './folded-answer';
export {
  MIN_THRESHOLD_BYTES,
  RESULT_HANDLE_META_KEY,
  type FoldContext,
  type FoldPolicy,
  type ResultHandlesPluginOptions,
  type ResultHandlesPluginOptionsInput,
} from './result-handles.options';
export { ResultHandleStore, type ResultOwner } from './result-handle.store';
export { createResultHandleStore, type ResultHandleStoreOptions } from './result-handle-store.factory';
export { ResultHandlesConfigToken, ResultHandleStoreToken } from './result-handles.symbols';
export {
  ResultHandleNotFoundError,
  ResultHandlesConfigurationError,
  ResultPathNotFoundError,
  ResultSliceTooLargeError,
} from './result-handles.errors';
