# @utk09/vite-dev-auth-plugin

A Vite plugin designed to simplify handling Single Sign-On (SSO) and authentication during local development. It mimics production authentication flows (often handled by services like Nginx) by proxying API requests and managing authentication cookies, without requiring a complex local setup.

## How it Works

The plugin employs a couple of strategies to acquire and use authentication cookies:

1. **Headless Login (Optional)**:
    * On Vite server startup, the plugin can make a server-side HTTP request (configurable via `headlessLogin` options) to your specified `validateUrl` or another authentication endpoint.
    * Cookies returned by this request (e.g., session cookies, auth tokens) are stored by the plugin.

2. **Iframe-based SSO (Client-Side)**:
    * The plugin injects an invisible iframe into your `index.html`.
    * This iframe loads the `validateUrl` (e.g., your SSO provider's authentication page).
    * The browser then goes through the SSO flow within the iframe. If successful, the SSO provider sets authentication cookies directly in the browser for `localhost`.
    * The iframe can communicate its status back to the main application (e.g., by posting a message).

3. **API Request Proxying**:
    * The plugin intercepts requests from your Vite application to paths defined in `apiPaths`.
    * These requests are proxied to the specified `targetOrigin`.
    * Crucially, any cookies obtained through the headless login (and potentially available in the browser context from the iframe flow) are attached to these proxied requests, allowing your local frontend to communicate with backend services as if it were authenticated.

4. **Automatic Cookie Refresh (Experimental)**:
    * If a proxied API request results in an "unauthenticated" response (detected by `unauthDetector`), the plugin can automatically attempt to re-run the headless login to refresh the cookies.

This setup allows developers to work with authenticated backend APIs locally without needing to deploy Nginx or manually manage cookies.

## Installation

```bash
npm install @utk09/vite-dev-auth-plugin
```

or

```bash
yarn add @utk09/vite-dev-auth-plugin
```

or

```bash
pnpm add @utk09/vite-dev-auth-plugin
```

## Usage

Update your `vite.config.ts` (or `vite.config.js`) file:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // Or your framework plugin
import authDevPlugin from '@utk09/vite-dev-auth-plugin';

export default defineConfig({
  plugins: [
    react(),
    authDevPlugin({
      // Required: URL that completes SSO and sets auth cookies
      validateUrl: 'https://your-sso-provider.com/auth-validate-endpoint',

      // Optional: Define which paths should be proxied
      apiPaths: [
        '/api', // Proxy all requests starting with /api
        /^\/graphql/, // Proxy GraphQL requests
        // '/another/path'
      ],

      // Optional: Configure or disable headless login
      // Set to false to disable.
      // Provide an AxiosRequestConfig object for custom headless login.
      headlessLogin: {
        method: 'GET', // or 'POST', etc.
        // headers: { 'X-Custom-Header': 'value' },
        // data: { key: 'value' } // for POST requests
      },
      // By default, headlessLogin is false (disabled). If enabled without specific
      // Axios config, it will make a GET request to validateUrl.

      // Optional: Target origin for proxied requests
      // Defaults to the origin of `validateUrl` if not specified
      // targetOrigin: 'https://your-backend-api.com',

      // Optional: Allow self-signed certificates for the target origin (dev only!)
      insecureTLS: false, // Set to true if your dev backend uses self-signed certs

      // Optional: Enable WebSocket proxying for paths matched by apiPaths
      ws: true, // Default is false

      // Optional: Customize how unauthenticated responses are detected
      // unauthDetector: (statusCode, headers) => {
      //   return statusCode === 401 || (statusCode === 302 && headers.location?.includes('/login'));
      // },

      // Optional: Add extra query parameters to the iframe's src URL
      // iframeParam: 'custom_param=value&another_param=true', // Default is 'silent=true'

      // Optional: Provide a custom logging function
      // onLog: (message) => {
      //   myCustomLogger.info(message);
      // }

      // Optional: Specify the name of the authentication cookie
      // authCookieName: 'myToken',

      // Optional: Specify the message for SSO completion
      // ssoCompleteMessage: 'myToken-set',
    })
  ]
});
```

## Configuration Options

The plugin accepts an options object with the following properties:

* `validateUrl` (string, **required**):
    The URL that your application or an SSO provider uses to validate authentication and set the necessary cookies. This URL will be used for both the headless login attempt and the iframe source.

* `targetOrigin` (string, optional):
    The remote origin (e.g., `https://api.example.com`) to which API requests should be proxied. If not provided, it's automatically inferred from the `validateUrl`.

* `apiPaths` ((RegExp | string)[], optional):
    An array of strings or regular expressions that define which request paths should be proxied.
  * String paths are matched using `startsWith()`. For example, `'/api'` will match `'/api/users'`.
  * Default: `[/^\/api/]` (proxies all paths starting with `/api`).

* `headlessLogin` (AxiosRequestConfig | false, optional):
    Controls the server-side headless login attempt.
  * Set to `false` to disable headless login.
  * Provide an `AxiosRequestConfig` object (from the `axios` library) to customize the request (e.g., method, headers, data).
  * If set to `true` or an empty object `{}`, it defaults to a GET request to `validateUrl`.
  * Default: `false`.

* `insecureTLS` (boolean, optional):
    Set to `true` to allow connections to a `targetOrigin` that uses self-signed TLS/SSL certificates. Useful for development environments.
    **Warning:** Only use this for local development.
    Default: `false`.

* `ws` (boolean, optional):
    Set to `true` to enable proxying of WebSocket upgrade requests for paths that match `apiPaths`.
    Default: `false`.

* `unauthDetector` ((status: number, headers: IncomingHttpHeaders) => boolean, optional):
    A function to detect if a response from the proxied backend signifies an unauthenticated state. This is used to trigger a cookie refresh via headless login if enabled.
  * `status`: The HTTP status code of the response.
  * `headers`: The `IncomingHttpHeaders` object of the response.
  * Default: Detects status `401` OR status `302` with a `Location` header containing `/sso/` or `/login`.

* `iframeParam` (string, optional):
    A string of query parameters to append to the `validateUrl` when it's loaded in the iframe.
    Default: `"silent=true"`.

* `onLog` ((msg: string) => void, optional):
    A custom logging function. If provided, the plugin will use this function for its log messages instead of `console.log`.
    Default: `console.log`.

* `authCookieName` (string, optional):
    The name of the authentication cookie that the iframe script will check for in `document.cookie` to determine if authentication is already present.
    Default: `"myToken"`.

* `ssoCompleteMessage` (string, optional):
    The message that the iframe is expected to `postMessage` to the parent window upon successful completion of the SSO flow. The iframe script listens for this message.
    Default: `"myToken-set"`.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

GPL-3.0-only
