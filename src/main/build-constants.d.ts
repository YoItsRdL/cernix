/**
 * Values Vite substitutes at build time (see `vite.config.ts`).
 *
 * A packaged app has no `.env` beside it, so these are the only source
 * of Google OAuth credentials in a release build. Empty strings when the
 * build had none, which disables Drive rather than failing the build.
 */
declare const BUILD_GOOGLE_CLIENT_ID: string
declare const BUILD_GOOGLE_CLIENT_SECRET: string
