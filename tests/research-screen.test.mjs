import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Result visibility, scroll gestures and back/forward (phase 5, D26), with
// fake DOM classes so observer callbacks and scroll events can be driven by hand.
class FakeElement extends EventTarget {
  constructor({ eid = null, parent = null, classes = [] } = {}) {
    super()
    Object.assign(this, { eid, parent, classList: new Set(classes), scrollTop: 0, scrollLeft: 0, scrollHeight: 4000, scrollWidth: 800, clientHeight: 700, clientWidth: 800 })
    this.classList.contains = this.classList.has
  }
  getAttribute(name) { return name === 'data-eid' ? this.eid : null }
  closest(selector) {
    for (let el = this; el; el = el.parent) {
      if (selector === '[data-eid]' && el.eid) return el
      if (selector.startsWith('.') && el.classList.has(selector.slice(1))) return el
    }
    return null
  }
}
class FakeDocument extends EventTarget { scrollingElement = null }
globalThis.Element = FakeElement
globalThis.Document = FakeDocument
globalThis.HTMLInputElement = class extends FakeElement {}
globalThis.HTMLTextAreaElement = class extends FakeElement {}
globalThis.document = new FakeDocument()
globalThis.window = Object.assign(new EventTarget(), { onscrollend: null })

let observerCallback
const observed = new Set()
globalThis.IntersectionObserver = class {
  constructor(callback, options) { observerCallback = callback; this.options = options }
  observe(el) { observed.add(el) }
  unobserve(el) { observed.delete(el) }
}
const report = (...entries) => observerCallback(entries.map(([target, ratio]) => ({ target, intersectionRatio: ratio, isIntersecting: ratio > 0 })))

const temp = await mkdtemp(path.join(tmpdir(), 'research-screen-test-'))
const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({
  stdin: { contents: `export * from './src/services/http'; export * from './src/services/visibilityLog'; export * from './src/services/scrollLog'; export * from './src/services/navigationLog'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
})
await writeFile(path.join(temp, 'client.mjs'), bundle.outputFiles[0].text)
const client = await import(pathToFileURL(path.join(temp, 'client.mjs')))
await rm(temp, { recursive: true })

const sent = []
globalThis.fetch = async (url, init) => {
  sent.push(...JSON.parse(init.body))
  return new Response('{"accepted":1}', { status: 202 })
}
const take = type => sent.splice(0).filter(e => e.type === type)
client.setSessionId('screen-session'); client.setRecording(true)

const tile = (item_id, parent) => {
  const el = new FakeElement({ parent })
  const stop = client.watchTileVisibility(el, () => ({ item_id, surface: 'result_grid', model_id: 0, request_id: 'search-1' }))
  return { el, stop }
}

test('tiles log crossing 0, 50% and 100% in view, one event per observer batch', () => {
  const a = tile(1), b = tile(2), c = tile(3)
  // The first report for each tile: c is out of view and was never on screen
  report([a.el, 1], [b.el, 0.3], [c.el, 0])
  let [event] = take('visibility_change')
  assert.equal(event.target, 'results')
  assert.deepEqual(event.data.changes.map(ch => [ch.item_id, ch.ratio]), [[1, 1], [2, 0.3]])
  assert.equal(event.data.changes[0].request_id, 'search-1')

  // Moving within the same band logs nothing; crossing a threshold logs
  report([b.el, 0.4])
  assert.deepEqual(take('visibility_change'), [])
  report([b.el, 0.6], [a.el, 0])
  ;[event] = take('visibility_change')
  assert.deepEqual(event.data.changes.map(ch => [ch.item_id, ch.ratio]), [[2, 0.6], [1, 0]])
  ;[a, b, c].forEach(t => t.stop())
  sent.length = 0
})

test('tiles removed while in view are closed in one event, before the next task', async () => {
  const tiles = [tile(10), tile(11), tile(12)]
  report([tiles[0].el, 1], [tiles[1].el, 0.5], [tiles[2].el, 0])
  sent.length = 0
  tiles.forEach(t => t.stop())
  assert.equal(observed.size, 0)
  await Promise.resolve()
  const [event] = take('visibility_change')
  assert.deepEqual(event.data.changes.map(ch => [ch.item_id, ch.ratio, ch.cause]), [[10, 0, 'removed'], [11, 0, 'removed']])
})

test('tiles in a closing dialog count as out of view', () => {
  const overlay = new FakeElement({ classes: ['v-overlay', 'v-overlay--active'] })
  const shown = tile(20, overlay)
  report([shown.el, 1])
  assert.equal(take('visibility_change')[0].data.changes[0].ratio, 1)

  overlay.classList.delete('v-overlay--active')
  const late = tile(21, overlay)
  // A row rendered during the closing animation: never logged as visible
  report([late.el, 1], [shown.el, 1])
  const [event] = take('visibility_change')
  assert.deepEqual(event.data.changes.map(ch => [ch.item_id, ch.ratio]), [[20, 0]])
  shown.stop(); late.stop()
})

client.installScrollLogging()
const grid = new FakeElement({ eid: 'result_grid' })
const body = new FakeElement({ parent: grid })
const scroll = (el, top) => { el.scrollTop = top; const e = new Event('scroll'); Object.defineProperty(e, 'target', { value: el }); document.dispatchEvent(e) }
const scrollEnd = el => { const e = new Event('scrollend'); Object.defineProperty(e, 'target', { value: el }); document.dispatchEvent(e) }

test('a scroll gesture logs its start and its end at scrollend, nothing in between', () => {
  window.dispatchEvent(new Event('wheel'))
  scroll(body, 40); scroll(body, 300); scroll(body, 900)
  scrollEnd(body)
  const events = take('scroll')
  assert.deepEqual(events.map(e => [e.data.phase, e.data.top, e.data.container]), [['start', 40, 'result_grid'], ['end', 900, 'result_grid']])
  assert.equal(events[0].data.last_input.type, 'wheel')
  assert.ok(events[0].data.last_input.ms_before >= 0)
  assert.equal(events[1].data.end_by, 'scrollend')
  assert.equal(events[1].data.client_height, 700)

  // A new gesture after the end starts again
  scroll(body, 950); scrollEnd(body)
  assert.deepEqual(take('scroll').map(e => e.data.phase), ['start', 'end'])
})

test('text fields scrolling their own text are not gestures', () => {
  const input = new HTMLInputElement({ eid: 'search_bar' })
  scroll(input, 20); scrollEnd(input)
  assert.deepEqual(take('scroll'), [])
})

test('without scrollend, a gesture ends 150 ms after the last scroll, marked as such', async () => {
  delete window.onscrollend
  scroll(body, 1000); scroll(body, 1100)
  await new Promise(resolve => setTimeout(resolve, 60))
  scroll(body, 1200)
  await new Promise(resolve => setTimeout(resolve, 200))
  const events = take('scroll')
  assert.deepEqual(events.map(e => [e.data.phase, e.data.top, e.data.end_by ?? null]), [['start', 1000, null], ['end', 1200, 'timeout']])
  window.onscrollend = null
})

test('the browser back and forward buttons log back_navigation', () => {
  let listener
  client.installNavigationLogging({ options: { history: { listen: fn => { listener = fn } } } })
  listener('/', '/search', { direction: 'back', delta: -1, type: 'pop' })
  listener('/search', '/', { direction: 'forward', delta: 1, type: 'pop' })
  assert.deepEqual(take('back_navigation').map(e => [e.target, e.data.direction, e.data.delta, e.data.from, e.data.to]), [
    ['session', 'back', -1, '/search', '/'],
    ['session', 'forward', 1, '/', '/search'],
  ])
})
