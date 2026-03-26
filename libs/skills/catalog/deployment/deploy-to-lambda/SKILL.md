---
name: deploy-to-lambda
description: Deploy a FrontMCP server to AWS Lambda with API Gateway. Use when deploying to AWS, setting up SAM or CDK, or configuring Lambda handlers.
tags:
  - deployment
  - lambda
  - aws
  - serverless
parameters:
  - name: runtime
    description: AWS Lambda runtime version
    type: string
    required: false
    default: nodejs22.x
  - name: memory
    description: Lambda function memory in MB
    type: number
    required: false
    default: 512
  - name: timeout
    description: Lambda function timeout in seconds
    type: number
    required: false
    default: 30
  - name: region
    description: AWS region for deployment
    type: string
    required: false
    default: us-east-1
examples:
  - scenario: Deploy with SAM
    parameters:
      memory: 512
      timeout: 30
      region: us-east-1
    expected-outcome: A FrontMCP server deployed as an AWS Lambda function behind API Gateway, managed by SAM.
  - scenario: Deploy with CDK
    parameters:
      memory: 1024
      timeout: 60
      region: eu-west-1
    expected-outcome: A FrontMCP server deployed via AWS CDK with API Gateway and Lambda.
compatibility: AWS CLI and SAM CLI required
license: Apache-2.0
visibility: both
priority: 10
metadata:
  category: deployment
  difficulty: advanced
  platform: aws
  docs: https://docs.agentfront.dev/frontmcp/deployment/serverless
---

# Deploy a FrontMCP Server to AWS Lambda

This skill walks you through deploying a FrontMCP server to AWS Lambda with API Gateway using SAM or CDK.

## Prerequisites

- AWS account with appropriate IAM permissions
- AWS CLI configured: `aws configure`
- SAM CLI installed: `brew install aws-sam-cli` (macOS) or see AWS docs
- Node.js 22 or later
- A FrontMCP project ready to build

## Step 1: Build for Lambda

```bash
frontmcp build --target lambda
```

This produces a Lambda-compatible output with a single handler file optimized for cold-start performance, minimized bundle size with tree-shaking, and a `template.yaml` scaffold for SAM.

## Step 2: SAM Template

Create `template.yaml` in your project root:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: FrontMCP server on AWS Lambda

Globals:
  Function:
    Timeout: 30
    Runtime: nodejs22.x
    MemorySize: 512
    Environment:
      Variables:
        NODE_ENV: production
        LOG_LEVEL: info

Resources:
  FrontMcpFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/lambda.handler
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
      Environment:
        Variables:
          REDIS_URL: !If
            - HasRedis
            - !Ref RedisUrl
            - ''
      Policies:
        - AWSLambdaBasicExecutionRole

  FrontMcpLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${FrontMcpFunction}
      RetentionInDays: 14

Conditions:
  HasRedis: !Not [!Equals [!Ref RedisUrl, '']]

Parameters:
  RedisUrl:
    Type: String
    Default: ''
    Description: Redis connection URL for session storage

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${ServerlessHttpApi}.execute-api.${AWS::Region}.amazonaws.com'
  FunctionArn:
    Description: Lambda function ARN
    Value: !GetAtt FrontMcpFunction.Arn
```

## Step 3: API Gateway

SAM automatically creates an HTTP API (API Gateway v2) from the `Events` block. The `/{proxy+}` route catches all paths and forwards them to FrontMCP's internal router.

For more control, define the API explicitly:

```yaml
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
```

## Step 4: Handler Configuration

FrontMCP generates a Lambda handler at `dist/lambda.handler` during the build step. To customize the handler, create a `lambda.ts` entry point:

```typescript
import { createLambdaHandler } from '@frontmcp/adapters/lambda';
import { AppModule } from './app.module';

export const handler = createLambdaHandler(AppModule, {
  streaming: false,
});
```

## Step 5: Environment Variables

Configure environment variables in the SAM template or set them after deployment:

```bash
aws lambda update-function-configuration \
  --function-name FrontMcpFunction \
  --environment "Variables={NODE_ENV=production,LOG_LEVEL=info,REDIS_URL=redis://your-redis:6379}"
```

| Variable               | Description                         | Required          |
| ---------------------- | ----------------------------------- | ----------------- |
| `NODE_ENV`             | Runtime environment                 | Yes               |
| `REDIS_URL`            | Redis/ElastiCache connection string | If using sessions |
| `LOG_LEVEL`            | Logging verbosity                   | No                |
| `FRONTMCP_AUTH_SECRET` | Secret for signing auth tokens      | If using auth     |

For sensitive values, use AWS Systems Manager Parameter Store or Secrets Manager:

```yaml
Environment:
  Variables:
    FRONTMCP_AUTH_SECRET: !Sub '{{resolve:ssm:/frontmcp/auth-secret}}'
```

## Step 6: Deploy

### First Deployment (Guided)

```bash
sam build
sam deploy --guided
```

The guided deployment prompts for stack name, region, and parameter overrides. Answers are saved in `samconfig.toml` for subsequent deploys.

### Subsequent Deployments

```bash
sam build && sam deploy
```

### CDK Alternative

If you prefer AWS CDK over SAM:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

const fn = new lambda.Function(this, 'FrontMcpHandler', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'dist/lambda.handler',
  code: lambda.Code.fromAsset('.'),
  memorySize: 512,
  timeout: cdk.Duration.seconds(30),
  architecture: lambda.Architecture.ARM_64,
  environment: {
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
  },
});

const api = new apigw.HttpApi(this, 'FrontMcpApi', {
  defaultIntegration: new integrations.HttpLambdaIntegration('LambdaIntegration', fn),
});
```

Deploy with:

```bash
cdk deploy
```

## Step 7: Verify

```bash
# Get the endpoint from stack outputs
aws cloudformation describe-stacks \
  --stack-name frontmcp-prod \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text

# Health check
curl https://abc123.execute-api.us-east-1.amazonaws.com/health
```

## Cold Start Mitigation

Lambda cold starts occur when a new execution environment is initialized. Strategies to reduce their impact:

1. **Provisioned Concurrency** -- pre-warms execution environments (incurs cost when idle):

   ```yaml
   FrontMcpFunction:
     Properties:
       ProvisionedConcurrencyConfig:
         ProvisionedConcurrentExecutions: 5
   ```

2. **Small bundles** -- the `frontmcp build --target lambda` output is already optimized, but audit your dependencies.

3. **ARM64 runtime** -- ARM functions initialize faster than x86. The template uses `arm64` by default.

4. **Higher memory** -- CPU scales proportionally with memory. 512 MB or 1024 MB is a good starting point.

### Typical Cold Start Times

| Memory  | Cold Start (ARM64) | Cold Start (x86) |
| ------- | ------------------ | ---------------- |
| 256 MB  | ~800ms             | ~1000ms          |
| 512 MB  | ~500ms             | ~700ms           |
| 1024 MB | ~350ms             | ~500ms           |

## Troubleshooting

- **Timeout errors**: Increase `Timeout` in the SAM template. Check if the function is waiting on an unreachable resource.
- **502 Bad Gateway**: Check CloudWatch logs. Common causes: handler path mismatch, missing environment variables, unhandled exceptions.
- **Cold starts too slow**: Increase memory allocation, use ARM64, or enable provisioned concurrency.
- **Redis from Lambda**: Place the Lambda function in the same VPC as your ElastiCache cluster with appropriate security groups.
