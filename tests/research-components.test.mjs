import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const components = {
  Filters: 'search/SearchDialog.vue', Temporal: 'search/TempSearchDialog.vue',
  Video: 'viewer/MediaViewer.vue', Related: 'viewer/RelatedItemsGrid.vue',
}
const fixtureCode = `
import { reactive } from 'vue'
export const fixtures = {}
export function reset() {
 const model = reactive({ activeModel: {id:0, collection:'test'}, getModelCollection: () => 'test' })
 const item = reactive({
   selected: {id:10, metadata:{'Video ID':'video-a','Start (ms)':1000,'End (ms)':4000}},
   group: {src:'video-a.mp4', groupMediaType:2, itemsLoaded:true, items:[10,11]},
   selectedRequestIds: new Map([[0,'search-original']]), items:new Map(), groupKey:'Video ID',
   getSelectedItem(){return this.selected}, getSelectedGroup(){return this.group},
   getSetItems:()=>[], fetchMediaItems:async()=>[],
   setSelectedItem:async()=>{}, addItemToSet:()=>{}, removeItemFromSet:()=>{},
 })
 const filters = reactive({ filtersLoaded:true, filtersInfo:new Map([[0,[]]]),
   loadFilters:async()=>{}, isMain:()=>true, isGroup:()=>false, toAppliedFilters:()=>({}),
   makeRangeLeaf:(id,tagtype_id,lower_bound,upper_bound)=>({kind:'leaf',filter:{id,tagtype_id,constraint:{lower_bound,upper_bound}}}),
   makeValueLeaf:(id,tagtype_id,value_ids)=>({kind:'leaf',filter:{id,tagtype_id,constraint:{value_ids}}}),
   makeGroup:(operator,children,negate)=>({kind:'group',operator,children,negate}),
   makeActiveFilters:root=>({root}),
 })
 fixtures.model=model; fixtures.item=item; fixtures.filter=filters
 fixtures.app=reactive({session:'component-tests', selectedEvaluation:{id:''}})
 fixtures.advancedSearch=reactive({isOpen:false,payload:{},close(){this.isOpen=false}})
 fixtures.temporalSearchStore=reactive({isOpen:false,temporalSelection:[],loadingResults:false,maxVideos:100,chainsPerVideo:3,
   close(){this.isOpen=false}, search:async()=>[{requestId:'temporal-search',ids:[10,11]}]})
 fixtures.searchIndex=reactive({load:async()=>{},indexLabel:()=>undefined})
 fixtures.submission={show:()=>{}}; fixtures.error={show:error=>{throw error}}
}
`
const stores = { model:'useModelStore', item:'useItemStore', filter:'useFilterStore', app:'useAppStore', advancedSearch:'useAdvancedSearchStore', temporalSearchStore:'useTemporalSearchStore', searchIndex:'useSearchIndexStore', submission:'useSubmissionStore', error:'useErrorStore' }
const wanted = new Set(Object.values(components).map(p=>path.join(root,'src/components',p)))
const temp = await mkdtemp(path.join(tmpdir(),'research-components-'))
const bundle=await build({
 stdin:{contents:Object.entries(components).map(([name,file])=>`export {default as ${name}} from './src/components/${file}'`).join('\n')+`
export * from 'test-fixtures'; export * from './src/services/http'; export * from './src/types/mediaitem';
export {createRenderer,h,Suspense,nextTick,markRaw} from 'vue';`, resolveDir:root},
 bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.join(root,'src')},
 plugins:[{name:'component-fixtures',setup(b){
  b.onResolve({filter:/^test-fixtures$/},()=>({path:'fixtures',namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixtureCode,resolveDir:root}))
  b.onResolve({filter:/^pinia$/},()=>({path:'pinia',namespace:'store'}))
  b.onResolve({filter:/^@\/stores\//},a=>({path:a.path.split('/').pop(),namespace:'store'}))
  b.onLoad({filter:/.*/,namespace:'store'},a=>({contents:a.path==='pinia'?`export {toRefs as storeToRefs} from 'vue'`:`import {fixtures} from 'test-fixtures'; export const ${stores[a.path]} = () => fixtures.${a.path}`,resolveDir:root}))
  b.onLoad({filter:/\.vue$/},async a=>{
    if(!wanted.has(a.path)) return {contents:'export default {render:()=>null}',loader:'js'}
    const originalSource=await readFile(a.path,'utf8')
    const {descriptor}=parse(originalSource,{filename:a.path})
    // Match the project's Vue auto-imports, while executing real setup and watchers.
    const source=descriptor.scriptSetup.content
    const imported=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]/g)].flatMap(m=>m[1].split(',').map(x=>x.trim()))
    const extra=['computed','reactive','ref','watch','onMounted','onUnmounted','onBeforeUnmount','nextTick'].filter(n=>!imported.includes(n))
    const modified=originalSource.replace(source,`import {${extra.join(',')}} from 'vue'\n`+source)
    const reparsed=parse(modified,{filename:a.path}).descriptor
    return {contents:compileScript(reparsed,{id:a.path}).content,loader:'ts',resolveDir:path.dirname(a.path)}
  })
  b.onResolve({filter:/ExquisitorAPI$/},()=>({path:'api',namespace:'api'}))
  b.onLoad({filter:/.*/,namespace:'api'},()=>({contents:'export const searchText=async()=>({suggestions:[]}); export const submitAnswer=async()=>({})'}))
 }}],
})
await writeFile(path.join(temp,'components.mjs'),bundle.outputFiles[0].text)
const runtime=await import(pathToFileURL(path.join(temp,'components.mjs')))
await rm(temp,{recursive:true})
const {createRenderer,h,Suspense,nextTick,markRaw,fixtures}=runtime
const events=[]
const allEvents=[]
globalThis.window={setTimeout,clearTimeout}
globalThis.fetch=async(url,init)=>{
 assert.ok(url.endsWith('/exq/log/clientEventV2'))
 events.push(...JSON.parse(init.body))
 allEvents.push(...JSON.parse(init.body))
 return new Response('{"accepted":1}',{status:202})
}
runtime.setSessionId('component-tests')
const renderer=createRenderer({
 createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText:()=>{},setElementText:()=>{},
 parentNode:()=>null,nextSibling:()=>null,insert:()=>{},remove:()=>{},patchProp:()=>{},
})
async function mount(Component,props={}) {
 let state
 const original=Component.setup
 const component={...Component,setup(p,c){
  const result=original(p,c)
  const capture=bindings=>{state=bindings;return ()=>null}
  return result?.then?result.then(capture):capture(result)
 }}
 const app=renderer.createApp({render:()=>h(Suspense,null,{default:()=>h(component,props)})})
 app.mount({})
 for(let i=0;i<8;i++)await nextTick()
 assert.ok(state,'setup finished')
 return {state,unmount:()=>app.unmount()}
}
function reset(){runtime.reset();fixtures.item.group.groupMediaType=runtime.MediaType.Video;events.length=0}
function emitted(type){return events.filter(e=>e.type===type)}

