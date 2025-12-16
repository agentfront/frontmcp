import { App } from '@frontmcp/sdk';
import ThrowValidationErrorTool from './tools/throw-validation-error.tool';
import ThrowNotFoundTool from './tools/throw-not-found.tool';
import ThrowInternalErrorTool from './tools/throw-internal-error.tool';
import ThrowCustomErrorTool from './tools/throw-custom-error.tool';
import SuccessfulTool from './tools/successful.tool';
import ErrorCodesResource from './resources/error-codes.resource';
import ErrorExplanationPrompt from './prompts/error-explanation.prompt';

@App({
  name: 'errors',
  tools: [ThrowValidationErrorTool, ThrowNotFoundTool, ThrowInternalErrorTool, ThrowCustomErrorTool, SuccessfulTool],
  resources: [ErrorCodesResource],
  prompts: [ErrorExplanationPrompt],
})
export class ErrorsApp {}
