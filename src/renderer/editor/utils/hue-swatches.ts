/**
 * The colour each hue range is drawn in, in the HSL, selective colour,
 * black and white, and calibration panels.
 *
 * These are content, not chrome: the swatch for the red range is red
 * because that is the range it adjusts, so it must not follow the theme
 * and has no role in tokens.css. They match Lightroom Classic and Camera
 * Raw's eight bands. One table keeps four panels from repeating eight hex
 * values, and the design audit allows this file by name.
 */
/* eslint-disable no-restricted-syntax -- design-allow: each hex is the
   colour of the range it stands for, not chrome. */
export const HUE_SWATCHES = {
  red:     '#e74c3c',
  orange:  '#e67e22',
  yellow:  '#f1c40f',
  green:   '#27ae60',
  aqua:    '#1abc9c',
  blue:    '#2980b9',
  purple:  '#8e44ad',
  magenta: '#d63384',
} as const
/* eslint-enable no-restricted-syntax */
