/// <reference types="vite/client" />

// Build-mode flag injected by vite `define` (both modes — see vite.config.ts).
declare const __HERMES_WEB__: boolean

// This build's web stamp id (public/build-stamp.json `buildId`, written by
// scripts/write-build-stamp.mjs before vite runs); empty when the stamp file
// was absent, which disables the web update check.
declare const __HERMES_BUILD_STAMP__: string
