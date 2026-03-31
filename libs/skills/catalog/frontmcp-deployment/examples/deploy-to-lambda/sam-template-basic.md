---
name: sam-template-basic
reference: deploy-to-lambda
level: basic
description: 'Deploy a FrontMCP server to AWS Lambda with API Gateway using a SAM template.'
tags: [deployment, lambda, performance, sam, template]
features:
  - 'A minimal SAM template with ARM64 architecture for faster cold starts and lower cost'
  - "The `/{proxy+}` catch-all route that forwards all requests to FrontMCP's internal router"
  - 'CloudWatch log group with 14-day retention'
---

# Basic SAM Template for Lambda

Deploy a FrontMCP server to AWS Lambda with API Gateway using a SAM template.

## Code

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: FrontMCP server on AWS Lambda

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs24.x
    MemorySize: 512
    Environment:
      Variables:
        NODE_ENV: production
        LOG_LEVEL: info

Resources:
  FrontMcpFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: .
      Description: FrontMCP MCP server
      Architectures:
        - arm64
      Events:
        McpApi:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY
        HealthCheck:
          Type: HttpApi
          Properties:
            Path: /health
            Method: GET

  FrontMcpLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${FrontMcpFunction}
      RetentionInDays: 14

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${ServerlessHttpApi}.execute-api.${AWS::Region}.amazonaws.com'
  FunctionArn:
    Description: Lambda function ARN
    Value: !GetAtt FrontMcpFunction.Arn
```

```bash
# Build for Lambda
frontmcp build --target lambda

# Deploy with guided prompts (first time)
sam build
sam deploy --guided

# Subsequent deploys
sam build && sam deploy

# Get the endpoint URL
aws cloudformation describe-stacks \
  --stack-name frontmcp-prod \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text

# Verify
curl https://abc123.execute-api.us-east-1.amazonaws.com/health
```

## What This Demonstrates

- A minimal SAM template with ARM64 architecture for faster cold starts and lower cost
- The `/{proxy+}` catch-all route that forwards all requests to FrontMCP's internal router
- CloudWatch log group with 14-day retention

## Related

- See `deploy-to-lambda` for Redis/ElastiCache integration, CDK alternative, and provisioned concurrency
