import { Prompt, PromptContext, GetPromptResult, MCP_ERROR_CODES } from '@frontmcp/sdk';

@Prompt({
  name: 'error-explanation',
  description: 'Explain MCP error codes and their meanings',
  arguments: [{ name: 'errorCode', description: 'Specific error code to explain', required: false }],
})
export default class ErrorExplanationPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const errorCode = args['errorCode'];
    const errorDescriptions = {
      RESOURCE_NOT_FOUND: {
        code: MCP_ERROR_CODES.RESOURCE_NOT_FOUND,
        title: 'Resource Not Found',
        explanation: 'The requested resource does not exist or is not accessible.',
        example: 'Attempting to read a file that has been deleted.',
      },
      INVALID_REQUEST: {
        code: MCP_ERROR_CODES.INVALID_REQUEST,
        title: 'Invalid Request',
        explanation: 'The JSON-RPC request is malformed or invalid.',
        example: 'Missing required "method" field in the request.',
      },
      METHOD_NOT_FOUND: {
        code: MCP_ERROR_CODES.METHOD_NOT_FOUND,
        title: 'Method Not Found',
        explanation: 'The requested RPC method does not exist.',
        example: 'Calling a method that is not implemented.',
      },
      INVALID_PARAMS: {
        code: MCP_ERROR_CODES.INVALID_PARAMS,
        title: 'Invalid Parameters',
        explanation: 'The parameters provided to the method are invalid.',
        example: 'Passing a string where a number is expected.',
      },
      INTERNAL_ERROR: {
        code: MCP_ERROR_CODES.INTERNAL_ERROR,
        title: 'Internal Error',
        explanation: 'An internal server error occurred.',
        example: 'Database connection failure or unexpected exception.',
      },
      PARSE_ERROR: {
        code: MCP_ERROR_CODES.PARSE_ERROR,
        title: 'Parse Error',
        explanation: 'Invalid JSON was received by the server.',
        example: 'Malformed JSON syntax in the request body.',
      },
    };

    let content: string;

    if (errorCode && errorDescriptions[errorCode as keyof typeof errorDescriptions]) {
      const error = errorDescriptions[errorCode as keyof typeof errorDescriptions];
      content = `# ${error.title} (${error.code})

## Explanation
${error.explanation}

## Example
${error.example}`;
    } else {
      content = `# MCP Error Codes Reference

${Object.entries(errorDescriptions)
  .map(
    ([name, error]) => `## ${name} (${error.code})
**${error.title}**
${error.explanation}
*Example: ${error.example}*`,
  )
  .join('\n\n')}`;
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: content,
          },
        },
      ],
      description: errorCode ? `Explanation of ${errorCode} error` : 'MCP error codes reference',
    };
  }
}
