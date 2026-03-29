---
name: production-lambda
description: Checklist for deploying FrontMCP to AWS Lambda with SAM, API Gateway, and DynamoDB
---

# Production Readiness: AWS Lambda

Target-specific checklist for deploying FrontMCP to AWS Lambda.

> Run the `common-checklist` first, then use this checklist for Lambda-specific items.

## SAM / CloudFormation

- [ ] `ci/template.yaml` (SAM template) is configured correctly
- [ ] `frontmcp build --target lambda` produces the correct handler
- [ ] Environment variables are set in the SAM template or SSM Parameter Store
- [ ] API Gateway is configured with correct routes and CORS
- [ ] Lambda function memory and timeout are set appropriately

## Lambda Runtime

- [ ] Handler exports are correct for the Lambda runtime
- [ ] No long-lived connections assumed (Lambda freezes between invocations)
- [ ] No `node:fs` writes to `/tmp` that exceed 512MB
- [ ] Connection reuse pattern is used for external services

## Storage

- [ ] Session storage uses DynamoDB or ElastiCache (not in-memory)
- [ ] Cache uses DynamoDB or ElastiCache
- [ ] Secrets use AWS SSM Parameter Store or Secrets Manager
- [ ] S3 is used for blob/file storage if needed

## Cold Starts

- [ ] Bundle is tree-shaken to minimize size
- [ ] Provisioned concurrency is configured for latency-sensitive endpoints
- [ ] Lazy initialization pattern for database connections
- [ ] No heavy imports at module scope

## Scaling

- [ ] Concurrency limits are set to prevent downstream overload
- [ ] Reserved concurrency for critical functions
- [ ] Dead letter queue (DLQ) configured for failed invocations
- [ ] Connection pooling accounts for Lambda concurrency (use RDS Proxy if needed)

## CI/CD

- [ ] `sam build && sam deploy` works from CI
- [ ] Staging and production stages are separate
- [ ] API Gateway stages are configured correctly
- [ ] CloudWatch alarms are set for errors and throttling
