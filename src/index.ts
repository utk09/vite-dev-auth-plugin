/**
 * vite-dev-auth-plugin
 * Silent‑SSO & cookie proxy for local Vite development
 */
import {
  Plugin,
  PluginOption,
  ViteDevServer,
  IndexHtmlTransformContext,
} from "vite";
import {
  AuthDevPluginOptions,
  normalizeOptions,
  NormalizedOptions,
} from "./options";
import { CookieJar } from "./cookieUtils";
import { getIframeScript } from "./iframeScript";
import { createApiProxy, doHeadlessLogin } from "./proxyHandler";

export { AuthDevPluginOptions };

/**
 * Vite plugin to handle authentication in development mode.
 * This plugin proxies API requests to a target origin and handles authentication
 * using a headless login method. It also injects an iframe script into the
 * index.html file to manage authentication state.
 * @param opts Plugin options
 * @returns Vite plugin object
 * @see `README.md` for usage example.
 * @see {@link AuthDevPluginOptions} for options
 * @see {@link https://vitejs.dev/guide/api-plugin.html#vite-plugin-api} for Vite plugin API
 */
export default function authDevPlugin(
  opts: AuthDevPluginOptions
): PluginOption {
  const options: NormalizedOptions = normalizeOptions(opts);
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
  const log = (msg: string) => onLog(`[vite-dev-auth] ${msg}`);

  return {
    name: "vite-dev-auth-plugin",

    configureServer: (server: ViteDevServer) => {
      void (async () => {
        log("Plugin configuring server...");
        await doHeadlessLogin(jar, options, "startup");

        const apiProxy = createApiProxy(jar, options);

        server.middlewares.use(apiProxy);
        log(
          `Proxying paths matching filter derived from: [${apiPaths
            .map((p) => (typeof p === "string" ? p : p.source))
            .join(", ")}] to ${targetOrigin}`
        );

        if (ws) {
          log(
            "WebSocket proxy enabled and handled by the main proxy middleware configuration."
          );
        }
        log("Server configuration complete.");
      })();
    },

    transformIndexHtml(_html: string, _ctx: IndexHtmlTransformContext) {
      log("Transforming index.html to inject SSO iframe script.");
      return {
        tags: [
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
        ],
      };
    },
  } as Plugin;
}
