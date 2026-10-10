# Vendored DuckDB-Wasm 1.32.0 — used only by /explore.html

Vendored on 2026-10-09 so the Data Explorer has no runtime CDN dependency.
Do not hand-edit these files. Licenses: `LICENSE` (DuckDB-Wasm, MIT, from the
duckdb/duckdb-wasm v1.32.0 tag) and `LICENSE-apache-arrow.txt` (Apache-2.0, bundled
into `duckdb-browser.mjs`).

| file | bytes | sha256 | what |
|---|---|---|---|
| `duckdb-eh.wasm` | 34,242,586 | `4c221bfa59c11f24dbd750e70c90b9252eca6eec5633936e6a2ec766e55fd879` | npm `@duckdb/duckdb-wasm@1.32.0` `dist/duckdb-eh.wasm`, verbatim |
| `duckdb-browser-eh.worker.js` | 772,759 | `f8ab72b6b90b3ad83077d47426d4a99d5d9a4c7e07cba1a2be37d655adc7c1ab` | same package, `dist/duckdb-browser-eh.worker.js`, verbatim |
| `duckdb-browser.mjs` | 241,089 | `8c6d598ab25ae6530bc256835f977082cbbe4e82d6ea16bece89a27f01bb8407` | `dist/duckdb-browser.mjs` + `apache-arrow@17.0.0` bundled into one ES module (esbuild 0.24.0); Arrow is re-exported as `arrow` |

Only the **eh** (WebAssembly exception-handling) bundle is shipped. Every current
browser supports it; a browser that does not (e.g. Safari before 15.2) gets the page's
plain fallback (file links, previews, static chart) rather than a second 39 MB mvp
bundle. The coi/pthread bundles are not used.

No DuckDB extension is used. explore.js builds typed Arrow tables itself and calls
`insertArrowTable`, because `read_json` would autoload the json extension from
extensions.duckdb.org at runtime.

The service worker does not touch these files: `.wasm` and `.mjs` are outside its
public-request patterns and `/assets/**/*.js` is too, so they are neither precached nor
runtime-cached by `sw.js` — only the browser's HTTP cache holds them.

Rebuild:

    npm i @duckdb/duckdb-wasm@1.32.0 esbuild@0.24.0
    printf "export * from './node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser.mjs';\nexport * as arrow from 'apache-arrow';\n" > entry.mjs
    npx esbuild entry.mjs --bundle --format=esm --minify --platform=browser --legal-comments=none --outfile=duckdb-browser.mjs
    cp node_modules/@duckdb/duckdb-wasm/dist/{duckdb-eh.wasm,duckdb-browser-eh.worker.js} .
