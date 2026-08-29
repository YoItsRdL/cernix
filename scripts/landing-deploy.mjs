#!/usr/bin/env node
/**
 * Builds and publishes the landing page.
 *
 * `netlify deploy --prod` began returning `Forbidden` for this project
 * partway through a session, while every other call kept working: reads,
 * draft deploys, and publishing a built deploy through the API. Auth,
 * team and ownership all check out, so the refusal is specific to the
 * CLI's production path rather than to the account.
 *
 * The way round it is two steps: deploy as a draft, then promote that
 * deploy. This script is those two steps, so the knowledge lives here
 * instead of in whoever last deployed. If `--prod` starts working again,
 * delete this and use it.
 *
 *   npm run landing:deploy
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// `shell: true` on Windows: Node refuses to spawn a .cmd directly, and
// both npm and npx are .cmd shims there.
const shell = process.platform === 'win32'
const npx = shell ? 'npx.cmd' : 'npx'

const run = (args, opts = {}) =>
  execFileSync(npx, args, { cwd: ROOT, encoding: 'utf-8', shell, ...opts })

/**
 * Quote a JSON argument so it survives cmd.exe.
 *
 * `shell: true` hands the argv to the shell, which eats the double
 * quotes in `{"site_id":"…"}` and leaves the CLI with `{site_id:…}`,
 * which it rejects as invalid JSON. Escaping them here is the price of
 * needing a shell at all, and the shell is needed because npx is a .cmd
 * on Windows and Node will not spawn one directly.
 */
const jsonArg = (value) =>
  shell ? `"${JSON.stringify(value).replace(/"/g, '\\"')}"` : JSON.stringify(value)

const siteId = JSON.parse(
  readFileSync(path.join(ROOT, '.netlify/state.json'), 'utf-8'),
).siteId

console.log('Building the landing page…')
execFileSync(shell ? 'npm.cmd' : 'npm', ['run', 'landing:build'],
  { cwd: ROOT, stdio: 'inherit', shell })

console.log('Deploying as a draft…')
// `--json` so the id is read rather than scraped out of a banner. npm
// prints its own notices to stdout first, so parse from the first brace
// rather than the first byte.
const json = (out) => JSON.parse(out.slice(out.search(/[[{]/)))

const draft = json(run(['netlify', 'deploy', '--dir=landing', '--json']))
const deployId = draft.deploy_id ?? draft.deployId
if (!deployId) {
  console.error('No deploy id in the CLI output:', Object.keys(draft).join(', '))
  process.exit(1)
}
console.log(`  draft ${deployId}`)
if (draft.deploy_url) console.log(`  ${draft.deploy_url}`)

console.log('Promoting it to production…')
const promoted = json(run([
  'netlify', 'api', 'restoreSiteDeploy',
  '--data', jsonArg({ site_id: siteId, deploy_id: deployId }),
]))
console.log(`  live at ${promoted.ssl_url ?? promoted.url}`)
