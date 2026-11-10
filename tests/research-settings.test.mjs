import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The real app and model stores, with Pinia, so a setting change is logged
// wherever it is made: the settings form and the theme button both write the store.
const temp = await mkdtemp(path.join(tmpdir(), 'research-settings-'))
const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({
  stdin: { contents: `export * from './src/stores/app'; export * from './src/stores/model'; export * from './src/services/http'; export {createPinia,setActivePinia} from 'pinia'; export {nextTick} from 'vue'`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': path.join(root, 'src') },
  // The app auto-imports Vue's API (vite.config.mts); add the names a store uses
  plugins: [{ name: 'vue-auto-imports', setup(b) {
    b.onLoad({ filter: /src\/stores\/.*\.ts$/ }, async a => {
      const source = await readFile(a.path, 'utf8')
      const imported = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g)].flatMap(m => m[1].split(',').map(x => x.trim()))
      const missing = ['computed', 'reactive', 'ref', 'watch', 'watchEffect', 'shallowReactive', 'shallowRef', 'nextTick']
        .filter(n => !imported.includes(n) && new RegExp(`\\b${n}\\(`).test(source))
      return { contents: (missing.length ? `import { ${missing.join(', ')} } from 'vue'\n` : '') + source, loader: 'ts' }
    })
  } }],
})
await writeFile(path.join(temp, 'stores.mjs'), bundle.outputFiles[0].text)
const lib = await import(pathToFileURL(path.join(temp, 'stores.mjs')))
await rm(temp, { recursive: true })

const events = []
globalThis.fetch = async (url, init) => {
  if (!url.endsWith('/exq/log/clientEventV2')) return new Response('[]', { status: 200 })
  events.push(...JSON.parse(init.body))
  return new Response('{"accepted":1}', { status: 202 })
}
const settings = () => events.filter(e => e.type === 'display_change' && e.data.change === 'setting')

test('app settings log their new and previous value', async () => {
  lib.setSessionId('settings-test')
  lib.setActivePinia(lib.createPinia())
  const app = lib.useAppStore()
  events.length = 0
  app.themeId = 'light'
  app.globalThumbSize = 260
  app.submitButtonsOn = false
  app.selectedEvaluation = { id: 'eval-1', name: 'Eval 1' }
  await lib.nextTick()
  assert.deepEqual(settings().map(e => [e.data.setting, e.data.value, e.data.previous]), [
    ['theme', 'light', 'graphiteDark'], ['thumbnail_size', 260, 220],
    ['submit_buttons', false, true], ['evaluation', 'eval-1', ''],
  ])
  assert.ok(settings().every(e => e.target === 'session'))
})

test('model settings log per changed setting, with the model, and unchanged values log nothing', () => {
  lib.setSessionId('settings-test-2')
  lib.setActivePinia(lib.createPinia())
  const models = lib.useModelStore()
  models.addModel('settings-test-2', 'demo', true)
  const model = models.models[0]
  events.length = 0
  models.updateModelSettings(model.id, { itemsToShow: 100, resources: model.settings.resources, historyEnabled: true })
  models.updateName(model, 'Mine')
  assert.deepEqual(settings().map(e => [e.data.setting, e.data.value, e.data.previous, e.data.model_id, e.data.collection]), [
    ['items_to_show', 100, 50, 0, 'demo'], ['history_enabled', true, false, 0, 'demo'], ['name', 'Mine', 'Tab 1', 0, 'demo'],
  ])
})
