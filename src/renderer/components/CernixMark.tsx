interface CernixMarkProps {
  /** Rendered size in px. Square. */
  size?: number
  className?: string
}

/**
 * The Cernix mark: the app icon's aperture, without its tile.
 *
 * One component rather than a light and a dark asset. Everything is
 * drawn in `currentColor`, so the mark takes the colour of whatever it
 * sits in, which covers more than two themes ever could. In the rail
 * it needs to be one colour on the light sidebar, another on the dark
 * one, and the pill's foreground when the item is active and sitting on
 * terracotta. A pair of static files cannot do the third, and it is the
 * case most likely to look broken.
 *
 * ── Why this is a 24 grid and build-resources/icon.svg is a 256 one ──
 *
 * This used to reuse the icon's geometry verbatim, on the reasoning that
 * one drawing keeps the window and the taskbar honest. It looked soft
 * and undersized next to the lucide glyphs below it, for two reasons
 * that compounded:
 *
 *   - The icon's aperture is inset, because it sits inside a rounded
 *     tile that supplies its own padding. Its radius is 76 of 256, or
 *     0.30 of the box, where a lucide glyph fills 0.42. Rendered at the
 *     same size the mark drew roughly a third less ink than its
 *     neighbours, so it read as smaller and lighter than a peer icon.
 *   - Scaling 256 down to 24 divides every stroke by 10.67. The blades
 *     landed on 1.125px and the rim on 1.875px, so nothing sat on the
 *     pixel grid and every edge was antialiased across two rows.
 *
 * The geometry here is not a redraw. The 256 icon is lucide's
 * `aperture` mapped by p256 = (p24 - 12) * 7.6 + 128; inverting that
 * recovers lucide's own coordinates exactly, which is what these are.
 * Same shape, same gap, same arrowhead. Drawn on the grid it was
 * designed on, at the weights its neighbours use.
 *
 * So the two files are the same design at two optical sizes, which is
 * how icons are normally built: a 512px tile and a 16px glyph want
 * different stroke weights. Changing the silhouette still means changing
 * both.
 */
export function CernixMark({ size = 16, className }: CernixMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={className}
      role="img"
      aria-label="Cernix"
    >
      {/* Iris blades: hexagon vertex out to the rim, six times. */}
      <g strokeWidth={1.5} strokeLinecap="butt">
        <path d="M14.31 8 L20.05 17.94" />
        <path d="M9.69 8 L21.17 8" />
        <path d="M7.38 12 L13.12 2.06" />
        <path d="M9.69 16 L3.95 6.06" />
        <path d="M14.31 16 L2.83 16" />
        <path d="M16.62 12 L10.88 21.94" />
      </g>

      {/* Rim: 327 degrees, gap at the upper right, so one ring reads as
          both the iris and a sync cue. Heavier than the blades, as in
          the icon: the rim is what carries the silhouette when this is
          small enough that the blades start to merge. */}
      <path d="M20.48 6.7 A10 10 0 1 1 16.23 2.94" strokeWidth={2} strokeLinecap="round" />

      {/* Arrowhead terminating the rim.

          Stroked in its own colour, not filled alone: strokeLinejoin
          rounds the three corners, and the small outward growth closes
          the gap between the triangle's base and the rim's end, which
          rendered as a hairline of background down the join. Same fix
          as build-resources/icon.svg, at this scale: 0.5 here is the
          icon's 4 times 10/76. */}
      <path
        d="M18.61 4.05 L15.22 5.08 L17.23 0.79 Z"
        fill="currentColor"
        strokeWidth={0.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
