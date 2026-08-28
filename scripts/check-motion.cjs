/**
 * Motion has one vocabulary, and both halves of it agree.
 *
 * There are two, unavoidably: Framer Motion takes seconds in
 * TypeScript, CSS takes milliseconds. They describe the same three
 * speeds, and nothing but this connects them. Change one and the other
 * drifts silently, which is how nine components ended up each picking
 * their own number in the first place.
 *
 * Also refuses a raw duration written into a `transition={{ ... }}`.
 * That is the actual failure mode: not a wrong value, but a value
 * chosen locally by someone who did not know a scale existed.
 *
 * Exit code is the number of problems.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MOTION_TS = path.join(ROOT, 'src', 'renderer', 'lib', 'motion.ts')
const TOKENS_CSS = path.join(ROOT, 'src', 'shared', 'tokens.css')
const RENDERER = path.join(ROOT, 'src', 'renderer')

let problems = 0
const fail = (msg, detail) => {
  problems++
  console.log('  ' + msg)
  if (detail) console.log('        ' + detail)
}

// ── The two scales must match ──────────────────────────────────────
const ts = fs.readFileSync(MOTION_TS, 'utf8')
const css = fs.readFileSync(TOKENS_CSS, 'utf8')

const seconds = name => {
  const m = ts.match(new RegExp(`export const DURATION_${name}\\s*=\\s*([\\d.]+)`))
  return m ? Number(m[1]) : null
}
const millis = name => {
  const m = css.match(new RegExp(`--duration-${name.toLowerCase()}:\\s*(\\d+)ms`))
  return m ? Number(m[1]) : null
}

for (const name of ['FAST', 'STANDARD', 'SLOW']) {
  const s = seconds(name)
  const ms = millis(name)
  if (s === null) { fail(`DURATION_${name} is missing from lib/motion.ts`); continue }
  if (ms === null) { fail(`--duration-${name.toLowerCase()} is missing from tokens.css`); continue }
  if (Math.round(s * 1000) !== ms) {
    fail(`DURATION_${name} and --duration-${name.toLowerCase()} disagree`,
      `${s}s is ${Math.round(s * 1000)}ms, CSS says ${ms}ms`)
  }
}

// ── No locally-invented durations ──────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(e.name)) out.push(full)
  }
  return out
}

for (const file of walk(RENDERER)) {
  const source = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')

  // A number where a token belongs. Delays and staggers are exempt:
  // they are about sequence, not speed, and have no scale to belong to.
  for (const m of source.matchAll(/transition=\{\{([^}]*)\}\}/g)) {
    const body = m[1]
    if (!/\bduration:\s*[\d.]/.test(body)) continue
    const line = source.slice(0, m.index).split('\n').length
    fail(`${rel}:${line}  a raw duration inside transition={{ }}`,
      `use DURATION_FAST / _STANDARD / _SLOW from @/lib/motion: found: ${body.trim().slice(0, 60)}`)
  }

  // A spring spelled out rather than named.
  for (const m of source.matchAll(/type:\s*'spring'[^}]*stiffness:\s*(\d+)[^}]*damping:\s*(\d+)/g)) {
    if (rel.endsWith('lib/motion.ts')) continue
    const line = source.slice(0, m.index).split('\n').length
    fail(`${rel}:${line}  a spring written out by hand`,
      `stiffness ${m[1]}, damping ${m[2]}: use SPRING_STANDARD / _SLOW / _SNAPPY`)
  }
}

// ── Reduce Motion must be honoured ─────────────────────────────────
if (!css.includes('prefers-reduced-motion')) {
  fail('tokens.css has no prefers-reduced-motion block',
    'CSS transitions would ignore the system setting entirely')
}
const main = fs.readFileSync(path.join(RENDERER, 'main.tsx'), 'utf8')
if (!/reducedMotion=["']user["']/.test(main)) {
  fail('main.tsx does not wrap the app in <MotionConfig reducedMotion="user">',
    'every Framer animation would ignore the system setting')
}

console.log('')
console.log(problems
  ? `  ${problems} motion problem(s).`
  : '  Motion is one vocabulary: both scales agree, no local durations, Reduce Motion honoured.')
process.exit(problems ? 1 : 0)
