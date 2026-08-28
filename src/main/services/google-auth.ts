import { shell, safeStorage } from 'electron'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createFlowSecrets, matchesState } from './oauth-pkce'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { messageOf } from '../../shared/errors'

/** The token endpoint's reply, narrowed to what is read. Refresh
 *  responses omit `refresh_token`, which is the whole reason the stored
 *  one is kept rather than overwritten. */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
}

/** The userinfo endpoint's reply. Both fields are optional: a Google
 *  account can have no picture, and the scope may not include email. */
interface UserInfoResponse {
  email?: string
  picture?: string
}


// ── Types ──

export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expiry_date: number        // Unix timestamp (ms)
  scope: string
}

export interface AuthStatus {
  connected: boolean
  email: string | null
  avatar: string | null
  expiresAt: number | null   // Unix timestamp (ms)
}

export type AuthEvents = {
  'auth:status':  [status: AuthStatus]
  'auth:error':   [error: { message: string }]
}

// ── Google OAuth 2.0 Manager ──
// Handles the complete OAuth lifecycle for Google Drive:
//   1. Opens system browser for consent
//   2. Captures auth code via loopback HTTP server
//   3. Exchanges code for tokens
//   4. Stores tokens encrypted via safeStorage
//   5. Auto-refreshes access token before expiry
//

// `drive.file` grants per-file access to items this app creates or the
// user explicitly opens, which covers everything Cernix does. It
// works exclusively inside its own library folder. It is also a
// non-sensitive scope, so distributing the app needs neither Google
// verification nor the annual security assessment that the broader
// `auth/drive` scope requires.
//
// The tradeoff: files created by a *different* OAuth client are
// invisible, and revoking access drops the grants on everything created
// before. Both surface as a missing library folder, and
// `getRootFolderId` recreates one rather than failing.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

