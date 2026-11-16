import { reactive } from 'vue'
import type { MusicApi, Recommendation, SearchRecord, Track } from './core'

const basisLabels={likes:'来自你的喜欢',history:'根据最近播放',search:'根据主动搜索',discovery:'公开曲库推荐'}
export function recommendationNote(item:Recommendation):string {
  const basis=basisLabels[item.basis]||basisLabels.discovery
  return item.reason?`${basis} · ${item.reason}`:basis
}

/** Personal data is bound to the current verified server session, never a client owner parameter. */
export function createInterestFeed(api:Pick<MusicApi,'recommendations'|'searchHistory'|'recordSearch'|'clearSearchHistory'>,fallback:()=>Promise<Track[]>){
  const state=reactive({owner:'',items:[] as Recommendation[],personalized:false,loading:false,error:'',searches:[] as SearchRecord[],historyLoading:false,historyError:''})
  let recommendationGeneration=0,historyGeneration=0,historyEpoch=0,writes=Promise.resolve()
  function setOwner(owner:string){
    if(state.owner===owner)return
    state.owner=owner;recommendationGeneration++;historyGeneration++;historyEpoch++;writes=Promise.resolve()
    state.items=[];state.personalized=false;state.loading=false;state.error=''
    state.searches=[];state.historyLoading=false;state.historyError=''
  }
  async function loadRecommendations(){
    if(!state.owner)return
    const owner=state.owner,generation=++recommendationGeneration,current=()=>owner===state.owner&&generation===recommendationGeneration
    state.loading=true;state.error=''
    try{
      let result
      try{result=await api.recommendations(12)}catch{if(!current())return}
      if(!current())return
      if(!result?.tracks.length){result={tracks:(await fallback()).map(track=>({track,reason:'从公开曲库开始发现',basis:'discovery' as const})),personalized:false}}
      if(!current())return
      const seen=new Set<string>()
      state.items=result.tracks.filter(item=>!seen.has(item.track.id)&&Boolean(seen.add(item.track.id)))
      state.personalized=result.personalized
    }catch{if(current())state.error='推荐暂时无法载入，请稍后重试或搜索歌曲。'}
    finally{if(current())state.loading=false}
  }
  async function loadSearches(){
    if(!state.owner)return
    const owner=state.owner,generation=++historyGeneration,current=()=>owner===state.owner&&generation===historyGeneration
    state.historyLoading=true;state.historyError=''
    try{const result=await api.searchHistory(20);if(current())state.searches=result.searches}
    catch{if(current())state.historyError='最近搜索暂时无法载入。'}
    finally{if(current())state.historyLoading=false}
  }
  function enqueue(owner:string,action:()=>Promise<void>){
    const next=writes.catch(()=>{}).then(async()=>{if(owner===state.owner)await action()})
    writes=next.catch(()=>{})
    return next
  }
  async function recordSearch(query:string,source:string){
    const term=query.trim().slice(0,200)
    if(!state.owner||!term)return
    const owner=state.owner,epoch=historyEpoch
    try{await enqueue(owner,async()=>{await api.recordSearch(term,source);if(owner===state.owner&&epoch===historyEpoch)await loadSearches()})}
    catch{if(owner===state.owner&&epoch===historyEpoch)state.historyError='搜索成功后，最近搜索未能保存。'}
  }
  async function clearSearches(){
    if(!state.owner)return
    const owner=state.owner,epoch=++historyEpoch;historyGeneration++
    state.historyLoading=true;state.historyError=''
    try{await enqueue(owner,async()=>{await api.clearSearchHistory();if(owner===state.owner&&epoch===historyEpoch)state.searches=[]})}
    catch{if(owner===state.owner&&epoch===historyEpoch)state.historyError='最近搜索未能清空，请重试。'}
    finally{if(owner===state.owner&&epoch===historyEpoch)state.historyLoading=false}
  }
  return {state,setOwner,loadRecommendations,loadSearches,recordSearch,clearSearches}
}
