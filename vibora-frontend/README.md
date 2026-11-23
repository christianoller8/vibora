# Víbora frontend

Angular 22 single-page app (Angular Material) for Víbora. For the full project, see the root [README](../README.md) (English) or [README.es](../README.es.md) (Spanish).

## Commands

Run everything from this folder.

```bash
npm ci                      # install dependencies
npm start                   # dev server; /api and /ws are proxied to the backend on 8081 (proxy.conf.json)
npx ng test --watch=false   # unit tests (Vitest)
npx ng build                # production build
```

Guard scripts (Node test runner):

```bash
npm run test:paleta
npm run test:colores
npm run test:tema
npm run test:marca
npm run test:csp
```

Theme tokens are documented in [../DESIGN.md](../DESIGN.md).
