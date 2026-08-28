# Security Policy

## Reporting a vulnerability

**Please don't open a public issue.**

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/YoItsRdL/cernix/security/advisories/new) and open a draft advisory. It's private between you and the maintainer until we agree to publish.

> **Maintainer note:** this needs *Settings → Code security → Private vulnerability reporting* enabled on the repository, or that link 404s for reporters.

Useful things to include, as far as you have them: what an attacker gains, the Cernix version, your OS, and the smallest reliable way to reproduce it.

## What to expect

Cernix is maintained by one person in their own time. There is no security team and no paid support, so treating a response time as a commitment would be dishonest. What you can expect is an acknowledgement as soon as it's seen, and to be kept in the loop while it's worked on. If a report goes quiet, a nudge on the advisory thread is welcome.

Fixes ship in a normal release. There's no separate security-patch channel, and no auto-updater, so a fix only reaches people who download it. Anything with real impact will be called out in the release notes rather than folded quietly into a changelog.

## Scope

The things worth looking hardest at:

- **Google OAuth tokens.** Stored via Electron `safeStorage` (DPAPI on Windows) in the app's data directory. Anything that exposes them, or that gets the app to send them somewhere it shouldn't, matters.
- **The `cernix-media://` protocol handler.** It serves local files to the renderer behind a path allowlist covering the app's own directories and currently-mounted removable volumes. A path that escapes that allowlist is a real finding.
- **IPC surface.** The renderer runs with `contextIsolation` and no Node integration; everything crosses a typed preload bridge. A channel that lets the renderer reach further than intended counts.
- **Drive scope.** The app requests `drive.file` only: access to files it created. Anything that reaches beyond that is a bug regardless of severity.

## Not vulnerabilities

- **The SmartScreen warning on download.** Releases are unsigned by choice; a certificate is a recurring cost this project doesn't carry. Every release publishes a sha256 so you can verify the binary instead.
- **The client secret inside the binary.** Google's installed-app OAuth model expects it to be embedded and does not treat it as confidential. It's paired with the narrow `drive.file` scope, and extracting it gains an attacker nothing they couldn't get by registering their own client.
- **Dependency advisories with no reachable path from app code.** Report them if you can show one: a version number on its own isn't a finding.
