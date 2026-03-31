---
name: lambda-handler-with-cors
reference: deploy-to-lambda
level: intermediate
description: 'Create a custom Lambda handler with an explicit API Gateway definition for CORS support.'
tags: [deployment, lambda, handler, cors]
features:
  - 'Creating a custom Lambda handler with `createLambdaHandler()` from `@frontmcp/adapters/lambda`'
  - 'Defining an explicit HTTP API resource with CORS configuration for cross-origin requests'
  - 'Linking the function events to the explicit API via `ApiId: !Ref`'
---

# Lambda Handler with CORS and API Gateway

Create a custom Lambda handler with an explicit API Gateway definition for CORS support.

## Code

```typescript
// src/lambda.ts
import { createLambdaHandler } from '@frontmcp/adapters/lambda';
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'analyze',
  description: 'Analyze text content',
  inputSchema: { text: z.string() },
})
class AnalyzeTool extends ToolContext<{ text: string }> {
  async execute(input: { text: string }) {
    return {
      content: [{ type: 'text' as const, text: `Analysis of: ${input.text}` }],
    };
  }
}

@App({ name: 'AnalyzerApp', tools: [AnalyzeTool] })
class AnalyzerApp {}

@FrontMcp({
  info: { name: 'analyzer', version: '1.0.0' },
  apps: [AnalyzerApp],
})
class AnalyzerServer {}

export const handler = createLambdaHandler(AnalyzerServer, {
  streaming: false,
});
```

```yaml
# template.yaml - with explicit API Gateway and CORS
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: FrontMCP server with CORS

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs24.x
    MemorySize: 512

Resources:
  FrontMcpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: prod
      CorsConfiguration:
        AllowOrigins:
          - 'https://your-domain.com'
        AllowMethods:
          - GET
          - POST
          - OPTIONS
        AllowHeaders:
          - Content-Type
          - Authorization

  FrontMcpFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Architectures:
        - arm64
      Environment:
        Variables:
          NODE_ENV: production
      Events:
        McpApi:
          Type: HttpApi
          Properties:
            ApiId: !Ref FrontMcpApi
            Path: /{proxy+}
            Method: ANY
```

```bash
# Build and deploy
frontmcp build --target lambda
sam build && sam deploy
```

## What This Demonstrates

- Creating a custom Lambda handler with `createLambdaHandler()` from `@frontmcp/adapters/lambda`
- Defining an explicit HTTP API resource with CORS configuration for cross-origin requests
- Linking the function events to the explicit API via `ApiId: !Ref`

## Related

- See `deploy-to-lambda` for secrets management, provisioned concurrency, and CDK deployment
