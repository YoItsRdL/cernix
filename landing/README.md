# Cernix: Landing Page

The public site for Cernix: four static pages (home, installation, privacy, terms), Tailwind, deployed to Vercel (see `vercel.json` at the repo root). It is built standalone of the Electron renderer and **shares all design tokens** with the app via `src/shared/tokens.css`. The typefaces are the app's own, bundled from `src/shared/fonts/`; the site asks no third party for anything.

## Layout

```
landing/
├── src/
│   ├── pages/        one template per page; front matter in a JSON comment
│   ├── partials/     header, footer, head assets, theme scripts
│   └── style.css     Tailwind entry; imports ../../src/shared/tokens.css
├── index.html  installation.html  privacy.html  terms.html
│                     built from the templates, committed (Vercel runs no build)
├── og.html  og.png   the social card, and the image made from it
├── binary.json       what the download buttons point at
├── dist/             the stylesheet and fonts (build output, gitignored)
└── README.md
```

Edit `src/pages` and `src/partials`, never the built `*.html` beside them.

## Build

From the repo root:

```bash
npm run landing:build    # builds dist/style.css and assembles the four pages
npm run landing:dev      # watch mode for the stylesheet only
```

`landing:dev` does not watch the page templates: run `npm run landing:html` after editing one. The build uses the root `tailwindcss` dependency; nothing is installed inside `landing/`.

## Serve locally

```bash
npm run landing:serve [-- --port 4173]
```

This serves `landing/` the way Vercel does (`cleanUrls`, the same cache headers), so `/installation`, `/privacy` and `/terms` resolve and the download buttons can `fetch('binary.json')`. Opening the files over `file://` does not work for the second reason.

## Design-token parity (the load-bearing guarantee)

Both this site and the Electron renderer `@import "src/shared/tokens.css"` from their stylesheets. Changing a colour, type size or radius in `tokens.css` updates both surfaces on next rebuild. **Do not redefine tokens here.** If you need one that doesn't exist, add it to `tokens.css` with a comment saying what role it plays.

`npm run check:design` scans `landing/src/**` with the same rules as `src/renderer/**`: no raw hex, no arbitrary spacing or text-size utilities, no hand-rolled palette references. Use the same `// design-allow: <reason>` escape hatch when a literal value is genuinely semantic. The one on the site is the `<meta name="theme-color">` literal in the head, which has to be a hex value because browsers do not resolve CSS variables in meta attributes.

## Download buttons

The `.cta-download` buttons read `binary.json` when the page loads and point at the right build for the visitor's system: Windows, Linux, and macOS for Apple Silicon and Intel. The sha256 of each shows under the button for anyone who would rather verify than trust. A platform with no entry in `binary.json` is not offered a download that would 404; the page says the build does not exist.

## Cutting a release

1. **Build** every platform's artifacts: `.github/workflows/release.yml` does it for a release, or locally `npm run release` (Windows installer), `npm run release:linux` (AppImage) and `npm run release:mac` (dmg and zip, arm64 and x64). Version bumps: `npm run release:patch`, `:minor`, `:major`.

2. **Upload** the artifacts to a GitHub Release with a tag like `v1.3.0`.

3. **Update `binary.json`** from what is in `release/`:
   ```bash
   node scripts/landing-update-binary.mjs --release-tag v1.3.0
   ```
   It takes the version from `package.json`, sha256s each artifact that is really there and writes one entry per platform; a platform with no artifact gets no entry. Inspect with `git diff landing/binary.json`.

4. **Commit** `landing/binary.json`, then run **`npm run landing:deploy`**. There is no git integration on the Vercel project, so a push does not publish: that command builds the pages and deploys them. `binary.json` is served `must-revalidate`, so the new target is live as soon as the deploy is.

## SmartScreen

The first release will trigger a Windows SmartScreen warning ("Windows protected your PC"). Shipping unsigned is a settled decision (CNX-1752): a certificate is a recurring cost this project does not carry.

The page states this under the download CTA and says how to proceed. That is a deliberate change from the original stance of saying nothing: treating the user as an adult means telling them what is about to happen, not letting an unexplained security dialog be their first impression. It explains; it does not apologise, and it does not hide the download behind a warning. The sha256 is offered as the alternative for anyone who would rather verify than trust.

If you want to test the SmartScreen path locally, run the produced `.exe` from a fresh download in a non-elevated shell; the SmartScreen dialog will appear before launch.

## Files in the release flow

```
package.json                          # release scripts, build.nsis.artifactName
.github/workflows/release.yml         # builds and attaches every platform's artifacts
release/                              # what the builds produce (gitignored)
scripts/landing-update-binary.mjs     # writes binary.json from release/
landing/binary.json                   # read by the download buttons
scripts/landing-deploy.mjs            # builds and publishes the site
```

## What's intentionally NOT here

- No JS framework. The pages are static, with a few small scripts (the theme, the download buttons, scroll reveals).
- No analytics, no third-party fonts or CDN, no tracking. The network panel on a fresh load shows requests only against the site's own origin.
- No CMS. Copy edits are HTML edits.

Every value in a mockup is read off the component it depicts, and the comment above it names the file it came from. A mockup that differs from its source is a defect in the mockup, not a design decision.

## OG image regeneration (CNX-908)

`landing/og.png` is the social-share image referenced by `<meta property="og:image">` on every page (1200×630, used by Twitter / LinkedIn / iMessage / Slack rich previews). It's *generated* from `landing/og.html`, which uses the same Tailwind tokens as the rest of the site: when the brand evolves, you regenerate.

Steps:

1. Run `npm run landing:build` to make sure `dist/style.css` is current. The text on the card (platforms, licence) is in `og.html`; keep it in step with the home page.
2. Open `landing/og.html` in Chrome.
3. DevTools → toggle device toolbar → add a custom device at **1200 × 630** → select it.
4. DevTools three-dot menu → **Capture full size screenshot**.
5. Save the PNG as `landing/og.png`.
6. Verify with the [Twitter Card Validator](https://cards-dev.twitter.com/validator) and [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) once the production domain (CNX-902) is live.

If the file isn't checked in yet, the meta tag points at the future location: social previews will fall back to title + description until the PNG is uploaded.
