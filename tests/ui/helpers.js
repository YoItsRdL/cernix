/**
 * Injected into every test page. Finds things the way a person would.
 * By accessible name and role, so a test breaks when the interface
 * becomes unusable, not when a class name changes.
 */
window.__ui = {
  tile: label => Array.from(document.querySelectorAll('[role="button"]'))
    .find(n => (n.getAttribute('aria-label') || '').startsWith(label)),

  menuItem: text => Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(n => (n.textContent || '').trim() === text),

  crumb: text => Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent || '').trim() === text),

  button: text => Array.from(document.querySelectorAll('button'))
    .find(b => (b.textContent || '').trim() === text),

  /** Everything currently selected, by accessible name. */
  selectedLabels: () => Array.from(document.querySelectorAll('[aria-label]'))
    .map(e => e.getAttribute('aria-label'))
    .filter(l => l.includes('(selected)')),

  /** The pager's "1–6 of 13" readout. */
  pagerCount: () => {
    const el = Array.from(document.querySelectorAll('span'))
      .find(n => /^\d+.\d+ of \d+$|^No \w+s$/.test((n.textContent || '').trim()))
    return el ? el.textContent.trim() : ''
  },

  /** The items-per-page control, found by its accessible name. */
  pageSizeTrigger: () => Array.from(document.querySelectorAll('button'))
    .find(b => b.getAttribute('aria-label') === 'Items per page'),

  click: node => node && node.dispatchEvent(new MouseEvent('click', { bubbles: true })),

  /**
   * Opens a Radix menu trigger.
   *
   * Radix listens for pointerdown, not click. A plain click leaves the
   * menu shut and the assertion reads as "the control is broken" when
   * the test simply knocked on the wrong door.
   */
  open: node => {
    if (!node) return 'missing node'
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      node.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerType: 'mouse' }))
    }
    return 'ok'
  },
  context: node => node && node.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 90 })),
  key: (key, mods) => window.dispatchEvent(
    new KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, mods || {}))),

  /**
   * A drag, start to finish, with one DataTransfer carried across all
   * three events, which is the point: the drop reads its payload from
   * there, not from React state.
   */
  drag: (from, to) => {
    if (!from || !to) return 'missing node'
    const dt = new DataTransfer()
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
    return 'ok'
  },

  /** The first tile's selection checkbox, whichever state it is in. */
  checkbox: () => document.querySelector(
    '[aria-label="Select asset"], [aria-label="Deselect asset"]'),

  /** How many tiles report themselves as selected, via their label. */
  selectedCount: () => document.querySelectorAll('[aria-label$="(selected)"]').length,

  calls: () => (window.__calls || []).map(c => ({ fn: c.fn, args: c.args })),
  reset: () => { if (window.__calls) window.__calls.length = 0 },
}
