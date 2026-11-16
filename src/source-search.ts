import { reactive } from 'vue'
import type { MusicApi, Track } from './core'

// A source switch invalidates the previous request; recording IDs stay literal.
export function explicitSearchQuery(value:unknown):string{return typeof value==='string'?value.trim().slice(0,200):''}
export function createSourceSearch(api: Pick<MusicApi, 'search'>,record?:(query:string,source:string)=>unknown) {
  const state=reactive({source:'netease',results:[] as Track[],searching:false,searched:false})
  let generation=0
  function select(source:string) {
    generation++
    state.source=source
    state.results=[]
    state.searching=false
    state.searched=false
  }
  async function run(query:string,explicit=false) {
    const term=explicitSearchQuery(query)
    if(!term) return
    const current=++generation,source=state.source
    state.searching=true
    try {
      if(explicit&&record)void Promise.resolve(record(term,source)).catch(()=>{})
      const tracks=await api.search(term,source)
      if(current!==generation) return
      state.results=tracks
      state.searched=true
    } catch(error) {
      if(current===generation) throw error
    } finally {
      if(current===generation) state.searching=false
    }
  }
  return {state,select,run}
}
