---
name: lambda-handler-with-cors
reference: deploy-to-lambda
level: intermediate
description: CORS for a FrontMCP Lambda is configured at the API Gateway HTTP API level, not in the handler. `frontmcp build --target lambda` writes `dist/lambda/handler.cjs` — your `@FrontMcp` server is wrapped automatically with `@codegenie/serverless-express`, so CORS belongs on the gateway.
tags:
  - deployment
  - lambda
  - handler
  - cors
features:
  - Configuring CORS at the API Gateway HTTP API layer (not the handler) via `CorsConfiguration`
  - 'Linking the function events to the explicit API via `ApiId: !Ref`'
  - Pointing SAM `CodeUri` at `dist/lambda/` so the auto-generated `handler.cjs` is uploaded
---

# Lambda Handler with CORS and API Gateway

CORS for a FrontMCP Lambda is configured at the API Gateway HTTP API level, not in the handler. `frontmcp build --target lambda` writes `dist/lambda/handler.cjs` — your `@FrontMcp` server is wrapped automatically with `@codegenie/serverless-express`, so CORS belongs on the gateway.

## Code

```typescript
// src/main.ts — your @FrontMcp server. The CLI emits the Lambda handler.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'analyze',
  description: 'Analyze text content',
  inputSchema: { text: z.string() },
})
class AnalyzeTool extends ToolContext {
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
export default class AnalyzerServer {}
```

```yaml
# template.yaml — explicit HTTP API with CORS configuration
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
      CodeUri: dist/lambda/
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
# Make sure the peer dep is installed (the build's validate hook checks)
npm install @codegenie/serverless-express

# Build and deploy
frontmcp build --target lambda
sam build && sam deploy
```

## What This Demonstrates

- Configuring CORS at the API Gateway HTTP API layer (not the handler) via `CorsConfiguration`
- Linking the function events to the explicit API via `ApiId: !Ref`
- Pointing SAM `CodeUri` at `dist/lambda/` so the auto-generated `handler.cjs` is uploaded

## Related

- See `deploy-to-lambda` for the peer-dep flow, secrets management, provisioned concurrency, and CDK deployment.
