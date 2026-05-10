# Document Converter

A Vite + React document conversion UI backed by an Express server. The app converts public URLs, uploaded HTML files, Word documents, and PDFs into PDF documents or PNG image ZIP archives.

## Repo Structure

```text
.
├── src/
│   ├── App.tsx                 # Main converter UI and client-side validation
│   ├── main.tsx                # React entry point
│   ├── index.css               # Tailwind and font setup
│   └── lib/
│       └── utils.ts            # Shared className helper
├── server.ts                   # Express server, Vite middleware, and /api/convert route
├── cypress/
│   ├── e2e/
│   │   └── converter.feature   # Cypress BDD Cucumber scenarios
│   └── support/
│       └── step_definitions/
│           └── converter.ts    # Step definitions and API stubs for feature tests
├── app/
│   └── applet/
│       └── test-arch.ts        # Local archiver import probe
├── cypress.config.ts           # Cypress + Cucumber preprocessor config
├── .cypress-cucumber-preprocessorrc.json
├── vite.config.ts              # Vite and React plugin config
├── tsconfig.json               # TypeScript project config
├── package.json
└── package-lock.json
```

## Prerequisites

- Node.js 20 or newer
- npm

## Install

```bash
npm install
```

The current converter flow does not require environment variables for local UI and API testing. `.env.example` is retained from the app template for deployments that still inject template secrets.

## Run Locally

```bash
npm run dev
```

The server listens on `http://localhost:3000`. In development, Express serves the API route and mounts Vite middleware for the React app.

## Scripts

- `npm run dev` starts the Express + Vite development server.
- `npm run lint` runs TypeScript checks with `tsc --noEmit`.
- `npm run build` builds the Vite client and bundles `server.ts` to `dist/server.cjs`.
- `npm start` runs the bundled production server after a build.
- `npm test` runs Cypress against `http://localhost:3000`.

## BDD Test Suite

The Cypress Cucumber suite lives in `cypress/e2e/converter.feature`, with reusable steps in `cypress/support/step_definitions/converter.ts`.

To run it locally:

```bash
npm run dev
npm test
```

Run the two commands in separate terminals so Cypress can reach the app at `http://localhost:3000`.
