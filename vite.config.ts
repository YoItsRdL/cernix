import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Google OAuth credentials are compiled into the main bundle rather
  // than read from the filesystem at runtime. A packaged .exe has no
  // `.env` beside it: electron-builder's `files` array ships only
  // dist-electron, dist and package.json, so a runtime lookup leaves
  // every installed copy unable to reach Drive.
  //
  // Read from `.env` locally and from the environment in CI, so the
  // values reach a release build without ever being committed. Google's
  // installed-app model expects the client secret to be embedded in the
  // distributed binary and does not treat it as confidential; the
  // narrowed `drive.file` scope (CNX-1730) is what keeps that safe.
  const env = loadEnv(mode, __dirname, '')
  const clientId = process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || ''

  if (!clientId || !clientSecret) {
    // Not fatal: a contributor without credentials still gets a working
    // build, just without Drive. Loud enough that a release build with
    // missing secrets doesn't ship silently.
    console.warn(
      '[build] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not found: ' +
      'this build will have Google Drive disabled.',
    )
  }

  const mainDefine = {
    BUILD_GOOGLE_CLIENT_ID: JSON.stringify(clientId),
    BUILD_GOOGLE_CLIENT_SECRET: JSON.stringify(clientSecret),
  }

  // Vitest loads this config too, and the electron plugin's renderer
  // half aliases Node builtins to CJS shims that a Vitest ESM import
  // cannot load: `node:crypto` fails with "require is not defined".
  // None of it serves a unit test: the suite covers pure logic and
  // anything needing a real browser lives in tests/ui/ under Electron.
  const underVitest = !!process.env['VITEST']

  return {
    plugins: [
      react(),
      ...(underVitest ? [] : [electron({
        main: {
          entry: 'src/main/index.ts',
          vite: {
            define: mainDefine,
            build: {
              rollupOptions: {
                external: ['better-sqlite3'],
              },
            },
          },
        },
        preload: {
          input: path.join(__dirname, 'src/main/preload.ts'),
        },
        renderer: {},
      })]),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/renderer'),
      },
    },
    build: {
      // Frame overlays must be emitted as files, never inlined.
      //
      // Vite inlines an asset under 4096 bytes as a data: URI, and
      // `loadFrameBitmap` reads a frame with `fetch()`. The packaged CSP
      // lists `data:` in img-src but not in connect-src, and fetch is
      // governed by connect-src — measured under the real policy: the
      // `<img>` loads and the fetch throws "Failed to fetch". A frame
      // would therefore show correctly in the picker and then fail to
      // render onto the export, which is the worst version of this: the
      // control looks like it worked.
      //
      // It went unnoticed because the first four frames are all over
      // 4096 bytes. Size is not a property anyone checks when adding a
      // picture, so pinning the behaviour is better than a note.
      assetsInlineLimit: (filePath: string) =>
        filePath.includes('/assets/frames/') ? false : undefined,
    },
    // Vitest evaluates main-process modules directly, with none of the
    // electron plugin's config, so anything reading a build-time
    // constant throws ReferenceError on import. That is why the auth
    // path had no tests: it could not be loaded, not that nobody tried.
    //
    // Empty strings rather than `mainDefine`. A test must not depend on
    // a real credential, and this keeps `.env` out of the test process
    // entirely. It is gated on Vitest because a top-level `define` also
    // reaches the renderer bundle, and putting the client secret there
    // is the thing the split between these two configs exists to stop.
    ...(underVitest
      ? { define: { BUILD_GOOGLE_CLIENT_ID: JSON.stringify(''), BUILD_GOOGLE_CLIENT_SECRET: JSON.stringify('') } }
      : {}),
  }
})
