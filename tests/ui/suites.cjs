/**
 * Behavioural tests for the parts of the interface that break silently:
 * how selection responds to modifiers, whether a drag actually moves
 * anything, and whether a destructive action can be taken back.
 *
 * They run in Electron rather than jsdom on purpose. Drag-and-drop needs
 * a real DataTransfer, and every behaviour here has already been broken
 * once by something jsdom does not model. A component remounting
 * mid-drag, an image owning the drag, a second toaster.
 *
 * `is` takes a *thunk*, not a value, and retries it until it matches.
 * Assertions that slept a fixed number of milliseconds made this suite
 * intermittently red, which is worse than not having it.
 */

const PLAIN = { metaKey: false, ctrlKey: false, shiftKey: false }
const RANGE = { metaKey: false, ctrlKey: true, shiftKey: false }
const TOGGLE = { metaKey: false, ctrlKey: false, shiftKey: true }

/** Ids, target and source of every move, for compact assertions. */
const MOVES = 'window.__calls.filter(c => c.fn === "driveMoveBatch")' +
  '.map(c => [c.args[0], c.args[1], c.args[2]])'

const argsOf = fn =>
  'window.__calls.filter(c => c.fn === "' + fn + '").map(c => c.args[0])'

module.exports = [
  {
    name: 'selection model',
    harness: 'selection',
    async run({ run, is }) {
      const after = async (id, mods) => {
        await run('__click(' + JSON.stringify(id) + ', ' + JSON.stringify(mods) + ')')
        return () => run('__sel()')
      }
      await is('plain click selects one', await after('c', PLAIN), 'c')
      await is('ctrl+click ranges from the anchor', await after('f', RANGE), 'c,d,e,f')
      await is('the anchor survives, so a range can be redrawn', await after('a', RANGE), 'a,b,c')
      await is('shift+click adds', await after('h', TOGGLE), 'a,b,c,h')
      await is('shift+click removes', await after('b', TOGGLE), 'a,c,h')
      await is('ctrl+click re-ranges from the new anchor', await after('d', RANGE), 'b,c,d')
      await is('a plain click replaces everything', await after('g', PLAIN), 'g')

      await run('__ui.key("a", { ctrlKey: true })')
      await is('ctrl+A selects all', () => run('__sel()'), 'a,b,c,d,e,f,g,h')

      await run('__ui.key("Escape")')
      await is('escape clears', () => run('__sel()'), '')

      // The other entry point: Local Archive, where the tile IS the
      // checkbox rather than something a checkbox sits on. A control
      // that ticks on a click has to untick on the next one. It ran
      // through the replace path, so clicking a selected photograph
      // re-selected it and Escape was the only way to drop one.
      const toggleClick = async (id, mods) => {
        await run('__toggleClick(' + JSON.stringify(id) + ', ' + JSON.stringify(mods) + ')')
        return () => run('__sel()')
      }
      await is('a plain click ticks', await toggleClick('c', PLAIN), 'c')
      await is('and the same click again unticks', await toggleClick('c', PLAIN), '')
      await is('a second item joins rather than replacing', await toggleClick('a', PLAIN), 'a')
      await is('two ticked items both stay', await toggleClick('b', PLAIN), 'a,b')
      await is('ctrl+click still ranges', await toggleClick('d', RANGE), 'b,c,d')
      await is('shift+click still adds and removes', await toggleClick('b', TOGGLE), 'c,d')
    },
  },

  {
    name: 'the tile checkbox',
    harness: 'distiller',
    async run({ run, is }) {
      // It routed through the modifier-aware click handler, where a plain
      // click replaces the selection, so a checked box re-selected itself
      // and could never be cleared by clicking it again.
      const checkbox = '__ui.checkbox()'
      const selected = '__ui.selectedCount()'

      await is('nothing is selected to begin with', () => run(selected), 0)
      await run('__ui.click(' + checkbox + ')')
      await is('clicking the checkbox selects', () => run(selected), 1)
      await run('__ui.click(' + checkbox + ')')
      await is('clicking it again deselects', () => run(selected), 0)
    },
  },

  {
    name: 'the selection belongs to the folder',
    harness: 'distiller',
    async run({ run, is }) {
      // Navigating did not touch the selection, so one made in a folder
      // survived into the next: the header said "1 selected" about
      // something nobody could see, and its Trash and Download would
      // have acted on it. Move and trash had always cleared it; this
      // was the third door into the same room.
      // Asserted on the header's own count, not on how many selected
      // tiles are on screen: the folder we navigate into is empty, so a
      // DOM count reads zero whether the model was cleared or not. The
      // first version of this test passed with the fix removed.
      const headerCount = '(() => { const el = [...document.querySelectorAll("span")]' +
        '.find(n => /^\\d+ selected$/.test((n.textContent || "").trim()));' +
        ' return el ? el.textContent.trim() : "none" })()'

      await run('__ui.reset()')
      await run('__ui.click(__ui.checkbox())')
      await is('a file is selected here', () => run(headerCount), '1 selected')

      await run('__ui.click(__ui.tile("Keepers"))')
      await is('and an empty folder opens', () => run('!__ui.tile("DSC_0001")'), true)
      await is('the selection did not come with us', () => run(headerCount), 'none')
    },
  },

  {
    name: 'drag to move',
    harness: 'distiller',
    async run({ run, is }) {
      await run('__ui.reset()')
      await run('__ui.drag(__ui.tile("DSC_0001"), __ui.tile("Keepers"))')
      await is('a file dropped on a folder moves into it',
        () => run(MOVES), [[['file-1'], 'fold-A', 'root']])

      await run('__ui.reset()')
      await run('__ui.drag(__ui.tile("Keepers"), __ui.tile("Keepers"))')
      // A negative: give it a moment to be wrong before believing it.
      await is('a folder cannot be dropped into itself', () => run(MOVES), [], 1200)

      await run('__ui.reset()')
      await run('__ui.drag(__ui.tile("DSC_0002"), __ui.crumb("Cernix"))')
      await is('dropping on the folder you are already in does nothing',
        () => run(MOVES), [], 1200)
    },
  },

  {
    name: 'drag survives a re-render',
    harness: 'distiller',
    async run({ run, wait, is }) {
      // The grid used to rebuild every tile whenever state changed, which
      // destroyed the element the drag started on. Chromium cancels a drag
      // the instant that happens, so dragging could never work, and a
      // synchronous test never noticed, because it re-queried a fresh
      // node. This one waits for a render in between, deliberately.
      await run('__ui.reset()')
      // The ghost count is read in the same evaluation as the dispatch,
      // before the next frame removes it. Read afterwards it is always
      // zero, which is all a leak check on its own would have proved.
      const ghosts = await run([
        'window.__node = __ui.tile("DSC_0001");',
        'window.__dt = new DataTransfer();',
        'window.__node.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: window.__dt }));',
        'document.querySelectorAll("[data-drag-ghost]").length',
      ].join('\n'))
      await is('the drag starts carrying something drawn for it', ghosts, 1)
      await wait(400)
      await is('the dragged tile is still in the document',
        () => run('document.contains(window.__node)'), true)

      await run([
        '(() => { const t = __ui.tile("Keepers");',
        '  t.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: window.__dt }));',
        '  t.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: window.__dt })); })()',
      ].join('\n'))
      await is('and the drop still lands', () => run(MOVES), [[['file-1'], 'fold-A', 'root']])

      // The cursor carries a drawn card rather than a screenshot of a
      // 300px tile. It is parked off-screen for one frame so the browser
      // can snapshot it; if that removal ever stops happening, a ghost
      // sits under the pointer for the rest of the session.
      await is('the drag image does not outlive the drag',
        () => run('document.querySelectorAll("[data-drag-ghost]").length'), 0)
    },
  },

  {
    name: 'move by armed pick',
    harness: 'distiller',
    async run({ run, is }) {
      await run('__ui.reset()')
      await run('__ui.context(__ui.tile("DSC_0001"))')
      await is('the context menu offers Move to',
        () => run('!!__ui.menuItem("Move to…")'), true)

      await run('__ui.click(__ui.menuItem("Move to…"))')
      await is('move mode announces itself',
        () => run('!!Array.from(document.querySelectorAll("span")).find(n => /^Moving 1 item/.test((n.textContent||"").trim()))'),
        true)

      await run('__ui.click(__ui.tile("Keepers"))')
      await is('clicking a folder completes the move',
        () => run(MOVES), [[['file-1'], 'fold-A', 'root']])

      await run('__ui.reset()')
      await run('__ui.context(__ui.tile("DSC_0002"))')
      await is('menu open again', () => run('!!__ui.menuItem("Move to…")'), true)
      await run('__ui.click(__ui.menuItem("Move to…"))')
      await run('__ui.key("Escape")')
      await is('escape leaves move mode without moving anything',
        () => run(MOVES), [], 1200)
    },
  },

  {
    name: 'undo a move',
    harness: 'distiller',
    async run({ run, is }) {
      await run('__ui.reset()')
      await run('__ui.drag(__ui.tile("DSC_0001"), __ui.tile("Keepers"))')
      await is('the move lands first', () => run(MOVES), [[['file-1'], 'fold-A', 'root']])

      await run('__ui.reset()')
      await run('__ui.key("z", { ctrlKey: true })')
      await is('ctrl+Z moves it back, source and target swapped',
        () => run(MOVES), [[['file-1'], 'root', 'fold-A']])

      await run('__ui.reset()')
      await run('__ui.key("z", { ctrlKey: true })')
      await is('the same undo does not run twice', () => run(MOVES), [], 1200)

      await run('__ui.reset()')
      await run('__ui.drag(__ui.tile("DSC_0002"), __ui.tile("Keepers"))')
      await is('the toast offers an undo', () => run('!!__ui.button("Undo")'), true)
      await run('__ui.click(__ui.button("Undo"))')
      await is('and it reverses the move',
        () => run(MOVES + '.filter(m => m[1] === "root").length'), 1)
    },
  },

  {
    name: 'undo a trash',
    harness: 'distiller',
    async run({ run, is }) {
      // The context menu used to call a second trash implementation with
      // no undo behind it, so the likeliest way to delete something was
      // the one way you could not take back.
      await run('__ui.reset()')
      await run('__ui.context(__ui.tile("DSC_0003"))')
      await is('the menu is open', () => run('!!__ui.menuItem("Move to Trash")'), true)
      await run('__ui.click(__ui.menuItem("Move to Trash"))')
      await is('trashing goes through the batch path',
        () => run(argsOf('driveTrashBatch')), [['file-3']])

      await run('__ui.reset()')
      await run('__ui.key("z", { ctrlKey: true })')
      await is('ctrl+Z restores it',
        () => run(argsOf('driveUntrashBatch')), [['file-3']])
    },
  },
  {
    name: 'paging the grid',
    harness: 'distiller',
    async run({ run, is }) {
      // Paging replaced scrolling, so the grid holding only part of the
      // folder is the point, but the count has to say so, or the
      // missing photographs just look missing.
      await run('__ui.reset()')

      await is('the first page is on screen', () => run('!!__ui.tile("DSC_0001.JPG")'), true)
      await is('and the last file is not', () => run('!!__ui.tile("DSC_0012.JPG")'), false)
      await is('the size opens where the window suggests, not at a fixed number',
        () => run('/^1–10 of 13$/.test(__ui.pagerCount())'), true)
      // One folder and twelve files. The count is the only thing on
      // screen that knows about the ones this page is not showing.
      await is('the count says how much there is',
        () => run('/ of 13$/.test(__ui.pagerCount())'), true)

      await run('__ui.click(__ui.button("2"))')
      await is('page two moves the window on',
        () => run('!!__ui.tile("DSC_0012.JPG")'), true)
      await is('and drops the first', () => run('!!__ui.tile("DSC_0001.JPG")'), false)

      await run('__ui.click(__ui.button("1"))')
      await is('back to the start', () => run('!!__ui.tile("DSC_0001.JPG")'), true)
    },
  },
  {
    name: 'choosing a page size',
    harness: 'distiller',
    async run({ run, is, wait }) {
      await run('__ui.reset()')
      await run('__ui.open(__ui.pageSizeTrigger())')
      await is('the sizes are offered', () => run('!!__ui.menuItem("10 per page")'), true)

      await run('__ui.click(__ui.menuItem("10 per page"))')
      await wait(150)
      await is('ten to a page now',
        () => run('__ui.pagerCount().replace(/\\D+/g, " ").trim()'), '1 10 13')
      await is('so the eleventh is off this page', () => run('!!__ui.tile("DSC_0011.JPG")'), false)

      await is('the choice is written down for next time',
        () => run('localStorage.getItem("cernix.pageSize")'), '10')

      await run('__ui.click(__ui.pageSizeTrigger())')
      await run('__ui.open(__ui.pageSizeTrigger())')
      await run('__ui.click(__ui.menuItem("100 per page"))')
      await wait(150)
      await is('and updated when it changes',
        () => run('localStorage.getItem("cernix.pageSize")'), '100')
      await is('a hundred holds the whole folder',
        () => run('__ui.pagerCount()'), '1–13 of 13')
    },
  },
  {
    name: 'driving the grid from the keyboard',
    harness: 'distiller',
    async run({ run, is, wait }) {
      // Paging took away the one way through a library that needed no
      // mouse. These are the way back, and the page has to follow the
      // focus or the grid fences the keyboard in at every boundary.
      await run('__ui.reset()')

      await run('__ui.key("ArrowRight")')
      await is('an arrow selects the first item',
        () => run('__ui.selectedLabels().length'), 1)

      const first = await run('__ui.selectedLabels()[0]')
      await run('__ui.key("ArrowRight")')
      await is('and the next one moves on',
        () => run('__ui.selectedLabels()[0] !== ' + JSON.stringify(first)), true)

      await run('__ui.key("End")')
      await wait(200)
      await is('End reaches the last item, on its own page',
        () => run('__ui.selectedLabels()[0]'), 'DSC_0012.JPG (selected)')
      await is('and the page came with it',
        () => run('__ui.pagerCount()'), '11–13 of 13')

      await run('__ui.key("Home")')
      await wait(200)
      await is('Home goes back to the first page',
        () => run('__ui.pagerCount()'), '1–10 of 13')

      await run('__ui.key("PageDown")')
      await wait(200)
      await is('PageDown turns the page without a mouse',
        () => run('__ui.pagerCount()'), '11–13 of 13')
    },
  },

  {
    name: 'the viewer contains the photograph',
    harness: 'lightbox',
    async run({ run, is, wait }) {
      // Every control in the viewer was absolutely positioned over the
      // field, so a frame that filled the window ran underneath the
      // arrows and had its lower edge behind the rating bar. The room
      // is a column now: the photograph gets what is left once the
      // toolbar, the arrows and the bar have taken theirs, which is a
      // property of the layout rather than of any particular frame.
      await is('no control sits on top of the photograph',
        () => run('__overlapping()'), '')

      // And not because the frame shrank to nothing: without this the
      // assertion above passes for a 1px image.
      await is('the photograph still fills most of the room',
        () => run('__frameFill() > 45'), true)

      // The window's three caption buttons are drawn at the corner over
      // everything, the viewer included. They used to sit on a patch of
      // --card floating on the field, with the viewer's own controls
      // dodging sideways to clear them. The row is theirs now, and the
      // header starts underneath it.
      await is('the caption strip runs the full width',
        () => run('__captionStrip().fullBleed'), true)
      await is('and the viewer header is below it, not beside it',
        () => run('__captionStrip().headerBelow'), true)

      // Arrowing to the next photograph. Workstation used to hold the
      // previous frame on screen until the new one arrived, and Local
      // Archive showed an empty room; both wait on the same placeholder
      // now. It is deferred, so this asserts that it appears, never how
      // fast. A frame that decodes inside the threshold is meant to
      // arrive without one.
      await run('__navigate("cernix-media://never-decodes")')
      await is('a frame that has not decoded yet shows the skeleton',
        () => run('__skeleton()'), true)

      await run('__navigate(window.__FRAME)')
      await is('and it is gone once the frame is there',
        () => run('__skeleton()'), false)

      // The point of the whole exercise: a photograph opened from the
      // grid has already been decoded once, so the viewer stands on
      // that thumbnail and sharpens rather than showing a grey box. The
      // full frame here never decodes, so anything on screen is the
      // stand-in.
      // Space marks the photograph on screen. The chip and this binding
      // existed with no caller passing the props, so neither library
      // could reach them; both pass them now, and a shortcut sheet that
      // promises "Space. Select or deselect this one" has something
      // behind it.
      await is('the viewer starts with no toggle asked for',
        () => run('__selectCalls()'), 0)
      await run('__ui.key(" ")')
      await is('Space asks the surface to toggle this frame',
        () => run('__selectCalls()'), 1)

      await run('__navigate("cernix-media://never-decodes", window.__FRAME)')
      await is('the thumbnail carries the frame while the full one loads',
        () => run('__thumbnailShowing()'), true)
      // Waited out rather than polled: `false` matches instantly, so
      // without this the assertion would pass before the placeholder
      // had a chance to appear at all.
      await wait(600)
      await is('and no skeleton appears behind it',
        () => run('__skeleton()'), false)
    },
  },

  {
    name: 'the sync mark reads on any photograph',
    harness: 'badges',
    async run({ run, is }) {
      // The old on-media treatment was a word at 11px in 70%-strength
      // colour on a 40% black scrim. Over anything bright it measured
      // as a smudge. The mark brings its own surface instead, so the
      // only thing the photograph can change is the 12% of it that
      // shows through, and that has to hold on white, black and the
      // mid grey that sits between them.
      const ratios = await run('__markContrast()')
      const worst = Math.min(...Object.values(ratios))
      await is('every mark clears 3:1 against its own chip',
        () => worst >= 3, true, 1)

      // The stronger claim, and the reason the chip is opaque: the same
      // mark measures the same on white, on black and on mid grey. What
      // is under the corner of a thumbnail cannot change whether the
      // mark can be read.
      const spread = ['synced'].map(state =>
        Math.max(...['white', 'black', 'grey'].map(g => ratios[g + '-' + state])) -
        Math.min(...['white', 'black', 'grey'].map(g => ratios[g + '-' + state])))
      await is('and measures the same whatever the photograph is',
        () => Math.max(...spread) === 0, true, 1)
      if (worst < 3 || Math.max(...spread) > 0) {
        console.log('          ratios ' + JSON.stringify(ratios))
      }
      await is('the mark is a 20px square', () => run('__markBox()'), { w: 20, h: 20 })
    },
  },
  {
    name: 'the library boots when the connection arrives',
    harness: 'distiller-disconnected',
    async run({ run, is, wait }) {
      // Signing in used to leave this surface spinning until the window
      // was reloaded. `loading` starts true and only the folder fetch
      // clears it; that fetch never ran, because the root id call
      // rejected while there was no token. With the boot on an empty
      // dependency array, the connection arriving re-ran nothing.

      // Long enough for the failed boot to have resolved. `loading`
      // starts true legitimately, so asserting it immediately would
      // pass on the initial frame and say nothing.
      await wait(1200)
      await is('with no connection the library settles rather than spinning',
        () => run('__loading()'), false)
      await is('and no folder from the library is on screen',
        () => run('!!__ui.button("Keepers")'), false)

      await run('__connect()')

      // 15s, not the default 4. A whole boot happens here - root id,
      // ratings, the folder fetch, then a virtualised grid that waits on
      // its container being measured - and at four it was reported as
      // broken while still working.
      // `__ui.button`, not `__ui.tile`: a folder renders as a real
      // button, while `tile` looks for `[role="button"]`, which is the
      // grid's photographs. Asserting on a tile would additionally wait
      // on the virtualised viewport measuring its container, so a
      // failure would not distinguish "the boot never ran" from "the
      // grid has not laid out".
      await is('signing in loads the folders, with no reload',
        () => run('!!__ui.button("Keepers")'), true, 15000)
      await is('and the files came with them',
        () => run('/of 13$/.test(__ui.pagerCount())'), true, 15000)
      await wait(600)
      await is('and the loading indicator is gone again',
        () => run('__loading()'), false)

      // auth:status is emitted on every token refresh. Two boots are
      // correct by now, one that failed at mount and one on connect;
      // what must not happen is a third, because it would drop the user
      // back to the root folder about once an hour.
      await run('window.__boots = __ui.calls().filter(c => c.fn === "driveGetRootId").length')
      await run('__emitAuthStatus({ connected: true })')
      await run('__emitAuthStatus({ connected: true })')
      await wait(300)
      await is('a later status does not re-boot an already-booted library',
        () => run('__ui.calls().filter(c => c.fn === "driveGetRootId").length === window.__boots'), true)
    },
  },
  {
    /**
     * Local Archive's destructive path.
     *
     * The shared selection model is driven directly by the `selection`
     * harness, both entry points. What only this surface can show is
     * what the list does after main has answered: a frame that was
     * refused must stay visible, because the list is the only thing
     * telling the user whether it is still on the card.
     *
     * Frames are addressed by index. The fixture carries real Windows
     * paths, and a backslash crossing suite, executeJavaScript and
     * harness needs escaping at three levels; getting one wrong turns
     * it into an identity escape that silently vanishes.
     */
    name: 'trashing from the local archive',
    harness: 'review',
    async run({ run, is }) {
      const remaining = () => run('__remaining()')
      const trashButton = 'Array.from(document.querySelectorAll("button")).find(b => (b.getAttribute("title")||"").includes("to Trash"))'

      await is('all four frames are listed', remaining, 'DSC_0001.ARW,DSC_0002.ARW,DSC_0003.ARW,DSC_0004.ARW')

      await run('__refuseIdx([])')
      await run('__selectIdx([1])')
      await is('the trash control appears once something is selected', () => run(trashButton + ' ? "yes" : "no"'), 'yes')

      await run(trashButton + '.click()')
      await is('a trashed frame leaves the list', remaining, 'DSC_0001.ARW,DSC_0003.ARW,DSC_0004.ARW')
      await is('and it is no longer selected', () => run('__selected()'), '')

      // The case that matters: main accepts one and refuses the other.
      await run('__refuseIdx([2])')
      await run('__selectIdx([2, 3])')
      await run(trashButton + '.click()')
      await is('the accepted frame goes and the refused one stays', remaining, 'DSC_0001.ARW,DSC_0003.ARW')
      await is('the refused frame is still selected, so it can be retried', () => run('__selected()'), 'DSC_0003.ARW')
    },
  },
  {
    /**
     * The editor's GLSL, compiled in a real context.
     *
     * 1500 lines of shader source live in a template literal, so nothing
     * type-checks them and no unit test can reach them. A compile error
     * is an editor that opens to a blank canvas, and it makes every
     * other editor fault unreachable, so this is the floor the rest of
     * that subsystem stands on.
     */
    name: 'the editor shaders compile',
    harness: 'shaders',
    async run({ run, is }) {
      await is('the vertex and fragment shaders both compile',
        () => run('__shaders() ? "compiled" : "FAILED: " + __shaderError()'), 'compiled')
      await is('and they link into a program', () => run('__linked()'), true)
    },
  },
]
