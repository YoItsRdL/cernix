#!/usr/bin/env node
/**
 * Runs a script under Electron, as Electron.
 *
 * VS Code's terminals and the agents it hosts inherit
 * `ELECTRON_RUN_AS_NODE=1` from the editor, itself an Electron app.
 * Passed on, it makes Electron behave as plain Node: `app` is undefined
 * and every script below died on its first `app.whenReady()` or
 * `app.exit()` with nothing saying why. The `electron` CLI passes the
 * environment through as it is, so it is cleared here instead.
 *
 * Usage:  node scripts/electron-run.mjs scripts/ui-tests.cjs [args]
 */
import { spawnSync } from 'node:child_process'
import electron from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(electron, process.argv.slice(2), { stdio: 'inherit', env })
if (result.error) throw result.error
// The UI runner's exit code is its failure count, so it is passed on as is.
process.exit(result.status ?? 1)
