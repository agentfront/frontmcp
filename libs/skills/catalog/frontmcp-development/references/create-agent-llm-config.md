# Agent LLM Configuration Reference

## Supported Providers

### Anthropic

```typescript
llm: {
  provider: 'anthropic', // Any supported provider — 'anthropic', 'openai', etc.
  model: 'claude-sonnet-4-20250514', // Any supported model for the chosen provider
  apiKey: { env: 'ANTHROPIC_API_KEY' },
  maxTokens: 4096,
}
```

### OpenAI

```typescript
llm: {
  provider: 'openai',
  model: 'gpt-4o', // Any supported model for the chosen provider
  apiKey: { env: 'OPENAI_API_KEY' },
  maxTokens: 4096,
}
```

## API Key Sources

```typescript
// From environment variable (recommended)
apiKey: {
  env: 'ANTHROPIC_API_KEY';
}

// Direct string (not recommended for production)
apiKey: 'sk-...';
```

## Common Models

| Provider  | Model                      | Use Case             |
| --------- | -------------------------- | -------------------- |
| Anthropic | `claude-sonnet-4-20250514` | Fast, capable        |
| Anthropic | `claude-opus-4-20250514`   | Most capable         |
| OpenAI    | `gpt-4o`                   | General purpose      |
| OpenAI    | `gpt-4o-mini`              | Fast, cost-effective |