test('filter edits and clearing are captured when they happen',async()=>{
 reset()
 const alpha={id:1,name:'Topic',tagtype:'alphanumerical',tagtypeId:1}
 const numeric={id:2,name:'Start (ms)',tagtype:'numerical_int',tagtypeId:2}
 fixtures.filter.filtersInfo.set(0,[alpha,numeric])
 fixtures.advancedSearch.isOpen=true
 const {state:s,unmount}=await mount(runtime.Filters)
 s.local.valueFilters[1]=[{id:7,value:'dogs'}]
 s.onValueFilterChange(alpha)
 s.local.valueFilters[1]=[];s.onValueFilterChange(alpha)
 s.local.rangeInputs[2]={op:'between',a:'1000',b:'2000'}
 s.onRangeInput(numeric)
 assert.equal(emitted('filter_change').length,3)
 assert.deepEqual(emitted('filter_change')[0].data.values,[{id:7,value:'dogs'}])
 assert.deepEqual(emitted('filter_change')[1].data.values,[])
 assert.equal(emitted('filter_change')[2].data.a,'1000')
 s.local.rangeInputs[2]={op:'between',a:'',b:''};s.onRangeInput(numeric)
 assert.equal(emitted('filter_change').at(-1).data.a,'')
 await new Promise(resolve=>setTimeout(resolve,200))
 assert.equal(s.local.rangeLeaves[2],undefined)
 unmount()
})

