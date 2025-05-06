import type { IncomingHttpHeaders } from "http";
import type { AxiosRequestConfig } from "axios";

export interface AuthDevPluginOptions {
  /** URL that completes SSO and sets auth cookies */
  validateUrl: string;
  /** Remote origin you want to proxy to (default inferred from validateUrl) */
  targetOrigin?: string;
  /** One or more path regexes to proxy (default [/^\/api/]) */
  apiPaths?: (RegExp | string)[];
  /** Provide a node‑side login request to pre‑seed cookies (or `false` to skip) */
  headlessLogin?: AxiosRequestConfig | false;
  /** Accept self‑signed certs (dev-only) */
  insecureTLS?: boolean;
  /** Proxy WebSocket upgrade requests too (true = on) */
  ws?: boolean;
  /**
   * Detect when backend responds with "not authenticated".
   * Default: status 401 OR 302 with Location containing "/sso/" or "/login".
   */
  unauthDetector?: (status: number, headers: IncomingHttpHeaders) => boolean;
  /** Extra query param appended to iframe URL (default `silent=true`) */
  iframeParam?: string;
  /** Console / custom logger */
  onLog?: (msg: string) => void;
  /** The name of the authentication cookie to check for in the browser. */
  authCookieName?: string;
  /** The message the iframe posts when SSO is complete. */
  ssoCompleteMessage?: string;
}

export interface NormalizedOptions
  extends Required<
    Omit<
      AuthDevPluginOptions,
      | "targetOrigin"
      | "headlessLogin"
      | "apiPaths"
      | "unauthDetector"
      | "iframeParam"
      | "onLog"
      | "authCookieName"
      | "ssoCompleteMessage"
    >
  > {
  targetOrigin: string;
  apiPaths: (RegExp | string)[];
  headlessLogin: AxiosRequestConfig | false;
  unauthDetector: (status: number, headers: IncomingHttpHeaders) => boolean;
  iframeParam: string;
  onLog: (msg: string) => void;
  authCookieName: string;
  ssoCompleteMessage: string;
}

export function normalizeOptions(
  opts: AuthDevPluginOptions
): NormalizedOptions {
  const targetOrigin = opts.targetOrigin || new URL(opts.validateUrl).origin;
  const apiPaths = opts.apiPaths || [/^\/api/];
  const insecureTLS = opts.insecureTLS || false;
  const headlessLogin =
    opts.headlessLogin === undefined ? false : opts.headlessLogin;
  const ws = opts.ws || false;
  const iframeParam =
    opts.iframeParam === undefined ? "silent=true" : opts.iframeParam;
  const unauthDetector =
    opts.unauthDetector ||
    ((status, headers) =>
      status === 401 ||
      (status === 302 && /\/(login|sso)\//i.test(headers.location ?? "")));
  const onLog =
    opts.onLog ||
    ((_msg: string) => {
      /* Default no-op logger */
    });
  const authCookieName = opts.authCookieName || "myToken";
  const ssoCompleteMessage = opts.ssoCompleteMessage || "myToken-set";

  return {
    ...opts,
    targetOrigin,
    apiPaths,
    insecureTLS,
    headlessLogin,
    ws,
    iframeParam,
    unauthDetector,
    onLog,
    authCookieName,
    ssoCompleteMessage,
  };
}
