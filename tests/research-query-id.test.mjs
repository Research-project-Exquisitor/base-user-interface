import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// A search's events say which history entry it creates or adds a page to
// (research-workspace D37), so the log links an entry to its search.
const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'research-query-id-'))
after(() => rm(temp, { recursive: true }))
const bundle = await build({
  stdin: { contents: `export * from './src/services/http'; export * from './src/services/searchApi'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'mock-api', setup(build) {
    build.onResolve({ filter: /MockExquisitorAPI/ }, () => ({ path: 'mock-api', namespace: 'test' }))
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const doURF = () => ({ suggestions: [] })' }))
  } }],
})
await writeFile(path.join(temp, 'client.mjs'), bundle.outputFiles[0].text)
const client = await import(pathToFileURL(path.join(temp, 'client.mjs')))

const events = []
globalThis.fetch = async (url, init) => {
  if (url.endsWith('/exq/log/clientEventV2')) { events.push(...JSON.parse(init.body)); return new Response('{"accepted":1}', { status: 202 }) }
  return new Response(JSON.stringify({ suggestions: [1, 2] }), { status: 200 })
}
const session_info = { session: 'query-id', modelId: 0, collection: 'demo' }
client.setSessionId('query-id'); client.setRecording(true)

test('a text search carries its history entry on the submission and the response', async () => {
  events.length = 0
  await client.searchText({ session_info, n: 2, text: 'dog', search_model: 'clip', seen: [] }, { query_id: 'entry-1' })
  const [submission, received] = events
  assert.equal(submission.type, 'query_submission')
  assert.equal(submission.data.query_id, 'entry-1')
  assert.equal(received.type, 'query_response_received')
  assert.equal(received.data.query_id, 'entry-1')
})

test('a temporal search also names the entries it combines', async () => {
  events.length = 0
  await client.searchTemporal({ session_info, hops: [], n: 2 }, { query_id: 'temporal-1', hop_query_ids: ['entry-1', 'entry-2'] })
  assert.deepEqual(events[0].data.hop_query_ids, ['entry-1', 'entry-2'])
  assert.equal(events[1].data.query_id, 'temporal-1')
})

test('without a context nothing is added', async () => {
  events.length = 0
  await client.searchRF({ session_info, n: 2, pos: [1], neg: [2] })
  assert.equal('query_id' in events[0].data, false)
})
