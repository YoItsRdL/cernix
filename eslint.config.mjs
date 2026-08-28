import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import unusedImports from 'eslint-plugin-unused-imports'

/**
 * Design-system divergence rules, shared between the strict (error) and
 * informational (warn) zones. The two-tier scope mirrors the phase-6
 * migration plan: surfaces that have been cleaned up stay clean (error);
 * the rest of the renderer gets the same checks at warn severity so the
 * remaining debt is visible in review without blocking CI until the
 * migration catches up.
 */
const DESIGN_TOKEN_RULES = [
  {
    selector: 'Literal[value=/[a-z]+-\\[(#[0-9a-fA-F]+|[0-9]+(px|rem|em|%))\\]/]',
    message: 'Arbitrary design tokens (hex/px) are forbidden. Use semantic tokens from src/shared/tokens.css (e.g. `bg-surface-panel`, `text-body`, `space-3`).'
  },
  {
    selector: 'Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
    message: 'Raw hex colours are forbidden. Use a token from src/shared/tokens.css. If the hex is genuinely semantic (e.g. a colour-range swatch where the hex IS the value being edited), annotate the line with `// design-allow: <reason>`.'
  },
  {
    // Tailwind palette colour utilities (bg-red-500, text-amber-400,
    // border-blue-300, etc.) bypass the role system. Every semantic
    // use has a role token; if none fits, extend the system, don't
    // fork the palette.
    selector: 'Literal[value=/\\b(bg|text|border|ring|from|to|via|shadow|outline|fill|stroke|placeholder|divide|accent|decoration|caret)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]+/]',
    message: 'Tailwind palette colours (e.g. bg-red-500) bypass the role system. Use a role token instead: status-danger/warn/success/info, accent-primary, text-emphatic/default/muted, surface-*, etc. They are defined in src/shared/tokens.css.'
  },
  {
    // Raw `bg-white/N`, `text-black/N`, `border-white/N` etc.: these
    // are greyscale alpha overlays that every primitive should draw
    // from the `overlay-*` role tokens (hover / active / selected)
    // or a surface/border token.
    selector: 'Literal[value=/\\b(bg|text|border|ring|from|to|via|shadow|outline|fill|stroke|divide)-(white|black)(\\/[0-9]+)?\\b/]',
    message: 'Raw `white/black` colour utilities are forbidden. Use an overlay-* role for interaction washes (hover / active / selected), or a surface/border/text token for structural colour.'
  },
  {
    // Named Tailwind text-sizes (text-xs/sm/base/lg/xl/2xl/3xl/...)
    // bypass the typographic role scale. Every text element should
    // pick from: micro, metadata, caption, code, body, heading, label,
    // subtitle, title, display.
    selector: 'Literal[value=/\\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\\b/]',
    message: 'Named Tailwind text-sizes (text-sm, text-xl, ...) bypass the role scale. Use a role token: text-body, text-heading, text-label, text-subtitle, text-title, text-display (or micro/metadata/caption/code), all defined in src/shared/tokens.css.'
  },
]

/**
 * Hand-rolled-control rules: native `<button>` / `<input>` / `<dialog>` /
 * `<select>` outside the primitive layer means a shadcn component is
 * being bypassed. Same two-tier severity strategy.
 */
const HAND_ROLLED_CONTROL_RULES = [
  {
    selector: 'JSXOpeningElement[name.name="button"]',
    message: '<button> is forbidden outside components/ui/. Import `Button` (or `IconButton`) from @/components/ui/button.'
  },
  {
    selector: 'JSXOpeningElement[name.name="input"]',
    message: '<input> is forbidden outside components/ui/. Import the shadcn `Input` or `Checkbox` from @/components/ui/*.'
  },
  {
    selector: 'JSXOpeningElement[name.name="dialog"]',
    message: '<dialog> is forbidden outside components/ui/. Import `Dialog` from @/components/ui/dialog.'
  },
  {
    selector: 'JSXOpeningElement[name.name="select"]',
    message: '<select> is forbidden outside components/ui/. Use shadcn `DropdownMenu` from @/components/ui/dropdown-menu.'
  },
]

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'node_modules'] },

  // Base config: applies to every linted file.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The classic rules stay strict: they catch the actual can't-
      // render-this bugs.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler's stricter ruleset (`refs`, `set-state-in-effect`,
      // `purity`, etc.) came along with the plugin upgrade that shipped
      // alongside phase-6. They surface real issues in legacy canvas /
      // effect code but fixing them requires careful per-call-site work
      // that is a separate correctness track from the design system.
      // Hold these as `warn` for visibility; promote to `error` once a
      // correctness pass has closed the backlog.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/memoized-effect-dependencies': 'warn',
      'react-hooks/exhaustive-effect-dependencies': 'warn',
      'react-hooks/no-deriving-state-in-effects': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/void-use-memo': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/capitalized-calls': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/hooks': 'warn',
      'react-hooks/memo-dependencies': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      // `any` is warn, not error, across the codebase. Broad typing of
      // IPC boundaries and third-party response shapes is a separate
      // hygiene track; blocking CI on it while the design-system phase
      // lands would conflate two goals. Revisit once IPC types are
      // fully modelled.
      '@typescript-eslint/no-explicit-any': 'warn',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'semi': ['error', 'never'],
      'quotes': ['error', 'single'],
    },
  },

  // Renderer (outside the primitive layer): design-system rules are
  // `warn` during the phase-6 rollout. The rollout is staged per the
  // phase spec ("warn first week, error after"): rules are authored and
  // visible now, so the remaining migration debt surfaces in every
  // review; promotion to `error` lands once the per-surface migration is
  // complete and the remaining debt is zero.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/components/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        ...DESIGN_TOKEN_RULES,
        ...HAND_ROLLED_CONTROL_RULES,
      ],
    },
  },

  // The Electron harnesses are instrumentation, not application code.
  // Each is an entry script that mounts a root, exports nothing, and
  // hangs probe functions off `window` for the runner to call, so
  // `only-export-components` is asking them to be component modules, and
  // `immutability` is objecting to the assignments that are their whole
  // purpose. Neither question applies to a test harness.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/immutability': 'off',
    },
  },
)
