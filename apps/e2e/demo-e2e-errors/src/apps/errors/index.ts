import { App } from '@frontmcp/sdk';

import ErrorExplanationPrompt from './prompts/error-explanation.prompt';
import ErrorCodesResource from './resources/error-codes.resource';
import SuccessfulTool from './tools/successful.tool';
import ThrowCustomErrorTool from './tools/throw-custom-error.tool';
import ThrowInternalErrorTool from './tools/throw-internal-error.tool';
import ThrowNotFoundTool from './tools/throw-not-found.tool';
import ThrowValidationErrorTool from './tools/throw-validation-error.tool';

@App({
  name: 'errors',
  tools: [ThrowValidationErrorTool, ThrowNotFoundTool, ThrowInternalErrorTool, ThrowCustomErrorTool, SuccessfulTool],
  resources: [ErrorCodesResource],
  prompts: [ErrorExplanationPrompt],
})
export class ErrorsApp {}
