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
    name: 'the grid yields the keyboard to what is over it',
    harness: 'distiller',
    async run({ run, is }) {
      // Reported as "when we are cropping and press Enter it should
      // crop; currently it takes us to the Workstation".
      //
      // Both the crop overlay and this grid listen for Enter on
      // `window`, and the editor is a sibling of Distiller in App
      // rather than a child, so the grid could not see it and never
      // stood down. Enter committed the crop *and* activated whatever
      // tile still held the focus behind the editor, which opened a
      // folder out from under it. Local Archive has guarded its viewer
      // since it was written (`enabled: !lightboxPath`); this surface
      // guarded neither the viewer nor the editor.
      //
      // The focus is established once, with nothing over the grid, and
      // the same Enter is then pressed in both states. Only the flag
      // differs, so a pass cannot come from the focus being absent.
      const inRoot = () => run('!!__ui.tile("DSC_0001")')

      await is('the fixture is in the root folder', inRoot, true)
      await run('__ui.key("ArrowRight")')

      // Waited on, not assumed: `run` resolves when the call returns,
      // which is before React has committed the new prop and before the
      // grid's listener has been swapped. Pressing Enter into that gap
      // hits the old listener and reads as the fix not working.
      await run('__setEditorOpen(true)')
      await is('the editor is over the grid', () => run('__editorOpen()'), true)
      await run('__ui.key("Enter")')
      // A negative: give it real time to be wrong. Without the fix the
      // first tile is a folder and this navigates into it.
      await is('Enter does nothing while the editor is over the grid', inRoot, true, 1500)

      await run('__setEditorOpen(false)')
      await is('the editor closes', () => run('__editorOpen()'), false)
      await run('__ui.key("Enter")')
      await is('and works again once the editor closes', inRoot, false)
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
    name: 'the sidebar shows where you are',
    harness: 'sidebar',
    async run({ run, is }) {
      // Reported from `Cernix / 2026 / September / 06`: a day folder with
      // nothing inside it, where the whole panel read "No folders" and
      // said nothing about the three levels above.
      const rows = () => run('JSON.stringify(__rows().map(r => r.name))')

      await is('the trail is drawn even with nothing inside this folder',
        rows, '["Cernix","2026","September","06"]')
      await is('and "No folders" is gone',
        () => run(`document.body.innerText.includes('No folders')`), false)

      await is('the folder we are in is the one marked',
        () => run('JSON.stringify(__rows().filter(r => r.current).map(r => r.name))'),
        '["06"]')
      await is('and the depth is carried to a screen reader, not just drawn',
        () => run('JSON.stringify(__rows().map(r => r.level))'), '[1,2,3,4]')

      // Indent is the only thing that says "inside". If two levels share
      // one it stops being a tree and becomes a list.
      await is('each level is indented further than the one above',
        () => run(`(() => {
          const ind = __rows().map(r => r.indent)
          return ind.every((v, i) => i === 0 || v > ind[i - 1])
        })()`), true)

      // Children hang below the current folder, not beside it.
      await run(`__setChildren(['Keepers','Rejects'])`)
      await is('children hang one level below where we are',
        () => run('JSON.stringify(__rows().map(r => [r.name, r.level]))'),
        '[["Cernix",1],["2026",2],["September",3],["06",4],["Keepers",5],["Rejects",5]]')

      // An ancestor is a step back up the trail; a child is a step down.
      // They navigate differently and only the trail knows how far back.
      await run(`__row('September').click()`)
      await is('an ancestor goes back to its place in the trail',
        () => run('JSON.stringify(__navigations())'), '["crumb:2"]')
      await run(`__row('Keepers').click()`)
      await is('and a child goes into that folder',
        () => run('JSON.stringify(__navigations())'), '["crumb:2","folder:Keepers"]')

      // Pressing the folder you are already in would navigate to where
      // you already are.
      await run(`__row('06').click()`)
      await is('the folder we are in is not a link',
        () => run('JSON.stringify(__navigations())'), '["crumb:2","folder:Keepers"]')

      // Depth is the user's own Drive structure, so it has no ceiling,
      // and the panel is 208px. Measured before the clamp the label lost
      // 12px a level and was 5px wide at eleven deep: an indent with
      // nothing in it. The indent stops at MAX_INDENT_DEPTH so a name
      // stays readable however deep the tree goes.
      await run('__setDeepTrail(12)')
      await is('the label stops shrinking once the indent caps',
        () => run(`(() => {
          const w = Array.from({ length: 12 }, (_, d) => __labelWidth(d))
          return Math.min(...w) >= w[6] && w[11] === w[6]
        })()`), true)
      await is('and no name is squeezed to nothing',
        () => run('Math.min(...Array.from({length:12}, (_, d) => __labelWidth(d))) > 40'), true)

      // The clamp is a drawing decision. Reporting a folder as six deep
      // when it is eleven deep would lie about the tree to the reader
      // who can least afford it.
      // Twelve ancestors and the two children still hanging below them,
      // which is the point: the level keeps counting past the cap.
      await is('but the true depth still reaches a screen reader',
        () => run('JSON.stringify(__rows().map(r => r.level))'),
        '[1,2,3,4,5,6,7,8,9,10,11,12,13,13]')

      await run('__setTrail(4)')

      // `role="tree"` promises arrow navigation: a reader told the widget
      // is a tree presses Down and expects to move. The first version
      // announced the role and left every row its own tab stop, so
      // crossing a four-deep trail took four presses and Down did
      // nothing. One stop in, arrows within.
      await is('the tree is a single stop in the tab order',
        () => run('__tabStops()'), 1)
      await is('and the stop is the folder we are in, not the top of the trail',
        () => run('__tabStopName()'), '06')

      await run(`__row('06').focus()`)
      await is('focus starts where we are', () => run('__focused()'), '06')
      await run(`__treeKey('ArrowUp')`)
      await is('ArrowUp climbs the trail', () => run('__focused()'), 'September')
      await run(`__treeKey('ArrowDown')`)
      await is('ArrowDown goes back down', () => run('__focused()'), '06')
      await run(`__treeKey('Home')`)
      await is('Home reaches the root', () => run('__focused()'), 'Cernix')
      await run(`__treeKey('End')`)
      await is('End reaches the last row', () => run('__focused()'), 'Rejects')

      // The ends are walls, not wraps: a tree is a place, and running off
      // the top of one silently lands you somewhere you did not ask for.
      await run(`__treeKey('Home')`)
      await run(`__treeKey('ArrowUp')`)
      await is('and the top does not wrap', () => run('__focused()'), 'Cernix')

      // At the root there is one row and it is where we are, not an
      // ancestor of something.
      await run('__setTrail(1)')
      await is('at the root, the root is where we are',
        () => run('JSON.stringify(__rows().map(r => [r.name, r.current]))'),
        '[["Cernix",true],["Keepers",false],["Rejects",false]]')
    },
  },

  {
    name: 'filtering the library by rating',
    harness: 'distiller-rating',
    async run({ run, is }) {
      // Twelve files: 5,4,3,2,1 stars on file-1..5, an unrated pick on
      // file-6, five stars and a pick on file-7, and file-8..12 with no
      // rating record at all.
      // The pager's total, not the tiles on screen: the grid pages, so a
      // tile count cannot tell filtering from paging. This is also the
      // number the header is required to get right.
      //
      // The one folder is always in it. A folder carries no rating, so
      // filtering by one must not make folders disappear and strand the
      // user with no way down the tree - which is why the totals below
      // are the file count plus one rather than the file count.
      const total = () => run('__total()')
      const label = () => run('__filterLabel()')
      // `__ui.open` for the item as well as the trigger: it sends the
      // whole pointerdown/pointerup/click sequence, and Radix binds its
      // close to that rather than to a bare click. A plain click changed
      // the value and left the menu standing open over the grid, which is
      // not what a person does and hid the fact that it never closed.
      const pick = async (text) => {
        await run('__ui.open(__filterTrigger())')
        await run(`__ui.open(__ui.menuItem(${JSON.stringify(text)}))`)
        // Escape rather than relying on the selection to dismiss it.
        // Radix closes on its own pointer sequence and synthetic events do
        // not reproduce it faithfully, so the menu stays open here in a
        // way it does not for a person. Dismissing explicitly keeps the
        // next assertion looking at the grid rather than through a menu;
        // that selecting also closes it is Radix's behaviour and is not
        // verified here.
        await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      }

      await is('everything is counted to begin with', total, 13)
      await is('and the header says so', label, 'All')

      // Asserted before anything else reads it. The label lives on a
      // `textContent`, which a `display: none` element still has, so
      // every assertion about the header being legible was passing on a
      // control that was not on screen: the five-star strip this replaced
      // was hidden below a breakpoint, and the replacement had inherited
      // the same class.
      await is('and the control is actually on screen', () => run(`(() => {
        const el = __filterTrigger()
        return !!el && !!el.offsetParent && el.getBoundingClientRect().width > 0
      })()`), true)

      // A threshold, not an equality. The control this replaced compared
      // stars for equality, so asking for three hid the four- and
      // five-star frames.
      await pick('≥ 3')
      await is('three and up keeps the better ratings too', total, 5)
      await is('the header carries the filter without being opened', label, '≥ 3')

      // The regression that matters most: five files here have no rating
      // record, and the old predicate admitted them before it consulted
      // the filter at all.
      await pick('≥ 5')
      await is('an unrated photograph does not pass a threshold', total, 3)

      await pick('≥ 1')
      await is('one and up excludes a zero-star frame', total, 7)

      await is('the folder survives a filter it cannot satisfy',
        () => run('!!__ui.tile("Keepers")'), true)

      await pick('Picks')
      await is('picks are their own decision, stars or not', total, 3)
      await is('and the header says Picks', label, 'Picks')

      await pick('All')
      await is('and everything comes back', total, 13)

      // Everything the mouse can do, the keyboard can do. The control it
      // replaced was five icon buttons, reachable but never labelled as a
      // group; this is one control that says what it is set to.
      // `focusVisible: true` because the ring is `focus-visible:ring-1`,
      // and Chromium only sets that pseudo-class for focus it believes
      // came from the keyboard. A plain `.focus()` leaves the element
      // focused with no ring, so measuring one would report a control
      // with no visible focus when it has one.
      // Focused inside the poll, which is normally the mistake that makes
      // a probe unfalsifiable - but focusing is idempotent, and Radix
      // restores focus asynchronously as the menu unmounts, so a single
      // shot races that restore and lands wherever it hands back to. If
      // the control could not take focus at all this would still fail.
      await is('the trigger takes focus', () => run(
        '__filterTrigger().focus({ focusVisible: true }), document.activeElement === __filterTrigger()'
      ), true)
      await is('and is in the tab order',
        () => run('__filterTrigger().tabIndex >= 0'), true)
      // The ring is declared, not measured rendering. It is
      // `focus-visible:`, and Chromium sets that pseudo-class only for
      // focus it believes came from a real key press: `focus({
      // focusVisible: true })` does not persuade it, and a suite cannot
      // reach `CSS.forcePseudoState`, which needs the debugger from the
      // runner side. So this asserts the control carries a focus-visible
      // ring rather than that the ring paints.
      await is('and declares a focus-visible ring', () => run(`(() => {
        const c = __filterTrigger().className
        return /focus-visible:(ring|outline)/.test(c)
      })()`), true)

      await run(`__filterTrigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
      await is('Enter opens the menu', () => run(`!!__ui.menuItem('Picks')`), true)
      await run(`__ui.open(__ui.menuItem('Picks'))`)
      await is('and an option can be chosen without a mouse', label, 'Picks')
    },
  },

  {
    name: 'the filter, paging and the selection agree',
    harness: 'distiller-rating',
    async run({ run, is }) {
      const total = () => run('__total()')
      // Deliberately does not dismiss the menu, unlike the sibling suite:
      // Escape is bound to "clear the selection", so dismissing that way
      // emptied the very thing under test and the narrowing assertion
      // below passed with the narrowing removed. The menu standing open
      // does not affect a pager readout or a header count.
      const pick = async (text) => {
        await run('__ui.open(__filterTrigger())')
        await run(`__ui.open(__ui.menuItem(${JSON.stringify(text)}))`)
      }

      // Paging. Narrowing thirteen items to three while standing on the
      // second page must not strand the user on a page that no longer
      // exists, showing an empty grid and a pager that disagrees with it.
      await run('__ui.open(__ui.pageSizeTrigger())')
      await run(`__ui.click(__ui.menuItem('10 per page'))`)
      await is('ten to a page', () => run('__ui.pagerCount()'), '1–10 of 13')
      await run(`__ui.click(__ui.button('2'))`)
      await is('and the second page is a place', () => run('__ui.pagerCount()'), '11–13 of 13')

      await pick('≥ 5')
      await is('the page clamps rather than stranding the user',
        () => run('__ui.pagerCount()'), '1–3 of 3')
      await is('and there is something on it', () => run('__fileTiles()'), 2)

      // The selection. Navigating to another folder already clears it,
      // because the header said "1 selected" about something nobody could
      // see and Trash and Download would have acted on it. A filter hides
      // items the same way, so it gets the same answer: the selection is
      // narrowed to what survived rather than reaching past the screen.
      await pick('All')
      await run('__ui.key("a", { ctrlKey: true })')
      await is('everything is selected', () => run('__ui.selectedCount() > 0'), true)
      const before = await run('__selectedTotal()')

      await pick('≥ 5')
      await is('the selection is narrowed to what the filter left',
        () => run('__selectedTotal() < ' + before), true)
      await is('and nothing selected is off screen',
        () => run('__selectedTotal() <= __total()'), true)
    },
  },

  {
    name: 'auto-crop follows the straighten, not the opening',
    harness: 'geometry',
    async run({ run, is }) {
      const crop = () => run('JSON.stringify(__crop())')
      const MANUAL = '{"x":0.2,"y":0.2,"w":0.5,"h":0.5}'
      const FULL = '{"x":0,"y":0,"w":1,"h":1}'

      // Every assertion here is a negative - the crop did *not* change -
      // and `poll` returns on its first match, so a negative is true the
      // instant before the bug happens and passes for the wrong reason.
      // Verified: without this settle, removing the guard these cover
      // leaves the suite green. So the event is allowed to be processed
      // first, and only then is the absence asserted.
      const settle = () => new Promise(r => setTimeout(r, 400))
      const open = async (c, deg) => { await run(`__openWith(${c}, ${deg})`); await settle() }

      // The panel is created fresh for every photograph and its
      // auto-crop state is local and starts on, so the effect used to
      // fire on mount and replace whatever crop the photograph carried.
      // A crop composed by hand did not survive being looked at.
      await open(MANUAL, 0)
      await is('opening leaves a saved crop alone', crop, MANUAL)
      await is('and asks for nothing at all', () => run('__cropCalls().length'), 0)

      // Even when the photograph carries an angle: the crop that was
      // saved with it is the composition, not something to recompute.
      await open(MANUAL, 16.9)
      await is('an angle on the photograph does not trigger it either', crop, MANUAL)

      // The dimensions are not known until the photograph decodes, so
      // the panel's first render has none and they land a moment later.
      // That landing is a dependency change like any other, and treating
      // it as one overwrites the crop a beat after the file opens -
      // which looks like auto-crop acting on its own.
      await open(MANUAL, 16.9)
      await run('__openUndecoded(' + MANUAL + ', 16.9)')
      await settle()
      await is('an undecoded photograph keeps its crop', crop, MANUAL)
      await run('__decode()')
      await settle()
      await is('and still keeps it once the dimensions arrive', crop, MANUAL)

      // What the user does, it still does.
      await run('__setStraighten(25)')
      await is('straightening crops to the inscribed rect',
        crop, '{"x":0.042,"y":0.233,"w":0.917,"h":0.533}')
      await run('__setStraighten(16.9)')
      await is('and follows the angle back',
        crop, '{"x":0.055,"y":0.158,"w":0.889,"h":0.685}')

      await run('__autoCropBox().click()')
      await is('unticking restores the full frame', crop, FULL)
      await run('__autoCropBox().click()')
      await is('and ticking crops again',
        crop, '{"x":0.055,"y":0.158,"w":0.889,"h":0.685}')
    },
  },

  {
    name: 'the Output drawer records what the user did',
    harness: 'terminal',
    async run({ run, is }) {
      // The drawer was fed only by the main process, which sees Drive
      // ids: a move logged "Moving 3 item(s)…" and a progress count,
      // naming neither the files nor where they went. The names and the
      // folder trail exist only in the renderer, so the lines about them
      // originate there and reach the drawer over its own bus. This is
      // the join between the two; the bus itself is unit-tested.
      const lines = () => run('JSON.stringify(__lines())')

      await is('the drawer starts empty', () => run('__lineCount()'), 0)

      await run(`__log('drive', 'info', 'MOVE /Cernix/2025/DSC_0001.ARW  ->  /Cernix/2026/Keepers/DSC_0001.ARW')`)
      await is('a line the renderer logged appears', () => run('__lineCount()'), 1)

      // The whole path has to survive onto the screen. It is the point of
      // the line, and a path clipped at the container edge answers
      // nothing.
      await is('with both paths intact',
        () => run(`__lines()[0].includes('/Cernix/2025/DSC_0001.ARW') && __lines()[0].includes('/Cernix/2026/Keepers/DSC_0001.ARW')`),
        true)
      await is('and tagged with its source',
        () => run(`__lines()[0].includes('drive')`), true)

      await run(`__log('sweep', 'error', 'TRASH failed: /media/card/DCIM/100_PANA/P1100574.JPG')`)
      await is('a second lands under the first, in order',
        () => run(`__lines()[1].includes('P1100574.JPG')`), true)
      await is('and both are still on screen', () => run('__lineCount()'), 2)

      // A path is one long unbroken token with no spaces to break at.
      // Without `break-all` it runs out of the drawer and takes the rest
      // of the line with it. Deep enough that it cannot fit at any
      // plausible drawer width: verified by mutating the wrap away and
      // watching this go red, which a shorter path did not do.
      await run(`__log('drive', 'info', 'MOVE ' + __drivePath(
        'Cernix/2026/February/Barcelona/Sagrada-Familia/Selects/Keepers/Final-Delivery/Client-Approved'
          .split('/').map(name => ({ name })), 'P1100574-edited-final-v3.JPG'))`)
      await is('the deep path is on screen', () => run('__lineCount()'), 3)
      await is('a long path wraps rather than overflowing the drawer',
        () => run(`(() => {
          const el = document.querySelector('[role="log"]')
          return el.scrollWidth <= el.clientWidth + 1
        })()`), true)
      await is('and the drawer is a log to a screen reader',
        () => run(`document.querySelector('[role="log"]').getAttribute('aria-label')`), 'Output')
    },
  },

  {
    name: 'Enter commits the crop',
    harness: 'crop',
    async run({ run, is }) {
      // Reported as "when we are cropping and press Enter it should
      // effectively crop". The other half of that report - the
      // Workstation grid stealing the same Enter - is covered by "the
      // grid yields the keyboard to what is over it". This is the half
      // that says the overlay does its own job, which had no coverage
      // because the editor around it wants WebGL, a raw file and Drive.
      //
      // The gesture is fired once and awaited; only the reading is
      // polled. Doing both in one thunk is what made the viewer's arrow
      // suite unfalsifiable, and a committing keypress is exactly the
      // kind that must not be repeated by a retry.
      const committed = () => run('JSON.stringify(__committed())')
      const press = (key) =>
        run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`)

      await is('nothing is committed on open', committed, '[]')

      // Reshape the rect first, so a pass cannot come from the overlay
      // handing back the rect it was given. 1:1 on a 4000x3000 source is
      // three quarters of the width and the full height.
      await run(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '1:1').click()`)
      await is('the 1:1 preset reshapes the rect', () => run('__committed().length'), 0)

      await press('Enter')
      await is('Enter commits exactly once', () => run('__committed().length'), 1)
      await is('and commits a square of the source, not the full frame',
        () => run('__committedAspect()'), 1)
      await is('so it did not just hand back what it was given',
        committed, '[{"x":0.125,"y":0,"w":0.75,"h":1}]')

      // Escape is the other exit and must not crop.
      await press('Escape')
      await is('Escape cancels', () => run('__cancels()'), 1)
      await is('and commits nothing further', () => run('__committed().length'), 1)
    },
  },

  {
    name: 'the viewer steps between frames',
    harness: 'lightbox',
    async run({ run, is }) {
      // Reported as "the arrows should change the asset depending on
      // left or right". Every layer read as correct — the buttons call
      // the handlers, ArrowRight maps to next, ArrowLeft to prev, and
      // both callers pass the props — so reading was the wrong
      // instrument and this is the right one.
      //
      // The harness used to pass `() => {}` for both, which proved the
      // arrows were on screen and could never prove they moved
      // anything. That is why a break here would have been silent.
      // The gesture fires once, awaited on its own; only the reading
      // is polled. Doing it in one thunk made the suite unfalsifiable:
      // `poll` retries the thunk every 50ms, so each retry pressed the
      // arrow again, and a wrapping list of three walks through every
      // value an assertion could ask for inside 150ms. All seven
      // assertions passed with ArrowLeft wired to `goNext`.
      // Both halves, together: which frame the list moved to, and which
      // frame is on screen. The first alone passes for a viewer that
      // steps its index and keeps showing the previous photograph,
      // which is what the report would look like from outside.
      // -1 is the frame the other suites open on, before any step.
      const at = () => run('JSON.stringify([__index(), __shownFrame()])')
      const clickArrow = (label) =>
        run(`document.querySelector('[aria-label="${label}"]').click()`)
      const pressKey = (key) =>
        run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}' }))`)

      await is('starts before any of the three frames', at, '[0,-1]')

      await clickArrow('Next')
      await is('the right arrow goes forward', at, '[1,1]')
      await clickArrow('Previous')
      await is('the left arrow goes back', at, '[0,0]')

      // The keys are the same gesture and a separate code path: they
      // reach `goNext`/`goPrev` through the window listener rather than
      // through onClick, so one can work while the other does not.
      await pressKey('ArrowRight')
      await is('ArrowRight goes forward', at, '[1,1]')
      await pressKey('ArrowLeft')
      await is('ArrowLeft goes back', at, '[0,0]')

      // Both real callers wrap, so the ends of the list are not walls.
      await pressKey('ArrowLeft')
      await is('going back from the first wraps to the last', at, '[2,2]')
      await pressKey('ArrowRight')
      await is('and forward from the last wraps to the first', at, '[0,0]')
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
