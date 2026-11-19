import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Window size, tab visibility and focus, with a fake window and document so
// frames, media queries and focus can be driven by hand.
const temp = await mkdtemp(path.join(tmpdir(), 'research-page-test-'))
const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({
  stdin: { contents: `export * from './src/services/http'; export * from './src/services/pageState'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
})
await writeFile(path.join(temp, 'client.mjs'), bundle.outputFiles[0].text)
const client = await import(pathToFileURL(path.join(temp, 'client.mjs')))
await rm(temp, { recursive: true })

const sent = []
globalThis.fetch = async (url, init) => {
  for (const event of JSON.parse(init.body)) sent.push({ ...event, keepalive: init.keepalive === true })
  return new Response('{"accepted":1}', { status: 202 })
}

let frames = []
const mediaQueries = []
const win = Object.assign(new EventTarget(), {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  matchMedia(query) {
    const mq = Object.assign(new EventTarget(), { query })
    mediaQueries.push(mq)
    return mq
  },
})
let focused = true
const doc = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused })
globalThis.window = win
globalThis.document = doc
globalThis.requestAnimationFrame = callback => frames.push(callback)
const drawFrame = () => { const due = frames; frames = []; due.forEach(f => f()) }
const changes = () => sent.splice(0).map(({ type, target, data, keepalive }) => ({ type, target, keepalive, ...data }))

client.installPageStateLogging()

test('nothing is logged before the session, then the state at session start', () => {
  win.dispatchEvent(new Event('resize'))
  drawFrame()
  assert.deepEqual(changes(), [])

  client.setSessionId('page-session')
  client.logPageStateAtSessionStart()
  assert.deepEqual(changes(), [
    { type: 'display_change', target: 'session', keepalive: false, change: 'viewport', width: 1440, height: 900, device_pixel_ratio: 2, cause: 'session_start' },
    { type: 'display_change', target: 'session', keepalive: false, change: 'page_visibility', visible: true, cause: 'session_start' },
    { type: 'display_change', target: 'session', keepalive: false, change: 'window_focus', focused: true, cause: 'session_start' },
  ])
})

test('a resize logs the size drawn in each frame, and nothing for an unchanged size', () => {
  win.innerWidth = 1200
  win.dispatchEvent(new Event('resize'))
  win.innerWidth = 1100
  win.dispatchEvent(new Event('resize'))
  assert.deepEqual(changes(), [], 'waits for the frame')
  drawFrame()
  assert.deepEqual(changes().map(e => [e.change, e.width, e.cause]), [['viewport', 1100, 'resize']])

  win.dispatchEvent(new Event('resize'))
  drawFrame()
  assert.deepEqual(changes(), [])
})

test('hiding the tab is logged at once and sent with keepalive; showing it logs a size changed while hidden', () => {
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(changes().map(e => [e.change, e.visible, e.keepalive]), [['page_visibility', false, true]])

  win.innerHeight = 700
  doc.visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(changes().map(e => [e.change, e.visible, e.keepalive]), [['page_visibility', true, false]])
  drawFrame()
  assert.deepEqual(changes().map(e => [e.change, e.height]), [['viewport', 700]])
})

test('focus follows document.hasFocus, so focus moving inside the page logs nothing', () => {
  // Focus moving into an iframe blurs the window, but the page still has focus.
  win.dispatchEvent(new Event('blur'))
  assert.deepEqual(changes(), [])

  focused = false
  win.dispatchEvent(new Event('blur'))
  focused = true
  win.dispatchEvent(new Event('focus'))
  assert.deepEqual(changes().map(e => [e.change, e.focused, e.cause]), [['window_focus', false, 'blur'], ['window_focus', true, 'focus']])
})

test('a pixel ratio change without a resize is logged, and the next one too', () => {
  for (const ratio of [1, 1.5]) {
    win.devicePixelRatio = ratio
    mediaQueries.at(-1).dispatchEvent(new Event('change'))
    drawFrame()
    assert.deepEqual(changes().map(e => [e.change, e.device_pixel_ratio]), [['viewport', ratio]])
  }
  assert.equal(mediaQueries.at(-1).query, '(resolution: 1.5dppx)')
})
