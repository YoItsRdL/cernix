# Cernix: Landing Page

The public landing page for Cernix. Static HTML + Tailwind, deployed to Vercel (see `vercel.json` at the repo root). Built standalone of the Electron renderer; **shares all design tokens** with the app via `src/shared/tokens.css`.

## Layout

```
landing/
├── tailwind.config.js    re-exports root tailwind.config.js with landing-only content paths
├── src/
│   └── style.css         Tailwind entry; imports ../../src/shared/tokens.css
├── index.html            the page itself
├── dist/                 build output (gitignored)
└── README.md
```

## Build

From the repo root:

```bash
npm run landing:build    # one-shot build → landing/dist/style.css
npm run landing:dev      # watch mode for local iteration
```

The build uses the root `tailwindcss` dependency: no separate install needed inside `landing/`.

## Serve locally

After `landing:build`:

```bash
npx serve landing
# or
python -m http.server -d landing 5173
```

Open the served URL in a browser. No bundler, no JS framework, no dev-server complexity: the page is real HTML.

## Design-token parity (the load-bearing guarantee)

Both this page and the Electron renderer `@import "src/shared/tokens.css"` from their respective stylesheets. Changing a colour, type size, or radius in `tokens.css` updates both surfaces on next rebuild. **Do not redefine tokens here.** If you need a token that doesn't exist, add it to `tokens.css` with a comment saying what role it plays.

`npm run check:design` scans `landing/src/**` with the same rules as `src/renderer/**`: no raw hex, no arbitrary spacing/text-size utilities, no hand-rolled palette references. Use the same `// design-allow: <reason>` escape hatch when a literal value is genuinely semantic.

## Palette: Cernix tokens only

The page took an earlier detour through v0/Linear's lime + cream + white-pill brand palette, but every v0 brand literal has since been swapped back to Cernix role tokens. The blue `accent-primary` carries the v0 lime's job (highlight kicker, sidebar dot, photo-selection rings, Edit "After" ring, file-comparison XMP bar, Ingest stat card, hero testimonial card, all CTAs). The cream / purple-tinted testimonial cards collapsed to `surface-raised`: visual differentiation now comes from the one `bg-accent-primary` hero card against the four dark cards.

The only remaining `design-allow` on the page is the `<meta name="theme-color">` literal in `<head>`, which has to be a hex value: browsers don't resolve CSS variables in meta attributes. It mirrors `--surface-workspace` (`#171717`).

`npm run check:design` reports zero divergent usages across `landing/**`.

## CTA buttons

Three CTAs appear on the page; all use `accent-primary` (the Cernix brand blue) with `primary-foreground` text in a pill shape:

- **Header "Sign up"**: `h-8 px-4 rounded-pill bg-accent-primary text-primary-foreground text-landing-nav font-medium`
- **Final-CTA primary "Download free"**: `h-12 px-8 rounded-pill bg-accent-primary text-primary-foreground text-landing-body font-medium`
- **Final-CTA secondary "Contact sales"**: `h-12 px-8 rounded-pill border border-border-strong text-text-emphatic text-landing-body font-medium`

The `.cta-download` class wires the primary buttons up to the `binary.json` download URL at runtime.

## Cutting a release

`landing/binary.json` holds the current download URL, version, and sha256 of the released `.exe`. The page's inline JS fetches it on load and points the CTA at it; the sha256 surfaces under the button as a small `text-metadata` line for users who care about verifying.

Full release runbook:

1. **Bump the version** (skip if rebuilding the same version locally):
   ```bash
   npm run release:patch    # 1.0.0 → 1.0.1
   npm run release:minor    # 1.0.0 → 1.1.0
   npm run release:major    # 1.0.0 → 2.0.0
   ```
   These also produce the `.exe` in one shot. For a no-bump rebuild use plain `npm run release`.

2. **Output lands at** `release/Cernix-Setup-<version>.exe`. The path is forced via `build.nsis.artifactName` in `package.json` so the filename is stable; `landing-update-binary.mjs` and the GitHub Release upload both depend on it.

3. **Upload the `.exe` to a GitHub Release** with a tag like `v1.0.0`. Pick whatever release title and notes you like: the script only consumes the tag.

4. **Update `binary.json`**:
   ```bash
   node scripts/landing-update-binary.mjs --release-tag v1.0.0
   ```
   This reads the version from `package.json`, sha256s `release/Cernix-Setup-<version>.exe`, and rewrites `landing/binary.json`. Inspect with `git diff landing/binary.json` before committing.

5. **Commit** `landing/binary.json`, then **`npm run landing:deploy`**. There is no git integration on the Vercel project, so a push does not publish: that command builds the page and deploys it. The CTAs read `binary.json` at load and it is served `must-revalidate`, so the new target is live as soon as the deploy is.

## SmartScreen

The first release will trigger a Windows SmartScreen warning ("Windows protected your PC"). Shipping unsigned is a settled decision (CNX-1752): a certificate is a recurring cost this project does not carry.

The page states this under the download CTA and says how to proceed. That is a deliberate change from the original stance of saying nothing: treating the user as an adult means telling them what is about to happen, not letting an unexplained security dialog be their first impression. It explains; it does not apologise, and it does not hide the download behind a warning. The sha256 is offered as the alternative for anyone who would rather verify than trust.

If you want to test the SmartScreen path locally, run the produced `.exe` from a fresh download in a non-elevated shell; the SmartScreen dialog will appear before launch.

## Files in the release flow

```
package.json                                  # release scripts, build.nsis.artifactName
release/Cernix-Setup-<version>.exe          # produced by `npm run release` (gitignored)
scripts/landing-update-binary.mjs             # writes binary.json from the produced exe
landing/binary.json                           # consumed at runtime by the page CTA
```

## What's intentionally NOT here

- No JS framework. The page is server-static + a tiny script for scroll reveals (CNX-722).
- No analytics, no third-party fonts/CDN, no tracking. Network panel on a fresh load shows requests only against the page's own origin.
- No CMS. Copy edits are HTML edits.

Every value in a mockup is read off the component it depicts, and the comment above it names the file it came from. A mockup that differs from its source is a defect in the mockup, not a design decision.

## OG image regeneration (CNX-908)

`landing/og.png` is the social-share image referenced by `<meta property="og:image">` on every page (1200×630, used by Twitter / LinkedIn / iMessage / Slack rich previews). It's *generated* from `landing/og.html`, which uses the same Tailwind tokens as the rest of the site: when the brand evolves, you regenerate.

Steps:

1. Run `npm run landing:build` to make sure `dist/style.css` is current.
2. Open `landing/og.html` in Chrome.
3. DevTools → toggle device toolbar → add a custom device at **1200 × 630** → select it.
4. DevTools three-dot menu → **Capture full size screenshot**.
5. Save the PNG as `landing/og.png`.
6. Verify with the [Twitter Card Validator](https://cards-dev.twitter.com/validator) and [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) once the production domain (CNX-902) is live.

If the file isn't checked in yet, the meta tag points at the future location: social previews will fall back to title + description until the PNG is uploaded.
