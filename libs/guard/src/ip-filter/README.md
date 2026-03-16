# ip-filter

IP address filtering with CIDR notation support for both IPv4 and IPv6.

## How It Works

The `IpFilter` class parses allow and deny lists at construction time into an internal representation using bigint arithmetic. Each CIDR rule (e.g., `10.0.0.0/8` or `2001:db8::/32`) is parsed into a base address and a bitmask. Plain IP addresses without a prefix length are treated as `/32` (IPv4) or `/128` (IPv6).

When `check(clientIp)` is called:

1. Parse the client IP to a bigint value.
2. Check the **deny list first** -- if the IP matches any deny rule, it is blocked immediately (`reason: 'denylisted'`).
3. Check the **allow list** -- if configured and the IP matches, it is allowed (`reason: 'allowlisted'`).
4. If neither list matches, apply `defaultAction` (`'allow'` or `'deny'`).

This means the deny list always takes precedence over the allow list.

## Supported Formats

- IPv4: `192.168.1.1`, `10.0.0.0/8`
- IPv6: `2001:db8::1`, `fe80::/10`
- IPv4-mapped IPv6: `::ffff:192.168.1.1`
- Invalid or unparseable IPs fall back to the `defaultAction`.

## Exports

- `IpFilter` -- the filter class
- `IpFilterConfig` -- configuration type (`allowList`, `denyList`, `defaultAction`, `trustProxy`, `trustedProxyDepth`)
- `IpFilterResult` -- result type (`allowed`, `reason`, `matchedRule`)

## Usage

```typescript
import { IpFilter } from '@frontmcp/guard';

const filter = new IpFilter({
  allowList: ['192.168.0.0/16', '10.10.0.0/24'],
  denyList: ['192.168.1.100'],
  defaultAction: 'deny',
});

filter.check('192.168.2.50');
// { allowed: true, reason: 'allowlisted', matchedRule: '192.168.0.0/16' }

filter.check('192.168.1.100');
// { allowed: false, reason: 'denylisted', matchedRule: '192.168.1.100' }

filter.check('8.8.8.8');
// { allowed: false, reason: 'default' }

// Quick check for allow-list membership (useful for rate-limit bypass)
filter.isAllowListed('10.10.0.5'); // true
```

## No External Dependencies

This module is pure computation -- no storage adapter or external libraries required.
