# OAuth Orchestration and Well-Known Endpoints – Flow Charts

This document visualizes how the gateway:
- Scans and detects orchestrated auth providers (per provider and per scope)
- Mounts well-known routes (scoped vs unsuffixed)
- Computes the returned content for each well-known endpoint

References to source files and lines are included for traceability.

---

## 1) Detecting Orchestrated Providers and Scopes

Rules from auth.registry.ts:
- isOrchestratedForProvider (lines 192–203)
  - Orchestrated if gateway forces options.auth.orchestrate === true
  - Local provider implies orchestrated
  - Remote provider orchestrated if mode is orchestrated or enableConsent is true
- buildScopesByApp (lines 205–220): scope.orchestrated = isOrchestratedForProvider(provider)
- buildScopesByAuth (lines 222–247): scope.orchestrated if gateway forces, or providers.length > 1, or any provider orchestrated
- buildSingleScope (lines 249–260): scope.orchestrated if gateway forces, or multiple unique providers, or any provider orchestrated

```mermaid
flowchart TD
    A[Inputs] --> B{Gateway forces orchestrate?}
    B -- Yes --> O[Mark orchestrated]
    B -- No --> C{Provider kind}
    C -- local --> O
    C -- remote --> D{Remote mode orchestrated or consent enabled?}
    D -- Yes --> O
    D -- No --> N[Provider not orchestrated]
    N --> E{Grouping has multiple providers?}
    E -- Yes --> O
    E -- No --> F{Any provider orchestrated?}
    F -- Yes --> O
    F -- No --> T[Scope transparent]
```

Notes:
- In by-app grouping, the scope contains a single provider; the flag comes directly from isOrchestratedForProvider.
- In by-auth or single grouping, multi-provider scopes are always orchestrated.

---

## 2) Mounting Well-Known Routes

Where routes are mounted:
- auth.registry.ts registerRoutes (lines 276–288)
  - Always registers scoped well-knowns via oauth.registerScopedRoutes
  - Registers unsuffixed well-knowns only for the entry owner when the owner scope is orchestrated or a single transparent remote
- services/oauth.service.ts (lines 87–102)
  - registerScopedRoutes mounts three well-known endpoints for scoped variants
  - registerGatewayRoutes mounts the same endpoints without scope suffix
- Path variants from auth.utils.ts makeWellKnownPaths (lines 35–42)

```mermaid
flowchart TD
    A[Each scope] --> B[Register scoped well-knowns]
    A --> C[Pick entry owner]
    C --> D{Current scope is owner and orchestrated or single transparent remote?}
    D -- Yes --> E[Register unsuffixed well-knowns]
    D -- No --> F[Skip unsuffixed]
```

Path variants for each name (from makeWellKnownPaths):
- Reversed root: /.well-known/<name><entryPrefix><scopeBase>
- In prefix root: <entryPrefix>/.well-known/<name><scopeBase>
- In prefix and scope: <entryPrefix><scopeBase>/.well-known/<name>

Names used: oauth-protected-resource, oauth-authorization-server, jwks.json

---

## 3) /.well-known/oauth-authorization-server (AS metadata)

Source: flows/well-known.authorization-server.flow.ts
- parseInput (lines 94–117): derives issuer, baseUrl, isUnsuffixedPath
- collectData (lines 124–175): branching behavior

```mermaid
flowchart TD
    A[Request] --> B{Scope orchestrated?}
    B -- Yes --> C[200 metadata JSON]
    B -- No --> D{Unsuffixed and single transparent remote?}
    D -- Yes --> E[302 redirect to upstream AS metadata]
    D -- No --> F[404 not available here]
```

200 response includes issuer, authorization_endpoint, token_endpoint, userinfo_endpoint, jwks_uri, optional registration_endpoint, and supported arrays.

---

## 4) /.well-known/jwks.json (JWKS)

Source: flows/well-known.jwks.flow.ts
- parseInput (lines 82–102): derives isUnsuffixedPath
- collectData (lines 108–167): branching behavior and upstream JWKS discovery

```mermaid
flowchart TD
    A[Request] --> B{Scope orchestrated?}
    B -- Yes --> C[200 JSON with gateway public keys]
    B -- No --> D{Unsuffixed and single transparent remote?}
    D -- Yes --> E[Fetch upstream AS metadata to find jwks_uri]
    E --> F{jwks_uri found?}
    F -- Yes --> G[302 redirect to jwks_uri]
    F -- No --> H{Provider jwksUri configured?}
    H -- Yes --> I[302 redirect to provider jwksUri]
    H -- No --> J[404 upstream jwks_uri not discoverable]
    D -- No --> K[404 jwks not available here]
```

---

## 5) /.well-known/oauth-protected-resource (PRM)

Source: flows/well-known.protected-resource.flow.ts
- parseInput (lines 65–79): derives issuer, baseUrl, routeKind
- collectData (lines 85–135): branching behavior

```mermaid
flowchart TD
    A[Request] --> B{Scope orchestrated?}
    B -- Yes --> C[200 JSON, resource equals baseUrl for unsuffixed else issuer, authorization_servers equals baseUrl]
    B -- No --> D[Transparent]
    D --> E[authorization_servers resolved or defaults to issuer]
    E --> F{Unsuffixed and single transparent remote?}
    F -- Yes --> G[resource equals baseUrl, scopes_supported from provider or config]
    F -- No --> H{Single provider?}
    H -- Yes --> I[scopes_supported from provider or config]
    H -- No --> J[scopes_supported from config]
    G --> K[200 JSON]
    I --> K
    J --> K
```

Returned fields: resource, authorization_servers, scopes_supported, bearer_methods_supported header.

---

## 6) Variable and Path Definitions

- baseUrl = protocol + host + entryPath (auth.utils.ts lines 4–8)
- issuer (scoped) = baseUrl + entryPrefix + scopeBase (auth.utils.ts lines 10–14)
- entryPrefix = normalized gateway prefix (path.utils.ts lines 6–10)
- scopeBase = normalized scope suffix (path.utils.ts lines 12–16)
- makeWellKnownPaths(name, entryPrefix, scopeBase) returns three variants (auth.utils.ts lines 35–42)

---

## 7) Summary

- Orchestration can be forced globally, implied by local providers, by remote provider settings, or by multi-provider scopes
- Scoped well-known routes are always mounted; unsuffixed ones are mounted only by the entry owner and only when the owner is orchestrated or a single transparent remote
- Each well-known endpoint has a clear decision tree for responses based on scope.orchestrated, route kind or unsuffixed path, and provider composition
