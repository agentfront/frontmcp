# Security Policy

FrontMCP takes security seriously. We appreciate your efforts to responsibly disclose vulnerabilities and will make every effort to acknowledge your contributions.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **[david@frontegg.com](mailto:david@frontegg.com)**

When reporting a vulnerability, please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Affected versions
- Potential impact assessment
- Any suggested fixes (if available)

### What to Expect

- **Initial Response**: We aim to acknowledge receipt within 48 hours
- **Status Updates**: We will provide updates on the investigation within 7 days
- **Resolution**: We will work to address confirmed vulnerabilities promptly and coordinate disclosure timing with you

## Supported Versions

| Package            | Version | Supported |
| ------------------ | ------- | --------- |
| @frontmcp/sdk      | 0.7.x   | Yes       |
| @frontmcp/auth     | 0.7.x   | Yes       |
| @frontmcp/utils    | 0.7.x   | Yes       |
| @frontmcp/adapters | 0.7.x   | Yes       |
| @frontmcp/plugins  | 0.7.x   | Yes       |
| frontmcp           | 0.7.x   | Yes       |
| @frontmcp/di       | 0.7.x   | Yes       |
| @frontmcp/testing  | 0.7.x   | Yes       |
| @frontmcp/ui       | 0.7.x   | Yes       |
| @frontmcp/uipack   | 0.7.x   | Yes       |

**Policy**: Only the latest minor version receives security updates. We recommend always using the latest version.

**Runtime**: Node.js 22+ (LTS) is required.

## Security Features

FrontMCP implements security best practices throughout the framework:

### Cryptography

- **Encryption**: AES-256-GCM for symmetric encryption
- **Key Derivation**: HKDF-SHA256 (RFC 5869)
- **Hashing**: SHA-256 via @noble/hashes
- **JWT**: jose library for JSON Web Token handling
- **PKCE**: OAuth PKCE support (RFC 7636)

### Data Protection

- Encrypted session storage
- Encrypted credential vault
- Timing-safe comparisons for sensitive operations
- Cross-platform crypto (Node.js native + browser @noble implementations)

### Code Quality

- 95%+ test coverage requirement
- Strict TypeScript (no `any` types without justification)
- Snyk dependency scanning
- ESLint security rules

## External Packages

The following packages have been moved to their own repositories and maintain separate security policies:

- `ast-guard`
- `vectoriadb`
- `enclave-vm`
- `json-schema-to-zod-v3`
- `mcp-from-openapi`

Please refer to their respective repositories for security-related information.

## Acknowledgments

We thank the security researchers and community members who help keep FrontMCP secure through responsible disclosure.
