# Template: 3rd-party-integration

This template generates a complete MCP tool integration for any third-party API service.

## 🎯 What This Template Generates

A ready-to-use MCP integration with:

✅ Example tools (GET and POST)
✅ Complete authentication setup
✅ Validation scripts
✅ Documentation templates
✅ JSON Schema validation

## 🚀 Usage

```bash
npx frontmcp template
# or
npx frontmcp template 3rd-party-integration
```

## 📋 Interactive Prompts

You'll be asked:

1. **Service owner/provider** - e.g., `slack`, `github`, `google`
2. **Service/product name** - e.g., `api`, `calendar`, `chat`
3. **Primary resource path** - e.g., `messages`, `users`, `repos`
4. **Auth type** - `oauth2`, `bearer`, `apiKey`, or `none`

## 📦 Generated Structure

```
integrations/<owner>/<service>/
├── README.md                    # Customized documentation
├── package.json                 # NPM configuration  
├── .gitignore                   # Git ignore rules
│
├── tools/
│   ├── get_example.json        # GET request template
│   └── create_example.json     # POST request template
│
├── schemas/
│   └── tool-schema.json        # Validation schema
│
└── scripts/
    └── validate.js             # Validation script
```

## 🎨 Template Variables

The following placeholders are replaced during generation:

### Basic Info
- `__OWNER__` → Service owner (e.g., `slack`)
- `__SERVICE__` → Service name (e.g., `api`)
- `__RESOURCE_PATH__` → Primary resource (e.g., `messages`)

### Authentication (Auto-configured based on auth type)
- `__AUTH_TYPE__` → `oauth2`, `bearer`, `apiKey`, or `none`
- `__TOKEN_PATH__` → Where to get token from context
- `__AUTH_TRANSFORM__` → How to format auth header
- `__AUTH_CONFIG__` → Auth configuration in JSON
- `__AUTH_SETUP_INSTRUCTIONS__` → Setup steps
- `__ENV_VARS__` → Environment variable examples

### Generated Names
- `__OWNER_UPPER__` → Uppercase owner (e.g., `SLACK`)
- `__SERVICE_UPPER__` → Uppercase service (e.g., `API`)

## 🔐 Authentication Configurations

### OAuth2
```json
{
  "auth": {
    "type": "oauth2",
    "tokenPath": "access_token"
  }
}
```
- Token path: `payload.access_token`
- Transform: `Bearer {value}`

### Bearer Token
```json
{
  "auth": {
    "type": "bearer",
    "tokenSource": "env.SLACK_API_TOKEN"
  }
}
```
- Token path: `token`
- Transform: `Bearer {value}`

### API Key
```json
{
  "auth": {
    "type": "apiKey",
    "headerName": "X-API-Key",
    "keySource": "env.SLACK_API_API_KEY"
  }
}
```
- Token path: `token`
- Transform: `{value}` (no prefix)

### None
```json
{
  "auth": {
    "type": "none"
  }
}
```
- No authentication configuration needed

## 📝 Example: Generating a Slack Integration

```bash
npx frontmcp template
```

**Prompts & Answers:**
```text
📦 Service owner/provider: slack
🔧 Service/product name: api
📂 Primary resource path: messages
🔐 Auth type: bearer
```

**Generates:**
```text
integrations/slack/api/
├── README.md                    # Slack API documentation
├── tools/
│   ├── get_example.json        # GET /messages/{id}
│   └── create_example.json     # POST /messages
└── ...
```

**In the generated files:**
- API URL: `https://api.slack.com/v1/messages/{id}`
- Auth: Bearer token from `env.SLACK_API_TOKEN`
- Documentation: Slack-specific setup instructions

## 🛠️ After Generation

### 1. Install Dependencies
```bash
cd integrations/<owner>/<service>
npm install
```

### 2. Customize Tools
Edit the example tools:
- Update API endpoints
- Adjust input/output schemas
- Add more tools as needed

### 3. Update Documentation
Edit `README.md`:
- Add tool descriptions
- Document authentication
- Provide usage examples

### 4. Validate
```bash
npm run validate
```

### 5. Test
Test against the real API with proper credentials.

## 📚 Template Files Explained

### tools/get_example.json
A complete GET request template showing:
- Path parameter mapping (`{id}`)
- Authentication header setup
- Response mapping from API format
- Error handling (404, 4xx, 5xx)
- Rate limit extraction from headers

**Customize:**
- Change URL and resource path
- Update input parameters
- Map actual API response fields
- Add/remove error cases

### tools/create_example.json
A complete POST request template showing:
- Request body mapping
- Optional fields with conditions
- Multiple response status codes (201, 400, 4xx)
- Field validation errors
- Timestamp and metadata injection

**Customize:**
- Change URL and resource path
- Update input schema for creation
- Map actual API request/response
- Handle service-specific errors

### README.md
Pre-filled documentation template with:
- Service-specific auth instructions
- Environment variable setup
- Tool documentation structure
- Links to API docs

**Customize:**
- Fill in actual tool descriptions
- Update auth instructions with real steps
- Add usage examples
- Link to actual API documentation

### package.json
Ready-to-use package configuration with:
- Validation scripts
- Dependencies for JSON Schema validation
- Metadata fields

**Customize:**
- Update package name if needed
- Add testing scripts
- Add additional dependencies

### scripts/validate.js
Working validation script that:
- Finds all JSON tool files
- Validates against schema
- Reports results clearly

**Use as-is** - works out of the box

## 🎯 Best Practices

### 1. Start Small
- Generate the template
- Customize one tool (GET is easier)
- Validate and test
- Add more tools gradually

### 2. Follow Naming Conventions
- Tool names: `snake_case` (e.g., `send_message`, `list_users`)
- File names: Match tool names (e.g., `send_message.json`)
- Descriptive but concise

### 3. Document Everything
- Clear descriptions for tools
- Document all input parameters
- Explain output fields
- Provide working examples

### 4. Test Thoroughly
- Test with real API credentials
- Test all error cases
- Verify rate limit handling
- Check edge cases

## 🔍 Validation

The template includes automatic validation:

```bash
npm run validate
```

Checks:
- JSON syntax
- Schema compliance
- Required fields
- Valid mappings

## 📖 Documentation

After generation, see the generated `README.md` for:
- Service-specific documentation
- Authentication setup
- Tool usage examples
- API references

## 🤝 Contributing

To improve this template:
1. Identify common patterns
2. Add to example tools
3. Update documentation
4. Test with multiple services

## 💡 Tips

**For GET Requests:**
- Focus on query parameters
- Handle pagination
- Extract rate limits

**For POST Requests:**
- Validate inputs thoroughly
- Handle creation errors
- Return created resource details

**For All Tools:**
- Use clear field names
- Add helpful comments in mappings
- Handle all error cases
- Extract useful metadata from headers

## 🚨 Common Issues

### Issue: Validation Fails
**Check:** `$schema` field is present in all JSON schemas

### Issue: Auth Not Working
**Check:** Environment variables are set correctly

### Issue: Mapping Not Working
**Check:** Response structure matches your mappings

### Issue: Tool Name Invalid
**Check:** Using `snake_case` not `camelCase`

## 📞 Support

- Read the generated README.md
- Check tool-schema.json for schema reference
- See examples in the production package
- Review the MCP Tools Marketplace documentation

---

**Ready to build your integration!** 🚀

Start with: `npx frontmcp template`
