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

| Package                        | Version | Supported |
| ------------------------------ | ------- | --------- |
| @frontmcp/sdk                  | 1.0.x   | Yes       |
| @frontmcp/auth                 | 1.0.x   | Yes       |
| @frontmcp/utils                | 1.0.x   | Yes       |
| @frontmcp/adapters             | 1.0.x   | Yes       |
| @frontmcp/plugins              | 1.0.x   | Yes       |
| frontmcp                       | 1.0.x   | Yes       |
| @frontmcp/di                   | 1.0.x   | Yes       |
| @frontmcp/testing              | 1.0.x   | Yes       |
| @frontmcp/ui                   | 1.0.x   | Yes       |
| @frontmcp/uipack               | 1.0.x   | Yes       |
| @frontmcp/guard                | 1.0.x   | Yes       |
| @frontmcp/protocol             | 1.0.x   | Yes       |
| @frontmcp/observability        | 1.0.x   | Yes       |
| @frontmcp/storage-sqlite       | 1.0.x   | Yes       |
| @frontmcp/skills               | 1.0.x   | Yes       |
| @frontmcp/nx                   | 1.0.x   | Yes       |
| @frontmcp/react                | 1.0.x   | Yes       |
| @frontmcp/plugin-cache         | 1.0.x   | Yes       |
| @frontmcp/plugin-codecall      | 1.0.x   | Yes       |
| @frontmcp/plugin-dashboard     | 1.0.x   | Yes       |
| @frontmcp/plugin-remember      | 1.0.x   | Yes       |
| @frontmcp/plugin-feature-flags | 1.0.x   | Yes       |
| @frontmcp/plugin-approval      | 1.0.x   | Yes       |

**Policy**: Only the latest minor version receives security updates. We recommend always using the latest version.

**Runtime**: Node.js 24+ (LTS) is required.

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
