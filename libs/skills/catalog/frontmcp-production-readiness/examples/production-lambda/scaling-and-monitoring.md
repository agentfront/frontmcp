---
name: scaling-and-monitoring
reference: production-lambda
level: advanced
description: 'Shows how to configure concurrency limits, dead letter queues, provisioned concurrency, and CloudWatch alarms for a production Lambda deployment.'
tags: [production, lambda, performance, scaling, monitoring]
features:
  - 'Reserved concurrency to prevent downstream service overload'
  - 'Provisioned concurrency for latency-sensitive endpoints (reduces cold starts)'
  - 'Dead letter queue (DLQ) for capturing failed invocations'
  - 'CloudWatch alarms for error rate and throttling detection'
  - 'Loading secrets from AWS SSM Parameter Store instead of environment variables'
---

# Lambda Scaling, Concurrency Limits, and CloudWatch Monitoring

Shows how to configure concurrency limits, dead letter queues, provisioned concurrency, and CloudWatch alarms for a production Lambda deployment.

## Code

```yaml
# ci/template.yaml — scaling and monitoring additions
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  McpFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: dist/lambda.handler
      CodeUri: .
      Runtime: nodejs20.x
      Timeout: 30
      MemorySize: 512
      # Reserved concurrency prevents downstream overload
      ReservedConcurrentExecutions: 100
      # Provisioned concurrency for latency-sensitive endpoints
      AutoPublishAlias: live
      ProvisionedConcurrencyConfig:
        ProvisionedConcurrentExecutions: 5
      # Dead letter queue for failed invocations
      DeadLetterQueue:
        Type: SQS
        TargetArn: !GetAtt DeadLetterQueue.Arn
      Environment:
        Variables:
          NODE_ENV: production
          SECRETS_PATH: /mcp/production/

  DeadLetterQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: mcp-dlq
      MessageRetentionPeriod: 1209600 # 14 days

  # CloudWatch alarm: error rate
  ErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: mcp-lambda-errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref McpFunction

  # CloudWatch alarm: throttling
  ThrottleAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: mcp-lambda-throttles
      MetricName: Throttles
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 1
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref McpFunction
```

```typescript
// src/providers/secrets.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const SECRETS = Symbol('Secrets');

@Provider({ token: SECRETS, scope: ProviderScope.GLOBAL })
export class SecretsProvider {
  private cache = new Map<string, string>();

  async onInit(): Promise<void> {
    // Load secrets from AWS SSM Parameter Store (not env vars for sensitive data)
    const { SSMClient, GetParametersByPathCommand } = await import('@aws-sdk/client-ssm');
    const ssm = new SSMClient({});
    const path = process.env.SECRETS_PATH ?? '/mcp/production/';

    const result = await ssm.send(
      new GetParametersByPathCommand({
        Path: path,
        WithDecryption: true,
      }),
    );

    for (const param of result.Parameters ?? []) {
      const key = param.Name?.replace(path, '') ?? '';
      this.cache.set(key, param.Value ?? '');
    }
  }

  get(key: string): string {
    const value = this.cache.get(key);
    if (!value) {
      throw new Error(`Secret not found: ${key}`);
    }
    return value;
  }
}
```

## What This Demonstrates

- Reserved concurrency to prevent downstream service overload
- Provisioned concurrency for latency-sensitive endpoints (reduces cold starts)
- Dead letter queue (DLQ) for capturing failed invocations
- CloudWatch alarms for error rate and throttling detection
- Loading secrets from AWS SSM Parameter Store instead of environment variables

## Related

- See `production-lambda` for the full CI/CD and scaling checklist
