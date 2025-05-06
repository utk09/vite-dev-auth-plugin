import { PluginOption, ViteDevServer, IndexHtmlTransformContext } from "vite";
import https from "https";
import axios, { AxiosRequestConfig } from "axios";
import {
  createProxyMiddleware,
  Options as ProxyOptions,
} from "http-proxy-middleware";
import { ClientRequest, IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

//
// ─── USER‑CONFIGURED OPTIONS ──────────────────────────────────────────────
//
export interface AuthDevPluginOptions {
  /** URL that completes SSO and sets auth cookies */
  validateUrl: string;
  /** Remote origin you want to proxy to (default inferred from validateUrl) */
  targetOrigin?: string;
  /** One or more path regexes/strings to proxy (default [/^\/api/]) */
  apiPaths?: (RegExp | string)[];
  /** Provide a node‑side login request to pre‑seed cookies (or `false` to skip) */
  headlessLogin?: AxiosRequestConfig | false;
  /** Accept self‑signed certs (dev‑only) */
  insecureTLS?: boolean;
  /** Proxy WebSocket upgrade requests too */
  ws?: boolean;
  /**
   * Detect when backend responds "not authenticated".
   * Default: status 401 OR 302 → /login or /sso/
   */
  unauthDetector?: (
    status: number,
    headers: IncomingMessage["headers"]
  ) => boolean;
  /** Extra query param appended to iframe URL (default `silent=true`) */
  iframeParam?: string;
  /** Console / custom logger */
  onLog?: (msg: string) => void;
  /** The name of the authentication cookie to check in the browser */
  authCookieName?: string;
  /** The message the iframe posts when SSO is complete */
  ssoCompleteMessage?: string;
  /**
   * Rewrite or strip the *Domain=* attribute on `Set‑Cookie` headers.
   * Same signature as http‑proxy‑middleware:
   *  - `"localhost"` (string)      → Domain is rewritten to `localhost`
   *  - `""` (empty string)         → Domain attribute is stripped
   *  - `{ "foo.com": "bar.com" }`  → map of <from> → <to> rewrites
   *  - `false`                     → do NOT touch the Domain attribute
   *
   * Default: `"localhost"`
   */
  cookieDomainRewrite?: string | boolean | Record<string, string>;
}

//
// ─── NORMALISATION & DEFAULTS ─────────────────────────────────────────────
//
interface NormalizedOptions
  extends Required<
    Omit<
      AuthDevPluginOptions,
      | "targetOrigin"
      | "apiPaths"
      | "headlessLogin"
      | "unauthDetector"
      | "iframeParam"
      | "onLog"
      | "authCookieName"
      | "ssoCompleteMessage"
      | "cookieDomainRewrite"
    >
  > {
  targetOrigin: string;
  apiPaths: (RegExp | string)[];
  headlessLogin: AxiosRequestConfig | false;
  unauthDetector: (
    status: number,
    headers: IncomingMessage["headers"]
  ) => boolean;
  iframeParam: string;
  onLog: (msg: string) => void;
  authCookieName: string;
  ssoCompleteMessage: string;
  cookieDomainRewrite: string | false | Record<string, string>;
}

function normalizeOptions(opts: AuthDevPluginOptions): NormalizedOptions {
  const targetOrigin = opts.targetOrigin || new URL(opts.validateUrl).origin;
  const apiPaths = opts.apiPaths || [/^\/api/];
  const insecureTLS = opts.insecureTLS ?? false;
  const headlessLogin =
    opts.headlessLogin === undefined ? false : opts.headlessLogin;
  const ws = opts.ws ?? false;
  const iframeParam = opts.iframeParam ?? "silent=true";
  const unauthDetector =
    opts.unauthDetector ||
    ((status, headers) =>
      status === 401 ||
      (status === 302 && /\/(login|sso)\//i.test(headers.location ?? "")));
  const onLog =
    opts.onLog ??
    (() => {
      /* no‑op */
    });
  const authCookieName = opts.authCookieName ?? "myToken";
  const ssoCompleteMessage = opts.ssoCompleteMessage ?? "myToken-set";
  const cookieDomainRewriteInput =
    opts.cookieDomainRewrite === undefined
      ? "localhost"
      : opts.cookieDomainRewrite;

  const cookieDomainRewrite =
    cookieDomainRewriteInput === true ? false : cookieDomainRewriteInput;

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
    cookieDomainRewrite,
  };
}

//
// ─── COOKIE‑JAR UTILITIES ────────────────────────────────────────────────
//
type CookieJar = Map<string, string>;

function storeCookies(jar: CookieJar, raw: string | string[] | undefined) {
  if (!raw) return;
  const lines = Array.isArray(raw) ? raw : [raw];
  for (const line of lines) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      jar.set(name, value);
    }
  }
}

