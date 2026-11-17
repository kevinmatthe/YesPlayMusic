import { reactive } from 'vue'
import type { MusicApi, Track } from './core'

export function explicitSearchQuery(value:unknown):string{return typeof value==='string'?value.trim().slice(0,200):''}

/** One explicit query at a time; typing never starts network or history writes. */
export function createSourceSearch(api: Pick<MusicApi, 'search'>,record?:(query:string,source:string)=>unknown) {
  const state=reactive({source:'netease',results:[] as Track[],searching:false,searched:false,error:'',resultQuery:'',resultSource:'netease'})
  let generation=0,disposed=false
  let pending:{key:string;controller:AbortController;promise:Promise<void>}|undefined
  function cancel(){generation++;pending?.controller.abort();pending=undefined;state.searching=false;state.error=''}
  function select(source:string) {
    if(source===state.source)return
    cancel();state.source=source;state.results=[];state.searched=false;state.resultQuery='';state.resultSource=source
  }
  function edit(query:string){if(pending&&pending.key!==`${state.source}\n${explicitSearchQuery(query)}`)cancel()}
  function reset(){cancel();state.results=[];state.searched=false;state.resultQuery='';state.resultSource=state.source}
  function dispose(){disposed=true;reset()}
  function run(query:string,explicit=false):Promise<void> {
    const term=explicitSearchQuery(query)
    if(!term||disposed)return Promise.resolve()
    const key=`${state.source}\n${term}`
    if(pending?.key===key)return pending.promise
    cancel()
    const current=++generation,source=state.source,controller=new AbortController()
    const valid=()=>!disposed&&current===generation
    state.searching=true
    const timer=setTimeout(()=>controller.abort(new Error('请求超时')),20000)
    const promise=(async()=>{
      try {
        const tracks=await api.search(term,source,controller.signal)
        if(!valid())return
        state.results=tracks;state.searched=true;state.resultQuery=term;state.resultSource=source
        if(explicit&&record)void Promise.resolve(record(term,source)).catch(()=>{})
      } catch {
        if(valid())state.error=state.results.length?'这次搜索未完成，已保留上次结果。请重试。':'搜索暂时无法完成，请检查网络后重试。'
      } finally {
        clearTimeout(timer)
        if(valid()){state.searching=false;pending=undefined}
      }
    })()
    pending={key,controller,promise}
    return promise
  }
  return {state,select,edit,reset,cancel,dispose,run}
}
