/**
 * Runs the behavioural suites in tests/ui against a real Chromium.
 *
 * Electron, not jsdom: these cover drag-and-drop, which needs a working
 * DataTransfer, and several of them exist because of failures jsdom
 * cannot reproduce. A component remounting mid-drag, an image owning
 * the drag, two toasters rendering everything twice.
 *
 * Each suite names the harness it needs. Harnesses are bundled once with
 * esbuild, then each suite gets a freshly loaded page so no suite can
 * inherit another's selection, toasts or pending state.
 *
 * Exit code is the number of failures, so CI fails loudly.
 *
 * Assertions poll rather than sleep. Fixed waits made this suite
 * intermittently red on a busy machine, and an intermittently red suite
 * is worse than none. It trains people to re-run instead of read. Every
 * assertion retries until it holds or gives up, so it is fast when the
 * app is fast and patient when it is not.
 */
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TESTS = path.join(ROOT, 'tests', 'ui')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'ui-tests')

const allSuites = require(path.join(TESTS, 'suites.cjs'))

/**
 * `npm run test:ui -- <substring>` runs only the suites whose name
 * matches, and builds only the harnesses those need.
 *
 * Writing one suite used to mean a full run per iteration: thirteen
 * suites, every harness rebuilt, and the flake of a loaded machine on
 * top. Fifteen small corrections to a new suite cost an hour that way,
 * and almost all of them were the probe being wrong rather than the
 * code. Making the loop cheap is what makes checking the instrument
 * first the obvious move.
 *
 * Electron puts its own switches in argv, so only trailing non-flag
 * arguments count.
 */
const filter = process.argv.slice(2).filter(a => !a.startsWith('-')).pop() || ''
const suites = filter
  ? allSuites.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
  : allSuites

if (filter && suites.length === 0) {
  console.log(`No suite matches ${JSON.stringify(filter)}. Available:`)
  allSuites.forEach(s => console.log('  ' + s.name))
  app.exit(1)
}
if (filter) {
  console.log(`Running ${suites.length} of ${allSuites.length} suites matching ${JSON.stringify(filter)}
`)
}
const helpers = fs.readFileSync(path.join(TESTS, 'helpers.js'), 'utf8')

/** The built renderer stylesheet, so layout and visibility are real. */
function rendererCss() {
  const assets = path.join(ROOT, 'dist', 'assets')
  if (!fs.existsSync(assets)) {
    console.error('No dist/assets: run `npx vite build` first.')
    process.exit(2)
  }
  const file = fs.readdirSync(assets).filter(f => f.endsWith('.css')).sort().pop()
  if (!file) {
    console.error('No stylesheet in dist/assets. The build shape changed: fix this rather than skipping it.')
    process.exit(2)
  }
  return fs.readFileSync(path.join(assets, file), 'utf8')
}

