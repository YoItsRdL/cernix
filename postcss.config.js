export default {
  plugins: {
    // v4 ships its own pipeline: postcss-import and autoprefixer are
    // absorbed, so both were removed rather than left as no-ops.
    '@tailwindcss/postcss': {},
  },
}
