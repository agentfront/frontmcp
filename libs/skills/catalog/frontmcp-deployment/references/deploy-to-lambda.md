---
name: deploy-to-lambda
description: Deploy a FrontMCP server to AWS Lambda with API Gateway using SAM or CDK
---

# Deploy a FrontMCP Server to AWS Lambda

This skill walks you through deploying a FrontMCP server to AWS Lambda with API Gateway using SAM or CDK.

## When to Use This Skill

### Must Use

- Deploying a FrontMCP server to AWS Lambda behind API Gateway
- Setting up a SAM or CDK stack for a serverless MCP endpoint on AWS
- Integrating with AWS-native services like ElastiCache, Secrets Manager, or CloudWatch

### Recommended

- Your organization standardizes on AWS and you need IAM-based access control
- You want provisioned concurrency for predictable latency on critical MCP endpoints
- Deploying across multiple AWS regions with infrastructure-as-code (SAM or CDK)

### Skip When

- Deploying to Vercel or you prefer a simpler serverless DX -- use `deploy-to-vercel` instead
- You need a long-lived process with WebSockets or persistent connections -- use `deploy-to-node` instead
- You do not use AWS and want to avoid managing IAM roles, VPCs, and CloudFormation stacks

> **Decision:** Choose this skill when you need serverless deployment within the AWS ecosystem; choose a different target when you want simpler ops or a non-AWS platform.

## Prerequisites

- AWS account with appropriate IAM permissions
- AWS CLI configured: `aws configure`
- SAM CLI installed: `brew install aws-sam-cli` (macOS) or see AWS docs
- Node.js 24 or later
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

FrontMCP generates a Lambda handler file (`handler.cjs` with a `handler` export) during the build step. In SAM/CDK, reference it as `handler.handler`. To customize the handler, create a `lambda.ts` entry point:

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
  runtime: lambda.Runtime.NODEJS_24_X,
  handler: 'handler.handler',
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

## Common Patterns

| Pattern            | Correct                                                        | Incorrect                               | Why                                                                                                |
| ------------------ | -------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Build command      | `frontmcp build --target lambda`                               | `tsc` or generic bundler                | The Lambda target produces a single optimized handler with tree-shaking for cold-start performance |
| Architecture       | `arm64` (Graviton)                                             | `x86_64`                                | ARM64 functions initialize faster and cost less per ms of compute                                  |
| Handler path       | `handler.handler` in SAM template                              | `index.handler` or `src/lambda.handler` | The FrontMCP build outputs to `dist/`; mismatched paths cause 502 errors                           |
| Secrets management | SSM Parameter Store or Secrets Manager (`{{resolve:ssm:...}}`) | Plaintext env vars in `template.yaml`   | SSM/Secrets Manager encrypts values at rest and supports rotation                                  |
| Redis connectivity | Lambda in same VPC as ElastiCache with security groups         | Public Redis endpoint from Lambda       | VPC peering ensures low latency and keeps traffic off the public internet                          |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target lambda` completes without errors
- [ ] `handler.handler` exists and exports a `handler` function

**SAM / CDK**

- [ ] `sam build` succeeds without errors
- [ ] `sam deploy --guided` creates the CloudFormation stack
- [ ] Stack outputs include the API Gateway endpoint URL

**Runtime**

- [ ] `curl https://<api-id>.execute-api.<region>.amazonaws.com/health` returns `{"status":"ok"}`
- [ ] CloudWatch Logs show successful invocations without errors
- [ ] `NODE_ENV` is set to `production` in the function configuration

**Production Readiness**

- [ ] Sensitive values use SSM Parameter Store or Secrets Manager
- [ ] Log retention is configured (e.g., 14 days)
- [ ] If using Redis, Lambda is in the same VPC as ElastiCache with correct security groups
- [ ] Provisioned concurrency is enabled for latency-sensitive endpoints (if applicable)

## Troubleshooting

| Problem                              | Cause                                                           | Solution                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Timeout errors                       | Function timeout too low or waiting on unreachable resource     | Increase `Timeout` in the SAM template; verify network connectivity to dependencies                       |
| 502 Bad Gateway                      | Handler path mismatch, missing env vars, or unhandled exception | Check CloudWatch Logs; confirm `Handler` matches `handler.handler`                                        |
| Cold starts too slow                 | Low memory, x86 architecture, or large bundle                   | Increase memory to 512+ MB, use `arm64`, or enable provisioned concurrency                                |
| Redis connection refused from Lambda | Lambda not in the same VPC as ElastiCache                       | Place the Lambda in the ElastiCache VPC with appropriate security group rules                             |
| `sam deploy` fails with IAM error    | Insufficient permissions for CloudFormation stack creation      | Ensure the deploying IAM user/role has `cloudformation:*`, `lambda:*`, `apigateway:*`, and `iam:PassRole` |

## Examples

| Example                                                                                | Level        | Description                                                                                           |
| -------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| [`cdk-deployment`](../examples/deploy-to-lambda/cdk-deployment.md)                     | Advanced     | Deploy a FrontMCP server to AWS Lambda using CDK with provisioned concurrency and secrets management. |
| [`lambda-handler-with-cors`](../examples/deploy-to-lambda/lambda-handler-with-cors.md) | Intermediate | Create a custom Lambda handler with an explicit API Gateway definition for CORS support.              |
| [`sam-template-basic`](../examples/deploy-to-lambda/sam-template-basic.md)             | Basic        | Deploy a FrontMCP server to AWS Lambda with API Gateway using a SAM template.                         |

> See all examples in [`examples/deploy-to-lambda/`](../examples/deploy-to-lambda/)

## Reference

- **Docs:** https://docs.agentfront.dev/frontmcp/deployment/serverless
- **Related skills:** `deploy-to-node`, `deploy-to-vercel`
