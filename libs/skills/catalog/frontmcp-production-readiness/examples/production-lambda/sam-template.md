---
name: sam-template
reference: production-lambda
level: basic
description: 'Shows a complete SAM/CloudFormation template for deploying a FrontMCP server to AWS Lambda with API Gateway routing, DynamoDB for session storage, and proper environment configuration.'
tags: [production, lambda, session, sam, template]
features:
  - 'Complete SAM template with API Gateway, Lambda function, and DynamoDB table'
  - 'DynamoDB for session storage with TTL-based automatic cleanup'
  - 'Lambda handler entry point via `createLambdaHandler`'
  - 'Pay-per-request billing for cost-effective scaling'
  - 'IAM policies scoped to the specific DynamoDB table'
---

# SAM Template with API Gateway and DynamoDB

Shows a complete SAM/CloudFormation template for deploying a FrontMCP server to AWS Lambda with API Gateway routing, DynamoDB for session storage, and proper environment configuration.

## Code

```yaml
# ci/template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: FrontMCP Lambda deployment

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        NODE_ENV: production
        SESSION_TABLE: !Ref SessionTable

Resources:
  McpFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/lambda.handler
      CodeUri: .
      Events:
        McpApi:
          Type: Api
          Properties:
            Path: /mcp/{proxy+}
            Method: ANY
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionTable

  SessionTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: mcp-sessions
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: sessionId
          AttributeType: S
      KeySchema:
        - AttributeName: sessionId
          KeyType: HASH
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/mcp/'
```

```typescript
// src/lambda.ts — Lambda handler entry point
import { createLambdaHandler } from '@frontmcp/adapters/lambda';
import Server from './main';

export const handler = createLambdaHandler(Server);
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './my.app';

@FrontMcp({
  info: { name: 'lambda-mcp', version: '1.0.0' },
  apps: [MyApp],
  cors: {
    origin: ['https://app.example.com'],
  },
})
export default class LambdaMcpServer {}
```

## What This Demonstrates

- Complete SAM template with API Gateway, Lambda function, and DynamoDB table
- DynamoDB for session storage with TTL-based automatic cleanup
- Lambda handler entry point via `createLambdaHandler`
- Pay-per-request billing for cost-effective scaling
- IAM policies scoped to the specific DynamoDB table

## Related

- See `production-lambda` for the full SAM/CloudFormation and Lambda runtime checklist
