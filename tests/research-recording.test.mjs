import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Recorded sessions (research-workspace D32): the recording service with the
// real logger, in a fake tab. Importing the bundle again is a reload: a new
// page, the same tab (its sessionStorage).
const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'research-recording-'))
const bundle = await build({
  stdin: { contents: `export * from './src/services/http'; export * from './src/services/recording'; export * from './src/services/researchLog'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
})
const file = path.join(temp, 'recording.mjs')
await writeFile(file, bundle.outputFiles[0].text)
let page = 0
// A page load, as main.ts does it: the page_unload listener is installed at once
const loadPage = async () => {
  const tab = await import(pathToFileURL(file).href + `?page=${++page}`)
  tab.installRecording()
  return tab
}

const events = []
const sent = []
globalThis.fetch = async (url, init) => {
  if (!url.endsWith('/exq/log/clientEventV2')) return new Response('{}', { status: 200 })
  const batch = JSON.parse(init.body)
  events.push(...batch)
  sent.push(...batch.map(e => ({ type: e.type, keepalive: !!init.keepalive })))
  return new Response('{"accepted":1}', { status: 202 })
}
const store = new Map()
globalThis.sessionStorage = {
  getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
}
const listeners = {}
globalThis.window = {
  innerWidth: 1500, innerHeight: 950, devicePixelRatio: 2,
  addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
  matchMedia: () => ({ addEventListener() {} }),
}
// createElement: Vue's DOM runtime asks for one when it loads
globalThis.document = { visibilityState: 'visible', hasFocus: () => true, addEventListener() {}, createElement: () => ({}) }
globalThis.location = { pathname: '/search' }
globalThis.performance = { getEntriesByType: () => [{ type: 'reload' }] }
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
const types = () => events.map(e => e.type)
after(() => rm(temp, { recursive: true }))

test('nothing is logged until recording starts, and session_start carries the starting state', async () => {
  const tab = await loadPage()
  tab.setSessionId('unrecorded')
  tab.recordResearchEvent('display_change', 'session', { change: 'model_open' })
  assert.equal(events.length, 0)
  let snapshots = 0
  tab.onRecordingStart(() => { snapshots++ })
  const id = tab.startRecording({ models: [{ id: 0, collection: 'v3c' }], active_model: 0 })
  assert.notEqual(id, 'unrecorded')
  assert.equal(tab.getSessionId(), id)
  assert.equal(snapshots, 1)
  const start = events[0]
  assert.equal(start.type, 'session_start'); assert.equal(start.sequence, 0); assert.equal(start.session_id, id)
  assert.equal(start.data.reason, 'user_started'); assert.deepEqual(start.data.models, [{ id: 0, collection: 'v3c' }])
  assert.equal(start.data.page_id, tab.pageId)
  // The page's state follows at once
  assert.deepEqual(events.slice(1).map(e => [e.data.change, e.data.cause]),
    [['viewport', 'session_start'], ['page_visibility', 'session_start'], ['window_focus', 'session_start']])
  assert.equal(JSON.parse(store.get('exq.recording')).sequence, 4)
})

test('a reload continues the recording: page_unload, then page_load, with the sequence going on', async () => {
  const before = events.length
  const id = events[0].session_id
  listeners.pagehide.at(-1)() // the first page goes
  assert.equal(events.at(-1).type, 'page_unload')
  assert.ok(sent.at(-1).keepalive, 'page_unload outlives the page')
  const firstPage = events.at(-1).data.page_id
  const tab = await loadPage() // the reload
  assert.equal(tab.resumeRecording(), id)
  const pageStart = events.find((e, i) => i > before && e.type === 'page_load')
  assert.equal(pageStart.session_id, id)
  assert.equal(pageStart.sequence, events.at(before).sequence + 1, 'the sequence continues')
  assert.notEqual(pageStart.data.page_id, firstPage)
  assert.equal(pageStart.data.navigation, 'reload')
  assert.equal(events.at(-1).data.cause, 'page_load')
  const seqs = events.map(e => e.sequence)
  assert.deepEqual(seqs, seqs.map((_, i) => i), 'one gapless sequence across both pages')
})

test('stopping logs session_end, then nothing more, and a later page load starts unrecorded', async () => {
  const tab = await loadPage()
  tab.resumeRecording()
  tab.stopRecording()
  assert.equal(events.at(-1).type, 'session_end')
  assert.equal(events.at(-1).data.reason, 'user_ended')
  const before = events.length
  tab.recordResearchEvent('display_change', 'session', { change: 'model_open' })
  listeners.pagehide.at(-1)()
  assert.equal(events.length, before)
  assert.equal(store.has('exq.recording'), false)
  const next = await loadPage()
  assert.equal(next.resumeRecording(), undefined)
  assert.equal(next.isRecording(), false)
  assert.ok(types().indexOf('session_end') === types().length - 1)
})
