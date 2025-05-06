# @utk09/vite-dev-auth-plugin

A Vite plugin designed to simplify handling Single Sign-On (SSO) and authentication during local development.

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

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

GPL-3.0-only