test('temporal dialog logs open, reorder, removal, reset and submit/close',async()=>{
 reset()
 fixtures.temporalSearchStore.temporalSelection=[{id:'a',name:'first'},{id:'b',name:'second'},{id:'c',name:'third'}]
 const {state:s,unmount}=await mount(runtime.Temporal)
 fixtures.temporalSearchStore.isOpen=true;await nextTick()
 s.move(0,1);s.remove(2);s.resetOrder()
 await s.search();await nextTick()
 assert.deepEqual(emitted('display_change')[0].data.ordered_query_ids,['a','b','c'])
 assert.deepEqual(emitted('display_change').find(e=>e.data.action==='Reset Temporal Search Order').data.ordered_query_ids,['a','b','c'])
 const actions=emitted('display_change').map(e=>e.data.action)
 assert.deepEqual(actions,['Open Temporal Search Dialog','Move Temporal Query','Remove Temporal Query from Selection','Reset Temporal Search Order','Execute Temporal Search','Close Temporal Search Dialog'])
 assert.deepEqual(emitted('display_change').find(e=>e.data.action==='Execute Temporal Search').data.orderedQueryIds,['a','b','c'])
 unmount()
})

test('related results log displayed IDs and clicks even when item data is cached',async()=>{
 reset()
 const {state:s,unmount}=await mount(runtime.Related,{modelId:0,mediaItem:{id:10},relatedItems:[10,11,12],requestId:'rf-original'})
 assert.deepEqual(emitted('result_state')[0].data.ids,[10,11,12])
 s.onSelect(11)
 const click=emitted('result_click')[0]
 assert.equal(click.request_id,'rf-original');assert.equal(click.data.item_id,11);assert.equal(click.data.parent_item_id,10)
 s.showRow([11,12])
 assert.equal(emitted('result_state').at(-1).data.surface,'related_dialog')
 assert.deepEqual(emitted('result_state').at(-1).data.ids,[11,12])
 unmount()
})

test('video events retain segment/request context and distinguish automatic and user seeking',async()=>{
 reset()
 const {state:s,unmount}=await mount(runtime.Video)
 const player=markRaw({currentTime:0,src:'',load(){},pause(){},play:async()=>{},removeAttribute(){}})
 s.videoPlayer.value=player;s.syncVideo()
 assert.equal(emitted('display_change').find(e=>e.target==='video').data.start_ms,1000)
 s.recordPlayback('play',false,{target:player})
 s.seekVideo(1,'segment_navigation');s.recordPlayback('seek',true,{target:player})
 player.currentTime=2.5;s.recordPlayback('seek',true,{target:player})
 assert.deepEqual(emitted('video_seek').map(e=>e.data.cause),['segment_navigation','user'])
 assert.equal(emitted('video_play')[0].request_id,'search-original')
 s.recordPlayback('pause',false,{target:player});s.recordPlayback('ended',false,{target:player})
 assert.deepEqual(emitted('video_play').map(e=>e.data.action),['play','pause','ended'])
 player.currentTime=5;s.onTimeUpdate();s.recordPlayback('seek',true,{target:player})
 assert.equal(emitted('video_seek').at(-1).data.cause,'segment_loop')
 assert.equal(emitted('video_seek').at(-1).data.position_ms,1000)
 const old=player
 fixtures.item.selected={id:11,metadata:{'Video ID':'video-b','Start (ms)':0,'End (ms)':3000}}
 fixtures.item.group={src:'video-b.mp4',groupMediaType:runtime.MediaType.Video,itemsLoaded:true,items:[11]}
 fixtures.item.selectedRequestIds.set(0,'search-new')
 await nextTick()
 const replacement=markRaw({...player,currentTime:0,src:''})
 s.videoPlayer.value=replacement;s.syncVideo()
 const before=events.length
 s.recordPlayback('pause',false,{target:old})
 assert.equal(events.length,before,'old media element cannot log into new selection')
 replacement.currentTime=1.5;s.recordPlayback('seek',true,{target:replacement})
 const seek=emitted('video_seek').at(-1)
 assert.equal(seek.data.cause,'user');assert.equal(seek.data.item_id,11);assert.equal(seek.request_id,'search-new')
 unmount()
})


