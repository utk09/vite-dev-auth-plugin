import https from "https";
import axios from "axios";
import {
  createProxyMiddleware,
  Options as ProxyOptions,
} from "http-proxy-middleware";
import type { ClientRequest, IncomingMessage } from "http";
import { ServerResponse } from "http";
import { Socket } from "net";
import { CookieJar, storeCookies, jarToString } from "./cookieUtils";
import { NormalizedOptions } from "./options";

let refreshingPromise: Promise<void> | undefined;

/** prevent requests while login refresh happening */
async function gateRefresh() {
  if (refreshingPromise) await refreshingPromise;
}

export async function doHeadlessLogin(
  jar: CookieJar,
  options: Pick<
    NormalizedOptions,
    "validateUrl" | "headlessLogin" | "insecureTLS" | "onLog"
  >,
  label: string
): Promise<void> {
  const { validateUrl, headlessLogin, insecureTLS, onLog } = options;
  if (!headlessLogin) return;

  const httpsAgent = new https.Agent({ rejectUnauthorized: !insecureTLS });
  const log = (msg: string) => onLog(`[vite‑auth-dev] ${msg}`);

  try {
    const res = await axios({
      url: validateUrl,
      method: "GET",
      withCredentials: true,
      httpsAgent,
      ...headlessLogin,
    });
    storeCookies(jar, res.headers["set-cookie"]);
    log(`headless login (${label}) ✅`);
  } catch (e: unknown) {
    let message = "Unknown error during headless login";
    if (e instanceof Error) {
      message = e.message;
    } else if (typeof e === "string") {
      message = e;
    }
    log(`headless login (${label}) failed: ${message}`);
  }
}

export function createApiProxy(jar: CookieJar, options: NormalizedOptions) {
  const {
    targetOrigin,
    insecureTLS,
    ws,
    unauthDetector,
    onLog,
    validateUrl,
    headlessLogin,
    apiPaths,
  } = options;

  const httpsAgent = new https.Agent({ rejectUnauthorized: !insecureTLS });
  const log = (msg: string) => onLog(`[vite‑auth-dev] ${msg}`);
  let activeRefreshPromise: Promise<void> | undefined;

  const filterFunction = (pathname: string, _req: IncomingMessage): boolean => {
    return apiPaths.some((p) => {
      if (typeof p === "string") {
        return (
          pathname.startsWith(p) &&
          (pathname.length === p.length || pathname[p.length] === "/")
        );
      } else {
        return p.test(pathname);
      }
    });
  };

  const proxyOpts: ProxyOptions = {
    target: targetOrigin,
    changeOrigin: true,
    secure: !insecureTLS,
    selfHandleResponse: false,
    agent: httpsAgent,
    pathFilter: filterFunction,
    on: {
      proxyReq: (
        proxyReqFramework: ClientRequest,
        _reqFramework: IncomingMessage,
        _resFramework: ServerResponse
      ) => {
        void (async () => {
          await gateRefresh();
          const existingCookies = proxyReqFramework.getHeader("cookie") as
            | string
            | undefined;
          const pluginCookies = jarToString(jar);
          const combinedCookies = [existingCookies, pluginCookies]
            .filter(Boolean)
            .join("; ");
          if (combinedCookies) {
            proxyReqFramework.setHeader("cookie", combinedCookies);
          }
        })();
      },

      proxyRes: (
        proxyRes: IncomingMessage,
        _req: IncomingMessage,
        _res: ServerResponse
      ) => {
        storeCookies(jar, proxyRes.headers["set-cookie"]);

        if (unauthDetector(proxyRes.statusCode ?? 0, proxyRes.headers)) {
          if (!activeRefreshPromise) {
            log(
              "Backend indicates unauthenticated state – attempting cookie refresh."
            );
            activeRefreshPromise = doHeadlessLogin(
              jar,
              { validateUrl, headlessLogin, insecureTLS, onLog },
              "refresh"
            ).finally(() => {
              activeRefreshPromise = undefined;
            });
          }
        }
      },
      error: (
        err: Error,
        _req: IncomingMessage,
        res: ServerResponse | Socket
      ) => {
        log(`Proxy error: ${err.message}`);
        if (res instanceof ServerResponse) {
          if (!res.closed) {
            res.writeHead(500, {
              "Content-Type": "text/plain",
            });
            res.end("Proxy error occurred.");
          }
        } else if (res instanceof Socket) {
          log(`Proxy error on WebSocket: ${err.message}. Closing socket.`);
          if (!res.destroyed) {
            res.destroy(err);
          }
        }
      },
    },
  };

  if (ws) {
    proxyOpts.ws = true;
  }

  return createProxyMiddleware(proxyOpts);
}
