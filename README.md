# exq-ui
User Interface for Exquisitor.


## Setup
To install the application
```
npm install
```

By default the UI connects to the Exquisitor service at `https://localhost:5000`. To use a service at a different address, change `exqURI` in `src/services/http.ts`.

> [!NOTE]
> Mock data is off by default. To run the UI without a live Exquisitor service, set `mock = true` in `src/services/http.ts`.

## Run

### Development
Starts a dev server with hot reload at http://localhost:3000
```
npm run dev
```

### Production build
Type-checks and builds the app into `dist/`
```
npm run build
```

Preview the build locally at http://localhost:4173
```
npm run preview
```

To deploy, serve the contents of `dist/` from any static web server (e.g. nginx, Apache, `npx serve dist`). Configure it to fall back to `index.html` for unknown paths, otherwise refreshing on an app route returns a 404.

> [!IMPORTANT]
> Opening `dist/index.html` directly from disk (`file://`) does not work. Browsers block the app's module scripts outside of HTTP, so it must be served.
