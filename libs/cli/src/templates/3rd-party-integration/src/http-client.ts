import { ExecuteContext } from "./mcp-http-types";

export interface HttpRequestOptions {
  method: string;
  path: string; // already resolved (including path params)
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  bodyJson?: unknown;
}

export interface HttpResponseRaw {
  status: number;
  headers: Record<string, string>;
  json?: any;
  text?: string;
}

export class HttpClient {
  constructor(private ctx: ExecuteContext) {}

  private resolveAuthHeader(): Record<string, string> {
    const { auth } = this.ctx;
    if (auth.oauth2?.accessToken) {
      return { Authorization: `Bearer ${auth.oauth2.accessToken}` };
    }
    if (auth.bearer?.token) {
      return { Authorization: `Bearer ${auth.bearer.token}` };
    }
    if (auth.apiKey?.value) {
      const headerName = auth.apiKey.name ?? "X-API-Key";
      return { [headerName]: auth.apiKey.value };
    }
    return {};
  }

  async request(options: HttpRequestOptions): Promise<HttpResponseRaw> {
    const fetchImpl = this.ctx.fetch ?? fetch;
    const url = new URL(options.path, this.ctx.baseUrl);

    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      ...(this.ctx.requestId ? { "X-Request-Id": this.ctx.requestId } : {}),
      ...this.resolveAuthHeader(),
      ...(options.headers ?? {})
    };

    const controller = new AbortController();
    const timeoutMs = this.ctx.timeoutMs ?? 15000;
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = {
      method: options.method,
      headers: baseHeaders,
      signal: controller.signal
    };

    if (options.bodyJson !== undefined) {
      init.body = JSON.stringify(options.bodyJson);
      baseHeaders["Content-Type"] = baseHeaders["Content-Type"] ?? "application/json";
    }

    if (this.ctx.logDebug) {
      console.debug("[HttpClient] Request", {
        url: url.toString(),
        method: options.method,
        headers: baseHeaders,
        body: options.bodyJson
      });
    }

    try {
      const res = await fetchImpl(url.toString(), init);
      const headersObj = Object.fromEntries(res.headers.entries());

      let json: any | undefined;
      let text: string | undefined;
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        try {
          json = await res.json();
        } catch {
          json = undefined;
        }
      } else {
        try {
          text = await res.text();
        } catch {
          text = undefined;
        }
      }

      if (this.ctx.logDebug) {
        console.debug("[HttpClient] Response", {
          status: res.status,
          headers: headersObj,
          json,
          text
        });
      }

      return {
        status: res.status,
        headers: headersObj,
        json,
        text
      };
    } finally {
      clearTimeout(t);
    }
  }
}
