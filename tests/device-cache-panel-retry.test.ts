import { describe, expect, it, vi } from 'vitest'
import { createRenderer, nextTick } from 'vue'
import type { Component } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import { createRequire } from 'node:module'
import source from '../src/ui/DeviceCachePanel.vue?raw'
import type { DeviceAudioCache, DeviceCacheSnapshot } from '../src/core/device-audio-cache'

// Vitest's Node environment transforms normal .vue imports for SSR. Compile
// this same SFC for a client renderer using the project's existing toolchain.
const script=compileScript(parse(source).descriptor,{id:'cache-panel-retry',inlineTemplate:true}).content
const compiled=transpileModule(script,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText
const exports:{default?:Component}={}
new Function('require','exports',compiled)(createRequire(import.meta.url),exports)
const DeviceCachePanel=exports.default!

interface TestNode {type:string;props:Record<string,unknown>;children:TestNode[];text:string;parent:TestNode|null}
const node=(type:string,text=''):TestNode=>({type,props:{},children:[],text,parent:null})
// Mount the real SFC with Vue's public renderer API. This host records real
// attributes/events and lifecycle transitions; browser tests cover CSS layout.
function host(){
 const remove=(child:TestNode)=>{if(child.parent){const i=child.parent.children.indexOf(child);if(i>=0)child.parent.children.splice(i,1)}child.parent=null}
 const insert=(child:TestNode,parent:TestNode,anchor?:TestNode|null)=>{remove(child);const i=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(i<0?parent.children.length:i,0,child);child.parent=parent}
 return createRenderer<TestNode,TestNode>({
  patchProp:(el,key,_before,after)=>{el.props[key]=after},insert,remove,
  createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
  setText:(el,text)=>{el.text=text},setElementText:(el,text)=>{el.children=[];el.text=text},
  parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]??null,
  setScopeId:(el,id)=>{el.props[id]=''},
  insertStaticContent:(html,parent,anchor)=>{const el=node('#static',html.replace(/<[^>]*>/g,''));insert(el,parent,anchor);return[el,el]},
 })
}
const descendants=(el:TestNode):TestNode[]=>[el,...el.children.flatMap(descendants)]
const text=(el:TestNode):string=>el.text+el.children.map(text).join('')
const button=(root:TestNode,name:string)=>descendants(root).find(el=>el.type==='button'&&text(el).includes(name))
const flush=async()=>{await Promise.resolve();await Promise.resolve();await nextTick()}

describe('manual retry after cache-settings initialization fails',()=>{
 it('keeps controls safe after aborted/unavailable reads, then enables them only after a user retry succeeds',async()=>{
  for(const failure of [new DOMException('identity changed','AbortError'),Object.assign(new Error('temporarily unavailable'),{status:503})]){
   let complete!:()=>void;const sessionReady=new Promise<void>(resolve=>complete=resolve)
   let state:DeviceCacheSnapshot={enabled:true,usedBytes:0,count:0,limitBytes:256*1024*1024,state:'idle',message:'',persistent:false}
   let subscriber:(state:DeviceCacheSnapshot)=>void=()=>{}
   const refresh=vi.fn().mockRejectedValueOnce(failure).mockImplementationOnce(async()=>{await sessionReady;state={...state,count:1,usedBytes:4096};subscriber({...state})})
   const unsubscribe=vi.fn(),cache={snapshot:()=>({...state}),subscribe:(fn:typeof subscriber)=>{subscriber=fn;fn({...state});return unsubscribe},refresh} as unknown as DeviceAudioCache
   const root=node('root'),app=host().createApp(DeviceCachePanel,{cache});app.mount(root);await flush()
   expect(refresh).toHaveBeenCalledTimes(1)
   const checkbox=()=>descendants(root).find(el=>el.type==='input'&&el.props.type==='checkbox')!
   expect(checkbox().props.disabled).toBe(true);expect(descendants(root).some(el=>el.props.role==='alert')).toBe(true)
   const retry=button(root,'重新读取缓存设置');expect(retry,'an explicit usable retry must remain after the first failure').toBeDefined();expect(retry!.props.disabled).toBe(false)
   const click=retry!.props.onClick as ()=>Promise<void>;const first=click();const duplicate=click();await flush()
   expect(refresh).toHaveBeenCalledTimes(2);expect(button(root,'正在读取缓存设置')?.props.disabled).toBe(true);expect(checkbox().props.disabled).toBe(true)
   complete();await Promise.all([first,duplicate]);await flush()
   expect(checkbox().props.disabled).toBe(false);expect(button(root,'清空当前空间缓存')?.props.disabled).toBe(false);expect(button(root,'请求浏览器保留缓存')?.props.disabled).toBe(false)
   expect(button(root,'重新读取缓存设置')).toBeUndefined();expect(descendants(root).some(el=>el.props.role==='alert')).toBe(false);expect(text(root)).toContain('当前音乐空间 · 1 首')
   await flush();expect(refresh).toHaveBeenCalledTimes(2);app.unmount();expect(unsubscribe).toHaveBeenCalledTimes(1)
  }
 })
})
