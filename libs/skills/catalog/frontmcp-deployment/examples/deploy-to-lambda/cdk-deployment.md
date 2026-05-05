---
name: cdk-deployment
reference: deploy-to-lambda
level: advanced
description: 'Deploy a FrontMCP server to AWS Lambda using CDK with provisioned concurrency and secrets management.'
tags: [deployment, lambda, performance, cdk]
features:
  - 'Using AWS CDK instead of SAM for infrastructure-as-code deployment'
  - 'Provisioned concurrency via a Lambda alias to eliminate cold starts on critical endpoints'
  - 'Referencing secrets from SSM Parameter Store with `{{resolve:ssm:...}}` instead of hardcoding'
---

# CDK Deployment with Provisioned Concurrency

Deploy a FrontMCP server to AWS Lambda using CDK with provisioned concurrency and secrets management.

## Code

```typescript
// lib/frontmcp-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class FrontMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'FrontMcpHandler', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/lambda'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      architecture: lambda.Architecture.ARM_64,
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        // Use SSM for secrets instead of plaintext
        FRONTMCP_AUTH_SECRET: cdk.Fn.sub('{{resolve:ssm-secure:/frontmcp/auth-secret}}'),
      },
    });

    // Provisioned concurrency for predictable latency
    const alias = new lambda.Alias(this, 'ProdAlias', {
      aliasName: 'prod',
      version: fn.currentVersion,
      provisionedConcurrentExecutions: 5,
    });

    const api = new apigw.HttpApi(this, 'FrontMcpApi', {
      defaultIntegration: new integrations.HttpLambdaIntegration(
        'LambdaIntegration',
        alias, // Route traffic to the alias with provisioned concurrency
      ),
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.apiEndpoint,
    });
  }
}
```

```bash
# Install the peer dep validated by the lambda adapter
npm install @codegenie/serverless-express

# Build the FrontMCP server — emits dist/lambda/handler.cjs
frontmcp build --target lambda

# Store secrets in SSM Parameter Store
aws ssm put-parameter \
  --name "/frontmcp/auth-secret" \
  --type "SecureString" \
  --value "your-secret-value"

# Deploy with CDK
cdk deploy

# Verify (FrontMCP serves /healthz by default)
curl https://abc123.execute-api.us-east-1.amazonaws.com/healthz
```

## What This Demonstrates

- Using AWS CDK instead of SAM for infrastructure-as-code deployment
- Provisioned concurrency via a Lambda alias to eliminate cold starts on critical endpoints
- Referencing secrets from SSM Parameter Store with `{{resolve:ssm:...}}` instead of hardcoding

## Related

- See `deploy-to-lambda` for the SAM alternative, cold start benchmarks, and VPC configuration for ElastiCache
