# Pump Log

Pure frontend PDA pump log viewer built with React, TypeScript, and Vite.

## Features

- Paste an upload notification and parse `fileName`, `urlPath`, SN, version, and default password.
- Download the zip directly in the browser when CORS allows it.
- Import a local password-protected zip file when remote download is blocked or unavailable.
- Derive the default password as `PDA_${SN}`, for example `PDA_D00001`.
- Show extracted files in a left-side list with date, size, and type.
- Show selected file content with line numbers and content search.
- Preview large text files by decoding the first 2 MB and marking the preview as truncated.

## Requirements

Use Node.js `>=20.19.0`. This repository includes `.nvmrc` with `22.17.1`.

```bash
nvm use
npm install
npm run dev
```

The dev server defaults to Vite's local URL, usually `http://127.0.0.1:5173/` or the next available port.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Browser-Only Limitation

This app has no backend. Remote `urlPath` downloads use browser `fetch`, so the CloudFront response must allow CORS for the current page origin. If the browser blocks the request, download the zip manually and import it with the local zip button.