function jarToString(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

//
// ─── IFRAME‑INJECT SCRIPT ───────────────────────────────────────────────
//
function getIframeScript(
  validateUrl: string,
  iframeParam: string,
  authCookieName: string,
  ssoCompleteMessage: string
): string {
  const glue = validateUrl.includes("?") ? "&" : "?";
  const src = `${validateUrl}${iframeParam ? glue + iframeParam : ""}`;
  return `
(function(){
  if (document.cookie.includes('${authCookieName}')) return;
  let _resolve;
  window.__SSO_READY__ = new Promise(r => { _resolve = r; });
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.src = '${src}';
  function append() {
    if (!document.body) return document.addEventListener('DOMContentLoaded', append);
    document.body.appendChild(f);
  }
  append();
  window.addEventListener('message', e => {
    if (e.data === '${ssoCompleteMessage}') {
      console.log('SSO complete');
      _resolve();
    }
  });
  setTimeout(() => { _resolve(); }, 15000);
})();
`.trim();
}

//
// ─── PROXY & HEADLESS LOGIN ──────────────────────────────────────────────
//
let globalRefresh: Promise<void> | undefined;
async function gateRefresh() {
  if (globalRefresh) await globalRefresh;
}

async function doHeadlessLogin(
  jar: CookieJar,
  options: Pick<
    NormalizedOptions,
    "validateUrl" | "headlessLogin" | "insecureTLS" | "onLog"
  >,
  label: string
) {
  const { validateUrl, headlessLogin, insecureTLS, onLog } = options;
  if (!headlessLogin) return;
  const httpsAgent = new https.Agent({ rejectUnauthorized: !insecureTLS });
  const log = (m: string) => onLog(`[vite-auth-dev] ${m}`);
  try {
    const res = await axios({
      url: validateUrl,
      method: "GET",
      withCredentials: true,
      httpsAgent,
      ...headlessLogin,
    });
    storeCookies(jar, res.headers["set-cookie"]);
    log(`headless login (${label}) succeeded`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    log(
      `headless login (${label}) failed: ${
        (err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
          ? (err as { message: unknown }).message
          : undefined) || err
      }`
    );
  }
}

function createApiProxy(jar: CookieJar, options: NormalizedOptions) {
  const {
    targetOrigin,
    insecureTLS,
    ws,
    unauthDetector,
    onLog,
    validateUrl,
    headlessLogin,
    apiPaths,
    cookieDomainRewrite,
  } = options;

  const httpsAgent = new https.Agent({ rejectUnauthorized: !insecureTLS });
  const log = (m: string) => onLog(`[vite-auth-dev] ${m}`);
  let activeRefresh: Promise<void> | undefined;

  const filterFn = (pathname: string) =>
    apiPaths.some((p) =>
      typeof p === "string"
        ? pathname.startsWith(p) &&
          (pathname.length === p.length || pathname[p.length] === "/")
        : p.test(pathname)
    );

  const proxyOpts: ProxyOptions = {
    target: targetOrigin,
    changeOrigin: true,
    secure: !insecureTLS,
    agent: httpsAgent,
    pathFilter: filterFn,
    cookieDomainRewrite,
    on: {
      proxyReq: (pr: ClientRequest) => {
        (async () => {
          await gateRefresh();
          const existing = pr.getHeader("cookie") as string | undefined;
          const fromJar = jarToString(jar);
          const combo = [existing, fromJar].filter(Boolean).join("; ");
          if (combo) pr.setHeader("cookie", combo);
        })().catch(() => /* ignore */ {});
      },
      proxyRes: (pres: IncomingMessage) => {
        storeCookies(jar, pres.headers["set-cookie"]);
        if (unauthDetector(pres.statusCode ?? 0, pres.headers)) {
          if (!activeRefresh) {
            log("Unauthenticated → refreshing cookies");
            activeRefresh = doHeadlessLogin(
              jar,
              { validateUrl, headlessLogin, insecureTLS, onLog },
              "refresh"
            ).finally(() => (activeRefresh = undefined));
          }
        }
      },
      error: (err: Error, _req, res: ServerResponse | Socket) => {
        log(`Proxy error: ${err.message}`);
        if (res instanceof ServerResponse && !res.closed) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Proxy error");
        } else if (res instanceof Socket && !res.destroyed) {
          res.destroy(err);
        }
      },
    },
  };

  if (ws) proxyOpts.ws = true;
  return createProxyMiddleware(proxyOpts);
}

//
// ─── THE VITE PLUGIN ─────────────────────────────────────────────────────
//
export default function authDevPlugin(
  opts: AuthDevPluginOptions
): PluginOption {
  const options = normalizeOptions(opts);
  const {
    ws,
    validateUrl,
    iframeParam,
    onLog,
    apiPaths,
    targetOrigin,
    authCookieName,
    ssoCompleteMessage,
  } = options;

  const jar: CookieJar = new Map();
  const log = (m: string) => onLog(`[vite-dev-auth] ${m}`);

  return {
    name: "vite-dev-auth-plugin",

    configureServer(server: ViteDevServer) {
      (async () => {
        log("Starting headless login…");
        globalRefresh = doHeadlessLogin(jar, options, "startup").finally(
          () => (globalRefresh = undefined)
        );
        await globalRefresh;

        const proxy = createApiProxy(jar, options);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        server.middlewares.use(proxy);
        log(
          `Proxying [${apiPaths
            .map((p) => (typeof p === "string" ? p : p.source))
            .join(", ")}] → ${targetOrigin}`
        );
        if (ws) log("WebSocket proxy enabled.");
      })().catch(() => /* ignore */ {});
    },

    transformIndexHtml(_html: string, _ctx: IndexHtmlTransformContext) {
      log("Injecting SSO iframe script");
      return [
        {
          injectTo: "head-prepend",
          tag: "script",
          children: getIframeScript(
            validateUrl,
            iframeParam,
            authCookieName,
            ssoCompleteMessage
          ),
        },
      ];
    },
  };
}