function buildHarnesses(names) {
  fs.mkdirSync(OUT, { recursive: true })
  const css = rendererCss()
  for (const name of names) {
    const entry = path.join(TESTS, 'harness', `${name}.tsx`)
    if (!fs.existsSync(entry)) {
      console.error(`Suite asks for harness "${name}" but ${path.relative(ROOT, entry)} does not exist.`)
      process.exit(2)
    }
    execFileSync(process.execPath, [
      path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      entry, '--bundle', '--format=iife', '--jsx=automatic',
      `--alias:@=${path.join(ROOT, 'src', 'renderer')}`,
      '--define:process.env.NODE_ENV="development"',
      `--outfile=${path.join(OUT, `${name}.js`)}`,
    ], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

    fs.writeFileSync(path.join(OUT, `${name}.html`),
      '<!doctype html><meta charset="utf-8"><style>' + css + '</style>' +
      '<style>html,body{margin:0;height:100%}#root{height:100%}</style>' +
      '<body class="bg-surface-workspace"><div id="root"></div>' +
      '<script>try { localStorage.clear() } catch (e) { /* not available */ }</script>' +
      '<script>' + fs.readFileSync(path.join(OUT, `${name}.js`), 'utf8') + '</script>' +
      '<script>' + helpers + '</script></body>')
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
  await app.whenReady()
  buildHarnesses([...new Set(suites.map(s => s.harness))])

  let pageErrors = []

  /**
   * A window per suite, destroyed after.
   *
   * Reusing one window for all of them worked for the first few loads
   * and then stopped: every suite after the fourth timed out waiting to
   * mount, with no page error to explain it. Whatever accumulates across
   * repeated loads in one renderer, a fresh window does not carry.
   *
   * They are closed at the end rather than after each suite. Destroying
   * one while creating the next made the new window's very first load
   * fail with ERR_FAILED. Cheap to avoid, and seven windows cost less
   * than a flaky suite.
   *
   * Shown, not hidden: a hidden window does not paint reliably, and
   * several of these assert on things that only exist once laid out.
   */
  const openWindow = () => {
    // Tall enough for two grid rows. A page holds whole rows only, so
    // at 760px the four fixtures split across two pages and every suite
    // that reaches for the last one failed on a page it was not looking
    // at. The height is a property of the fixture, not a magic number:
    // three columns of ~325px need ~650px of viewport for two rows.
    // `backgroundThrottling: false` is load-bearing, not a precaution.
    //
    // Every window here opens at the same place, so each one covers the
    // last. Chromium treats a covered window as background and throttles
    // its rendering lifecycle, and ResizeObserver callbacks run as part
    // of that lifecycle. A throttled window therefore mounts, renders,
    // and never delivers the observation the grid needs, so `dims` stays
    // at its initial zero, `defaultColumnsFor(0)` returns one column,
    // and the fixture the mount probe reaches for is paged off screen.
    // The suite then reported "harness never mounted" about a harness
    // that had mounted perfectly.
    //
    // Measured rather than reasoned: two full runs before this line
    // failed 9 and 1 of 14 suites, three after it failed none. The
    // single-suite case does not reproduce it, because with one window
    // there is nothing to cover it.
    const w = new BrowserWindow({
      width: 1200, height: 900, show: true, x: 40, y: 40,
      webPreferences: { backgroundThrottling: false },
    })
    pageErrors = []
    // Page errors, so a mount failure can say why rather than only that
    // it happened.
    w.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/DevTools|Autofill|Content-Security/i.test(message)) pageErrors.push(message)
    })
    return w
  }

  const windows = []
  let failures = 0
  for (const suite of suites) {
    // A fresh window per suite. Shared state between them is how a
    // green run stops meaning anything.
    const win = openWindow()
    windows.push(win)
    await win.loadFile(path.join(OUT, `${suite.harness}.html`))

    // The one before last has done its job now that this one has loaded,
    // and every window still open costs a renderer process. Released
    // here rather than before the load, because destroying one while the
    // next is being created is what produced ERR_FAILED.
    const stale = windows[windows.length - 2]
    if (stale) { try { stale.destroy() } catch { /* already gone */ } }

    const run = js => win.webContents.executeJavaScript(js, true)

    /** Retries until the value matches or the deadline passes. */
    const poll = async (thunk, want, timeoutMs) => {
      const deadline = Date.now() + timeoutMs
      let got
      for (;;) {
        try { got = await thunk() } catch (err) { got = '<threw: ' + err.message.slice(0, 60) + '>' }
        if (same(got, want)) return { ok: true, got }
        if (Date.now() >= deadline) return { ok: false, got }
        await wait(50)
      }
    }

    // The harness mounts asynchronously; wait for the thing under test
    // to exist rather than guessing how long React takes.
    //
    // The two named probes are the original harnesses, which predate
    // there being a convention. A new harness sets `window.__ready` when
    // the thing it drives is on screen, and that is the probe to use.
    // Naming each harness's own globals here would mean editing the
    // runner every time one is added.
    const mounted = await poll(
      // 20s, not 10. The heavier harnesses mount a virtualised grid and
      // a mock API, and on a machine already running the app plus a
      // build they were timing out at ten while still mounting. A
      // slow suite reported as a broken one, which is the failure mode
      // this file's own comments warn about twice.
      () => run('!!(window.__ui && (window.__ready || window.__sel || __ui.tile("DSC_0001")))'), true, 20000)
    if (!mounted.ok) {
      failures++
      console.log('  ' + suite.name)
      // "Never mounted" was a lie for the whole class of failures that
      // actually motivated this timeout. The harness had mounted, React
      // had rendered, `__ui` existed; only the fixture the probe reaches
      // for was missing, because the grid had settled at one column and
      // paged the tile off screen. Twenty seconds of waiting then
      // reported the one thing that was not wrong. Ask the page which
      // case this is instead of assuming the worse one.
      const state = await run(`(() => {
        if (!window.__ui) return { mounted: false }
        const root = document.getElementById('root')
        return {
          mounted: true,
          rendered: !!root && root.children.length > 0,
          // The pager readout is the fastest way to see the state
          // that caused this: a grid stuck at one column pages the
          // fixture off screen, and "1-10 of 13" says so at a glance.
          pager: window.__ui.pagerCount ? window.__ui.pagerCount() : null,
          tiles: Array.from(document.querySelectorAll('[role="button"][aria-label]'))
            .map(n => n.getAttribute('aria-label').split(' (')[0]).slice(0, 6),
        }
      })()`).catch(() => null)

      if (!state || !state.mounted) {
        console.log('    FAIL  harness never mounted')
      } else {
        console.log('    FAIL  harness mounted, but the probe never found its fixture')
        console.log('          rendered=' + state.rendered + ' pager=' + JSON.stringify(state.pager))
        console.log('          tiles present: ' + (state.tiles.length ? state.tiles.join(', ') : '(none)'))
      }
      if (pageErrors.length) {
        console.log('          page error: ' + pageErrors[0].replace(/\s+/g, ' ').slice(0, 160))
      }
      continue
    }

    const ctx = {
      run,
      wait,
      async is(label, thunk, want, timeoutMs = 4000) {
        const { ok, got } = typeof thunk === 'function'
          ? await poll(thunk, want, timeoutMs)
          : { ok: same(thunk, want), got: thunk }
        if (ok) {
          console.log('    ok    ' + label)
        } else {
          failures++
          console.log('    FAIL  ' + label)
          console.log('          got  ' + JSON.stringify(got))
          console.log('          want ' + JSON.stringify(want))
        }
      },
    }

    console.log('  ' + suite.name)
    try {
      await suite.run(ctx)
    } catch (err) {
      failures++
      console.log('    FAIL  threw: ' + (err && err.message ? err.message : String(err)))
    }
  }

  for (const w of windows) { try { w.destroy() } catch { /* already gone */ } }

  console.log('')
  console.log(failures ? `  ${failures} failure(s).` : '  All UI behaviours correct.')
  app.exit(failures ? 1 : 0)
}

main().catch(err => { console.error(err); app.exit(2) })
