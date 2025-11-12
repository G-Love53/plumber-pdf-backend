# contractor-supp-pdf-service

Updated: 2025-11-11

**One-to-one mapping** with normalized keys. POST JSON to `/pdf/contractor-supp` and the service streams back a Letter PDF.

## Files
- `src/server.js` — Express server (no CLI needed). Binds `PORT` (defaults `10000` for Render).
- `templates/contractor-supp.ejs` — multi-page EJS template.
- `styles/print.css` — print CSS inlined by the server.
- `mapping/normalized.json` — section roster + version.
- `samples/data.json` — minimal sample shape.

## Deploy
- Connect this repo to Render as a **Web Service**.
- Build command: _(none required; Render will run `npm install` automatically)_
- Start command: `npm start`

## Use
- POST JSON body (normalized keys) to `/pdf/contractor-supp`.
- Response: `application/pdf` (inline).

