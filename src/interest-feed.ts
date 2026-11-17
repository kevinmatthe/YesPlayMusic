import { reactive } from 'vue'
import {RequestDeadline,withWriteDeadline} from './request-deadline'
import type { MusicApi, Recommendation, SearchRecord, Track } from './core'

const basisLabels={likes:'来自你的喜欢',history:'根据最近播放',search:'根据主动搜索',discovery:'公开曲库发现'}
export function recommendationNote(item:Recommendation):string {
  const basis=basisLabels[item.basis]||basisLabels.discovery
  return item.reason?`${basis} · ${item.reason}`:basis
}

/** All memory and queued writes belong to the current verified server session. */
export function createInterestFeed(api:Pick<MusicApi,'recommendations'|'searchHistory'|'recordSearch'|'clearSearchHistory'>,_legacyFallback?:()=>Promise<Track[]>){
  const state=reactive({owner:'',items:[] as Recommendation[],personalized:false,loading:false,error:'',searches:[] as SearchRecord[],historyLoading:false,historyError:'',loaded:false,notice:''})
  let recommendationGeneration=0,historyGeneration=0,historyEpoch=0,ownerEpoch=0,writes=Promise.resolve(),loadedAt=0,historyLoadedAt=0,disposed=false,refreshCount=0
  let recommendationsPending:Promise<void>|undefined,historyPending:Promise<void>|undefined,recommendationAbort:AbortController|undefined,historyAbort:AbortController|undefined
  let clearing=false
  function cancelRecommendations(){recommendationGeneration++;recommendationAbort?.abort();recommendationsPending=undefined;state.loading=false}
  function cancelSearches(){historyGeneration++;historyAbort?.abort();historyPending=undefined;state.historyLoading=false}
  function setOwner(owner:string){
    if(state.owner===owner)return
    cancelRecommendations();cancelSearches();historyEpoch++;ownerEpoch++;writes=Promise.resolve();clearing=false
    state.owner=owner;state.items=[];state.personalized=false;state.error='';state.notice='';state.loaded=false;loadedAt=0;historyLoadedAt=0
    state.searches=[];state.historyError=''
  }
  function dispose(){setOwner('');disposed=true}
  function loadRecommendations({refresh=false}:{refresh?:boolean}={}):Promise<void>{
    if(!state.owner||disposed)return Promise.resolve()
    if(recommendationsPending)return recommendationsPending
    if(!refresh&&state.loaded&&Date.now()-loadedAt<120000)return Promise.resolve()
    const owner=state.owner,generation=++recommendationGeneration,current=()=>!disposed&&owner===state.owner&&generation===recommendationGeneration
    const controller=new AbortController();recommendationAbort=controller
    const timer=setTimeout(()=>controller.abort(new Error('请求超时')),20000)
    state.loading=true;state.error='';state.notice=''
    const options=refresh?{refresh:`web-${Date.now().toString(36)}-${++refreshCount}`,exclude:state.items.map(i=>i.track.id)}:undefined
    recommendationsPending=(async()=>{
      try{
        const result=await api.recommendations(12,controller.signal,options)
        if(!current())return
        const seen=new Set<string>(),items=result.tracks.filter(item=>!seen.has(item.track.id)&&Boolean(seen.add(item.track.id)))
        if(refresh&&!items.length&&state.items.length){state.notice='暂时没有更多合适的歌曲，保留这一批，稍后再试。';return}
        state.items=items
        state.personalized=result.personalized&&items.some(item=>item.basis!=='discovery')
        state.loaded=true;loadedAt=Date.now()
      }catch{
        if(current())state.error=state.items.length?'这次推荐未能刷新，已保留上次内容。请重试。':'推荐暂时无法载入，请重试或先搜索歌曲。'
      }finally{
        clearTimeout(timer)
        if(current()){state.loading=false;recommendationsPending=undefined}
      }
    })()
    return recommendationsPending
  }
  function loadSearches({refresh=false}:{refresh?:boolean}={}):Promise<void>{
    if(!state.owner||disposed||clearing)return Promise.resolve()
    if(historyPending)return historyPending
    if(!refresh&&historyLoadedAt&&Date.now()-historyLoadedAt<120000)return Promise.resolve()
    const owner=state.owner,generation=++historyGeneration,epoch=historyEpoch,current=()=>!disposed&&owner===state.owner&&generation===historyGeneration&&epoch===historyEpoch
    const controller=new AbortController();historyAbort=controller
    const timer=setTimeout(()=>controller.abort(new Error('请求超时')),15000)
    state.historyLoading=true;state.historyError=''
    historyPending=(async()=>{
      try{const result=await api.searchHistory(20,controller.signal);if(current()){state.searches=result.searches;historyLoadedAt=Date.now()}}
      catch{if(current())state.historyError='最近搜索暂时无法载入，请重试。'}
      finally{clearTimeout(timer);if(current()){state.historyLoading=false;historyPending=undefined}}
    })()
    return historyPending
  }
  function enqueue(owner:string,epoch:number,action:()=>Promise<void>){
    const next=writes.catch(()=>{}).then(async()=>{if(!disposed&&owner===state.owner&&epoch===ownerEpoch)await action()})
    writes=next.catch(()=>{})
    return next
  }
  async function recordSearch(query:string,source:string){
    const term=query.trim().slice(0,200)
    if(!state.owner||!term||disposed)return
    const owner=state.owner,epoch=historyEpoch,identity=ownerEpoch
    try{await enqueue(owner,identity,async()=>{await withWriteDeadline(signal=>api.recordSearch(term,source,signal));if(owner===state.owner&&epoch===historyEpoch&&identity===ownerEpoch){cancelSearches();await loadSearches({refresh:true})}})}
    catch(error){if(owner===state.owner&&epoch===historyEpoch&&identity===ownerEpoch)state.historyError=error instanceof RequestDeadline?'搜索已完成，最近搜索保存结果未能确认。可重新读取记录。':'搜索已完成，最近搜索未能保存。'}
  }
  async function clearSearches(){
    if(!state.owner||disposed||clearing)return
    const owner=state.owner,epoch=++historyEpoch,identity=ownerEpoch;cancelSearches();clearing=true
    state.historyLoading=true;state.historyError=''
    try{await enqueue(owner,identity,async()=>{await withWriteDeadline(signal=>api.clearSearchHistory(signal));if(owner===state.owner&&epoch===historyEpoch&&identity===ownerEpoch){cancelSearches();state.searches=[];historyLoadedAt=Date.now()}})}
    catch(error){if(owner===state.owner&&epoch===historyEpoch&&identity===ownerEpoch)state.historyError=error instanceof RequestDeadline?'清空结果未能确认，可重试或重新读取记录。':'最近搜索未能清空，请重试。'}
    finally{if(owner===state.owner&&epoch===historyEpoch&&identity===ownerEpoch){clearing=false;state.historyLoading=false}}
  }
  return {state,setOwner,dispose,cancelRecommendations,cancelSearches,loadRecommendations,loadSearches,recordSearch,clearSearches}
}
