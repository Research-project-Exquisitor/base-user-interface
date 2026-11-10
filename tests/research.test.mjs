import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise the real search client, HTTP headers and event capture together.
// Mock mode's separate API is irrelevant to this integration and is isolated.
const temp = await mkdtemp(path.join(tmpdir(), 'research-test-'))
const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({
  stdin: { contents: `export * from './src/services/http'; export * from './src/services/searchApi'; export * from './src/services/researchLog'; export * from './src/types/results'; export * from './src/services/dresApi'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'mock-api', setup(build) {
    build.onResolve({ filter: /MockExquisitorAPI/ }, () => ({ path: 'mock-api', namespace: 'test' }))
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const doURF = () => ({ suggestions: [] })' }))
  } }],
})
await writeFile(path.join(temp, 'client.mjs'), bundle.outputFiles[0].text)
const client = await import(pathToFileURL(path.join(temp, 'client.mjs')))
await rm(temp, { recursive: true })

const requests = []
let failSearch = false
let searchResults = [18, 2, 41]
globalThis.fetch = async (url, init) => {
  const request = { url, headers: init.headers, body: JSON.parse(init.body) }
  requests.push(request)
  if (url.endsWith('/exq/log/clientEventV2')) return new Response('{"accepted":1}', { status: 202 })
  if (failSearch) return new Response('test failure', { status: 500 })
  return new Response(JSON.stringify({ suggestions: searchResults }), { status: 200 })
}
const session_info = { session: 'test-session', modelId: 0, collection: 'demo' }
const input = { session_info, n: 3, text: 'dog', search_model: 'clip', seen: [] }

test('all search families share linked submission, headers and response events', async () => {
  client.setSessionId('test-session')
  for (const [endpoint, invoke] of [
    ['clip', () => client.searchText(input)],
    ['clip', () => client.searchText({ ...input, search_model: 'text' })],
    ['caption', () => client.searchText({ ...input, search_model: 'caption' })],
    ['aggregate', () => client.searchText({ ...input, search_model: 'aggregate' })],
    ['image', () => client.searchImage({ ...input, image_b64: 'image' })],
    ['rf', () => client.searchRF({ session_info, n: 3, pos: [1], neg: [2] })],
    ['temporal', () => client.searchTemporal({ session_info, hops: [], n: 3 })],
  ]) {
    requests.length = 0
    const response = await invoke()
    const [submissionRequest, search, responseRequest] = requests
    const submission = submissionRequest.body[0]
    const received = responseRequest.body[0]
    assert.equal(search.url.endsWith('/exq/search/' + endpoint), true)
    assert.equal(submission.type, 'query_submission')
    assert.equal(received.type, 'query_response_received')
    assert.equal(submission.request_id, response.request_id)
    assert.equal(received.request_id, response.request_id)
    assert.equal(search.headers['X-Exq-Request-Id'], response.request_id)
    assert.equal(search.headers['X-Exq-Event-Sequence'], String(submission.sequence))
    assert.equal(received.sequence, submission.sequence + 1)
    assert.deepEqual(received.data.suggestions, searchResults)
  }
})

test('failed searches preserve request link and emit errors', async () => {
  requests.length = 0
  failSearch = true
  await assert.rejects(client.searchText(input), /test failure/)
  failSearch = false
  const events = requests.filter(r => r.url.endsWith('/clientEventV2')).flatMap(r => r.body)
  assert.deepEqual(events.map(e => e.type), ['query_submission', 'error'])
  assert.equal(events[0].request_id, events[1].request_id)
})

test('events snapshot mutable data and sequence resets with session', () => {
  const data = { ids: [1, 2] }
  const event = client.recordResearchEvent('result_state', 'results', data)
  data.ids.push(3)
  assert.deepEqual(event.data.ids, [1, 2])
  client.setSessionId('second-session')
  assert.equal(client.recordResearchEvent('display_change', 'session', {}).sequence, 0)
})

test('display states are logged once per drawn frame: steps replaced before a frame and unchanged states are not', async () => {
  client.setSessionId('frame-session')
  requests.length = 0
  const logged = () => requests.filter(r => r.url.endsWith('/clientEventV2')).flatMap(r => r.body).filter(e => e.type === 'result_state')
  const frame = () => new Promise(resolve => setTimeout(resolve, 40))
  const state = client.frameStateRecorder('result_state', 'results')
  // Group view switches on before the new results arrive, within one frame
  state.update('old-grouped', { ids: [1, 2] })
  state.update('new-grouped', { ids: [3, 4] })
  assert.equal(logged().length, 0, 'nothing is logged before the frame')
  await frame()
  assert.deepEqual(logged().map(e => e.data.ids), [[3, 4]])
  // A step that changes and changes back within a frame isn't a new state
  state.update('other', { ids: [9] })
  state.update('new-grouped', { ids: [3, 4] })
  await frame()
  assert.equal(logged().length, 1)
  // States in different frames are each logged
  state.update('more', { ids: [3, 4, 5] })
  await frame()
  assert.deepEqual(logged().map(e => e.data.ids), [[3, 4], [3, 4, 5]])
  // flush logs a pending state right away, e.g. when the grid unmounts, and only once
  state.update('next', { ids: [5] })
  state.flush()
  await frame()
  assert.deepEqual(logged().map(e => e.data.ids), [[3, 4], [3, 4, 5], [5]])
})

test('result pages preserve old and load-more request provenance', () => {
  const pages = [{ requestId: 'first', ids: [1, 2] }, { requestId: 'more', ids: [3, 4] }]
  assert.deepEqual(client.resultIds(pages), [1, 2, 3, 4])
  assert.equal(client.resultRequestId(pages, 2), 'first')
  assert.equal(client.resultRequestId(pages, 4), 'more')
  assert.equal(client.resultRequestId(pages, 999), undefined)
})

test('answer submissions are logged before they are sent to DRES', async () => {
  requests.length = 0
  await client.submitAnswer({ session_info, qa: true, text: 'answer', evalId: 'eval-1' }, { surface: 'text_answer' })
  assert.deepEqual(requests.map(r => r.url.split('/').slice(-2).join('/')), ['log/clientEventV2', 'dres/submit'])
  assert.equal(requests[0].body[0].type, 'answer_submission')
  assert.equal(requests[0].body[0].data.surface, 'text_answer')
  assert.equal('verdict' in requests[0].body[0].data, false)
})
