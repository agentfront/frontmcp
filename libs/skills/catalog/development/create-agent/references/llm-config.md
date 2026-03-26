# Agent LLM Configuration Reference

## Supported Adapters

### Anthropic

```typescript
llm: {
  adapter: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: { env: 'ANTHROPIC_API_KEY' },
  maxTokens: 4096,
}
```

### OpenAI

```typescript
llm: {
  adapter: 'openai',
  model: 'gpt-4o',
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
