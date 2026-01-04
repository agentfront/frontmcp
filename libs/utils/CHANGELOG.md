# Changelog

## 0.0.1

- Initial release
- Extracted utilities from @frontmcp/sdk, @frontmcp/cli, and @frontmcp/adapters
- Added naming utilities: splitWords, toCase, sepFor, shortHash, ensureMaxLen, idFromString
- Added URI utilities: isValidMcpUri, extractUriScheme, isValidMcpUriTemplate, parseUriTemplate, matchUriTemplate, expandUriTemplate, extractTemplateParams, isUriTemplate
- Added path utilities: trimSlashes, joinPath
- Added content utilities: sanitizeToJson, inferMimeType
- Added HTTP utilities: validateBaseUrl
- Added FS utilities: fileExists, readJSON, writeJSON, ensureDir, isDirEmpty, runCmd