const TOKEN_FILE = 'auth-tokens.enc'
const LOOPBACK_PORT = 8899
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/oauth/callback`

export class GoogleAuthManager extends EventEmitter {
  private clientId: string
  private clientSecret: string
  private tokens: AuthTokens | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private callbackServer: Server | null = null

  constructor() {
    super()
    // Environment first so a developer can override without rebuilding;
    // otherwise the values Vite compiled in at build time, which is the
    // only source a packaged .exe has.
    this.clientId = process.env['GOOGLE_CLIENT_ID'] || BUILD_GOOGLE_CLIENT_ID
    this.clientSecret = process.env['GOOGLE_CLIENT_SECRET'] || BUILD_GOOGLE_CLIENT_SECRET

    if (!this.clientId || !this.clientSecret) {
      // Drive is simply unavailable in this state; `connect()` refuses
      // and emits auth:error so the UI can say why rather than looking
      // like a dead button.
      console.warn(
        '[GoogleAuth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing: Drive features are disabled. ' +
        'Copy .env.example to .env and fill both in.',
      )
    }
  }

  // ── Public API ──

  /**
   * Load any saved tokens from disk and schedule refresh if valid.
   * Call this on app startup.
   */
  async initialize(): Promise<void> {
    const saved = this.loadTokensFromDisk()
    if (saved) {
      this.tokens = saved
      console.log('[GoogleAuth] Loaded saved tokens')

      // Check if access token is still valid
      if (this.isTokenExpired()) {
        console.log('[GoogleAuth] Access token expired, refreshing...')
        await this.refreshAccessToken()
      } else {
        this.scheduleRefresh()
      }

      // Fetch user info and emit status
      await this.emitCurrentStatus()
    } else {
      this.emitDisconnectedStatus()
    }
  }

  /**
   * Start the OAuth 2.0 flow:
   * 1. Start local HTTP server to receive callback
   * 2. Open system browser with Google consent URL
   * 3. Wait for auth code
   * 4. Exchange code for tokens
   */
  async connect(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      this.emit('auth:error', { message: 'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env' })
      return
    }

    try {
      const { code, codeVerifier } = await this.waitForAuthCode()
      await this.exchangeCodeForTokens(code, codeVerifier)

      // Step 4: Fetch user info and emit connected status
      await this.emitCurrentStatus()

      console.log('[GoogleAuth] Successfully connected')
    } catch (err) {
      console.error('[GoogleAuth] Connection failed:', messageOf(err))
      this.emit('auth:error', { message: messageOf(err) })
    }
  }

  /**
   * Disconnect: revoke token and delete stored credentials.
   */
  async disconnect(): Promise<void> {
    try {
      if (this.tokens?.access_token) {
        // In the body, not the query string. Google accepts either,
        // and a URL is the half of a request that tooling logs.
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: this.tokens.access_token }),
        }).catch(() => { /* Best effort, ignore revocation errors */ })
      }
    } finally {
      this.tokens = null
      this.clearRefreshTimer()
      this.deleteTokensFromDisk()
      this.emitDisconnectedStatus()
      console.log('[GoogleAuth] Disconnected')
    }
  }

  /**
   * Get a valid access token. Refreshes automatically if expired.
   * Returns null if not connected.
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null

    if (this.isTokenExpired()) {
      await this.refreshAccessToken()
    }

    return this.tokens?.access_token ?? null
  }

  /** Check if the user is currently authenticated */
  isConnected(): boolean {
    return this.tokens !== null
  }

  /** Get current auth status */
  getStatus(): AuthStatus {
    if (!this.tokens) {
      return { connected: false, email: null, avatar: null, expiresAt: null }
    }
    return {
      connected: true,
      email: null,      // Will be populated by emitCurrentStatus
      avatar: null,
      expiresAt: this.tokens.expiry_date,
    }
  }

  // ── OAuth Flow ──

  /**
   * Start a local HTTP server and open the browser for OAuth consent.
   * Returns the auth code when the user completes the flow.
   */
  private waitForAuthCode(): Promise<{ code: string, codeVerifier: string }> {
    return new Promise((resolve, reject) => {
      const { state: expectedState, codeVerifier, codeChallenge } = createFlowSecrets()

      // Build the consent URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', this.clientId)
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', SCOPES.join(' '))
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('state', expectedState)
      // PKCE. The client secret ships inside the binary and so is not
      // secret; the verifier is what actually proves this process is the
      // one that asked for the code.
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')

      // Start a temporary local server to catch the redirect
      this.callbackServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `http://localhost:${LOOPBACK_PORT}`)

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          // Checked before the code is read at all. The port is fixed
          // and the listener answers anything that reaches it, so this
          // is the only thing tying the callback to the request this
          // process started: without it, a page the user has open can
          // deliver its own code and sign them into someone else's
          // account, and their photographs upload there.
          if (!matchesState(url.searchParams.get('state'), expectedState)) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            res.end(this.getErrorPage('state_mismatch'))
            this.shutdownCallbackServer()
            reject(new Error('OAuth callback did not carry the expected state'))
            return
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            res.end(this.getErrorPage(error))
            this.shutdownCallbackServer()
            reject(new Error(`OAuth error: ${error}`))
            return
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
            res.end(this.getSuccessPage())
            this.shutdownCallbackServer()
            resolve({ code, codeVerifier })
            return
          }

          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing authorization code')
        } else {
          res.writeHead(404)
          res.end()
        }
      })

      // Loopback only. Binding every interface would put the callback
      // on the local network for the duration of the flow.
      this.callbackServer.listen(LOOPBACK_PORT, '127.0.0.1', () => {
        console.log(`[GoogleAuth] Callback server listening on port ${LOOPBACK_PORT}`)
        // Open the consent URL in the user's default browser
        shell.openExternal(authUrl.toString())
      })

      this.callbackServer.on('error', (err) => {
        reject(new Error(`Failed to start callback server: ${err.message}`))
      })

      // Timeout after 5 minutes
      setTimeout(() => {
        this.shutdownCallbackServer()
        reject(new Error('OAuth flow timed out (5 minutes)'))
      }, 5 * 60 * 1000)
    })
  }

  /**
   * Exchange the authorization code for access + refresh tokens.
   */
  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<void> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`)
    }

    const data = await response.json() as TokenResponse

    // The consent URL asks for access_type=offline and prompt=consent, so
    // this exchange always carries a refresh token. Without one the app
    // would hold an access token for an hour and then be unable to renew
    // it, which is worse to discover later than to fail here.
    if (!data.refresh_token) throw new Error('Token exchange returned no refresh token')

    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'Bearer',
      expiry_date: Date.now() + (data.expires_in * 1000),
      scope: data.scope || SCOPES.join(' '),
    }

    this.saveTokensToDisk()
    this.scheduleRefresh()
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      console.error('[GoogleAuth] No refresh token available')
      await this.disconnect()
      return
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: this.tokens.refresh_token,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('[GoogleAuth] Token refresh failed:', errorBody)

        // If refresh token is revoked/expired, force re-auth
        if (response.status === 400 || response.status === 401) {
          await this.disconnect()
          this.emit('auth:error', { message: 'Session expired. Please reconnect your Google account.' })
        }
        return
      }

      const data = await response.json() as TokenResponse

      this.tokens.access_token = data.access_token
      this.tokens.expiry_date = Date.now() + (data.expires_in * 1000)

      // Google may issue a new refresh token
      if (data.refresh_token) {
        this.tokens.refresh_token = data.refresh_token
      }

      this.saveTokensToDisk()
      this.scheduleRefresh()

      console.log('[GoogleAuth] Access token refreshed')
    } catch (err) {
      console.error('[GoogleAuth] Refresh error:', messageOf(err))
    }
  }

  // ── Token Storage (Encrypted) ──

  private getTokenFilePath(): string {
    return path.join(app.getPath('userData'), TOKEN_FILE)
  }

  private saveTokensToDisk(): void {
    if (!this.tokens) return

    try {
      const json = JSON.stringify(this.tokens)
      const encrypted = safeStorage.encryptString(json)
      fs.writeFileSync(this.getTokenFilePath(), encrypted)
      console.log('[GoogleAuth] Tokens saved (encrypted)')
    } catch (err) {
      console.error('[GoogleAuth] Failed to save tokens:', messageOf(err))
    }
  }

  private loadTokensFromDisk(): AuthTokens | null {
    const filePath = this.getTokenFilePath()

    try {
      if (!fs.existsSync(filePath)) return null

      const encrypted = fs.readFileSync(filePath)
      const json = safeStorage.decryptString(encrypted)
      return JSON.parse(json) as AuthTokens
    } catch (err) {
      console.error('[GoogleAuth] Failed to load tokens:', messageOf(err))
      return null
    }
  }

  private deleteTokensFromDisk(): void {
    try {
      const filePath = this.getTokenFilePath()
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (err) {
      console.error('[GoogleAuth] Failed to delete token file:', messageOf(err))
    }
  }

  // ── User Info ──

  /**
   * Fetch the user's Google profile and emit auth:status
   */
  private async emitCurrentStatus(): Promise<void> {
    if (!this.tokens) {
      this.emitDisconnectedStatus()
      return
    }

    try {
      const token = await this.getAccessToken()
      if (!token) {
        this.emitDisconnectedStatus()
        return
      }

      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.ok) {
        const profile = await response.json() as UserInfoResponse
        const status: AuthStatus = {
          connected: true,
          email: profile.email || null,
          avatar: profile.picture || null,
          expiresAt: this.tokens.expiry_date,
        }
        this.emit('auth:status', status)
      } else {
        this.emit('auth:status', {
          connected: true,
          email: null,
          avatar: null,
          expiresAt: this.tokens.expiry_date,
        })
      }
    } catch {
      this.emit('auth:status', {
        connected: true,
        email: null,
        avatar: null,
        expiresAt: this.tokens?.expiry_date ?? null,
      })
    }
  }

  private emitDisconnectedStatus(): void {
    this.emit('auth:status', {
      connected: false,
      email: null,
      avatar: null,
      expiresAt: null,
    })
  }

  // ── Refresh Timer ──

  private isTokenExpired(): boolean {
    if (!this.tokens) return true
    // Consider expired 5 minutes before actual expiry
    return Date.now() >= (this.tokens.expiry_date - 5 * 60 * 1000)
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer()

    if (!this.tokens) return

    // Refresh 5 minutes before expiry
    const msUntilRefresh = (this.tokens.expiry_date - Date.now()) - (5 * 60 * 1000)
    const delay = Math.max(msUntilRefresh, 30_000) // At least 30 seconds

    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken()
    }, delay)

    console.log(`[GoogleAuth] Token refresh scheduled in ${Math.round(delay / 1000)}s`)
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  // ── Callback Server ──

  private shutdownCallbackServer(): void {
    if (this.callbackServer) {
      // `close()` alone stops the listener accepting new connections but
      // leaves established ones attached to this handler, and the port
      // free for the next flow to bind. A browser that kept the callback
      // connection alive then has its next request answered by the dead
      // flow's closure, which verifies against a state that is no longer
      // the one on the consent URL. A cancelled sign-in makes the retry
      // fail. Measured: with connection reuse, three consecutive flows
      // were all served by the first one's handler.
      this.callbackServer.closeAllConnections()
      this.callbackServer.close()
      this.callbackServer = null
    }
  }

  // ── HTML Pages for OAuth Redirect ──
  //
  // The only Cernix surface a person sees in their browser rather than in
  // the app, and it arrives at the moment they hand over access to their
  // Drive, so it should look like the thing they just trusted. It used to
  // be stock slate and generic green, which read as a different product.
  //
  // Served over http from the main process, so tokens.css is not
  // reachable and every value is baked in. These are the real token
  // colours, read out of the built stylesheet rather than eyeballed. They
  // are also why scripts/design-audit.mjs does not scan src/main: literal
  // hex is correct here and nowhere else.
  //
  // Theme follows the visitor's OS, since a browser tab has no idea which
  // theme the app is running.

  /** Shared chrome, so the two pages cannot drift apart. */
  private authPageShell(accent: string, accentDark: string, glyph: string, title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Cernix</title>
  <style>
    :root {
      --bg: #f3e5d6; --card: #f9f0e7; --ink: #2e1e0a;
      --muted: #64523d; --line: #cfbaa3; --accent: ${accent};
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121113; --card: #121212; --ink: #c1c1c1;
        --muted: #888888; --line: #222222; --accent: ${accentDark};
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 1.5rem;
      background: var(--bg); color: var(--ink);
    }
    .card {
      width: 100%; max-width: 26rem; padding: 2.5rem 2rem;
      background: var(--card); border: 1px solid var(--line);
      border-radius: 8px; text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,.05), 0 4px 6px -1px rgba(0,0,0,.05);
    }
    .mark { color: var(--accent); margin-bottom: 1.25rem; }
    h1 {
      margin: 0 0 .5rem; font-size: 1.375rem; font-weight: 600;
      letter-spacing: -.01em; color: var(--ink);
    }
    p { margin: 0; font-size: .875rem; line-height: 1.6; color: var(--muted); }
    .hint { margin-top: 1.5rem; font-size: .75rem; color: var(--muted); opacity: .75; }
  </style>
</head>
<body>
  <main class="card">
    <div class="mark">${glyph}</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <p class="hint">You can close this tab.</p>
  </main>
</body>
</html>`
  }

  private getSuccessPage(): string {
    // The desktop icon itself (tile, gradient and all) not a tinted
    // glyph. This is the moment to show the thing that is now sitting in
    // their taskbar, so it uses build-resources/icon.svg's own 256 grid
    // and its own two colours rather than borrowing the page's accent.
    // If the icon changes, change this with it.
    // The third copy of the mark, and unavoidably so: this HTML is
    // served by the main process to a browser during the OAuth
    // redirect, so it can import neither CernixMark nor the build
    // resource. It is kept byte-identical in geometry to
    // build-resources/icon.svg. If one changes, change both.
    const mark = `<svg width="56" height="56" viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ed8757"/><stop offset="1" stop-color="#ce6b3b"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#tile)"/>
      <g stroke="#f9f0e7" fill="#f9f0e7" stroke-linecap="butt">
        <g stroke-width="12" fill="none">
          <path d="M145.56 97.6 L189.18 173.14"/><path d="M110.44 97.6 L197.69 97.6"/>
          <path d="M92.89 128 L136.51 52.46"/><path d="M110.44 158.4 L66.82 82.86"/>
          <path d="M145.56 158.4 L58.31 158.4"/><path d="M163.11 128 L119.49 203.54"/>
        </g>
        <path d="M192.45 87.73 A76 76 0 1 1 160.12 59.12" fill="none" stroke-width="20" stroke-linecap="round"/>
        <path d="M178.25 67.57 L152.51 75.43 L167.73 42.81 Z"
              stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
      </g>
    </svg>`
    return this.authPageShell(
      // Accent unused by the success mark, which carries its own colour;
      // kept for the heading rule the shell applies.
      '#de7949', '#e78a53', mark, 'Connected',
      'Cernix is linked to your Google Drive. Head back to the app to keep going.',
    )
  }

  private getErrorPage(error: string): string {
    const mark = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>
    </svg>`
    // The raw error goes in a paragraph, so it must not be able to close
    // a tag. It arrives from a query string.
    const safe = String(error).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c] as string))
    return this.authPageShell(
      '#ad524d', '#f66d67', mark, 'Could not connect',
      `${safe}: try connecting again from Cernix.`,
    )
  }
}