test('range edits survive explicit close, Escape/backdrop close, tab switch and unmount without delayed events',async()=>{
 for (const finish of ['close','dismiss','model','unmount']) {
  reset()
  const numeric={id:2,name:'Start (ms)',tagtype:'numerical_int',tagtypeId:2}
  fixtures.filter.filtersInfo.set(0,[numeric]);fixtures.advancedSearch.isOpen=true
  const {state:s,unmount}=await mount(runtime.Filters)
  s.local.rangeInputs[2]={op:'between',a:'1000',b:'2000'}
  s.onRangeInput(numeric)
  if(finish==='close')s.close()
  if(finish==='dismiss')fixtures.advancedSearch.isOpen=false
  if(finish==='model')fixtures.model.activeModel={id:1,collection:'other'}
  await nextTick()
  unmount()
  await new Promise(resolve=>setTimeout(resolve,200))
  assert.equal(emitted('filter_change').length,1,finish)
  assert.equal(emitted('filter_change')[0].data.model_id,0,finish)
  assert.equal(emitted('filter_change')[0].data.a,'1000',finish)
 }
})

test('video context refreshes end time and producing request',async()=>{
 reset()
 const {state:s,unmount}=await mount(runtime.Video)
 const player=markRaw({currentTime:2.5,src:'',load(){},pause(){},play:async()=>{},removeAttribute(){}})
 s.videoPlayer.value=player;s.syncVideo()
 fixtures.item.selected.metadata['End (ms)']=9000
 fixtures.item.selectedRequestIds.set(0,'search-reopened')
 await nextTick()
 s.recordPlayback('play',false,{target:player})
 const event=emitted('video_play').at(-1)
 assert.equal(event.data.end_ms,9000)
 assert.equal(event.request_id,'search-reopened')
 unmount()
})

test('related relevance and full-dialog clicks distinguish ranked results from navigation context',async()=>{
 reset()
 const changes=[];fixtures.item.addItemToSet=(...args)=>changes.push(args)
 fixtures.item.removeItemFromSet=(...args)=>changes.push(args)
 const selected=[]
 const {state:s,unmount}=await mount(runtime.Related,{
  modelId:0,mediaItem:{id:10},relatedItems:[10,11,12],searchResults:[12,11],
  requestId:'in-video-search',parentRequestId:'parent-search',
  onSelectItem:(...args)=>selected.push(args),
 })
 s.onAdd({itemId:12,set:runtime.ILSets.Positives})
 s.onRemove({itemId:12,set:runtime.ILSets.Positives})
 assert.equal(changes[0][3],'in-video-search');assert.equal(changes[1][3],'in-video-search')
 s.onSelect(12)
 s.onSelect(10,true)
 const [ranked,related]=emitted('result_click')
 assert.equal(ranked.request_id,'in-video-search');assert.equal(ranked.data.relationship,'search_result')
 assert.equal(related.request_id,'parent-search');assert.equal(related.data.relationship,'related_to_selected')
 assert.deepEqual(selected,[[12,'in-video-search'],[10,'parent-search']])
 unmount()
})

after(async()=>{
 if(process.env.RESEARCH_EVENT_OUTPUT)await writeFile(process.env.RESEARCH_EVENT_OUTPUT,allEvents.map(e=>JSON.stringify(e)).join('\n')+'\n')
})
