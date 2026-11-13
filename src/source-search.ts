import { reactive } from 'vue'
import type { MusicApi, Track } from './core'

// A source switch invalidates the previous request; recording IDs stay literal.
export function createSourceSearch(api: Pick<MusicApi, 'search'>) {
  const state=reactive({source:'netease',results:[] as Track[],searching:false,searched:false})
  let generation=0
  function select(source:string) {
    generation++
    state.source=source
    state.results=[]
    state.searching=false
    state.searched=false
  }
  async function run(query:string) {
    if(!query.trim()) return
    const current=++generation,source=state.source
    state.searching=true
    try {
      const tracks=await api.search(query,source)
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
