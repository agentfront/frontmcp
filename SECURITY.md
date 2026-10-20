# Security Policy

FrontMCP takes security seriously. We appreciate your efforts to responsibly disclose vulnerabilities and will make every effort to acknowledge your contributions.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately on GitHub, with [Report a vulnerability](https://github.com/agentfront/frontmcp/security/advisories/new) on this repository's Security tab, or by email to **[david@frontegg.com](mailto:david@frontegg.com)**.

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

Every `@frontmcp/*` package and the `frontmcp` CLI are released together, at the same version.

| Version                  | Supported |
| ------------------------ | --------- |
| The latest minor release | Yes       |
| Earlier minor releases   | No        |

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
