import { computed, markRaw, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createPlayer, musicApi } from '../core'
import type { Playlist, Track, HistoryItem, Share, ExportData, Session } from '../core'
import { initializeIdentity, browserIdentityHost, IdentityNavigation } from '../identity'
import { createInterestFeed } from '../interest-feed'
import { createLikeActions } from '../like-actions'
import { deviceAudioCache, MusicApiError } from '../core/api'
import { editPlaylistBatch } from '../playlist-batch'

export const useMusic = defineStore('music', () => {
  const player=markRaw(createPlayer())
  const unbindCache=player.audio?deviceAudioCache.bindAudio(player.audio):()=>{}
  let unsubscribeCache=()=>{}
  const originalDispose=player.dispose.bind(player)
  let disposed=false,identityEpoch=0
  const disposePlayer=()=>{if(disposed)return;disposed=true;interests.dispose();likeActions.setOwner('');unbindCache();unsubscribeCache();clearTimeout(toastTimer);originalDispose()}
  if(player.audio)player.dispose=disposePlayer
  onScopeDispose(disposePlayer)
  let playlistVersion=0, playlistRefresh=0
  const library=ref<{playlistAdd?:boolean;neteasePlaylistSync?:boolean}>({})
  const syncing=ref(new Set<string>())
  const playlists=ref<Playlist[]>([]), likes=ref<Track[]>([]), history=ref<HistoryItem[]>([]), shares=ref<Share[]>([])
  const ready=ref(false), busy=ref(false), error=ref(''), toast=ref(''), userKind=ref('guest')
  const user=ref<Session['user']>()
  const interests=markRaw(createInterestFeed(musicApi))
  const likeActions=markRaw(createLikeActions(musicApi,()=>likes.value,next=>likes.value=next)),likeState=likeActions.state
  watch(()=>user.value?.id||'',id=>{identityEpoch++;interests.setOwner(id);likeActions.setOwner(id)},{flush:'sync'})
  const feishuEnabled=ref(false),feishuAppID=ref(''),inFeishu=ref(false),identityMessage=ref('')
  const selectedID=ref(''), selected=computed(()=>playlists.value.find(p=>p.id===selectedID.value))
  const editablePlaylists=computed(()=>playlists.value.filter(p=>p.kind!=='sync'))
  const likedIDs=computed(()=>new Set(likes.value.map(t=>t.id)))
  let toastTimer:ReturnType<typeof setTimeout>|undefined
  function notify(message:string){toast.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',3200)}
  let cacheState=''
  unsubscribeCache=deviceAudioCache.subscribe(next=>{if(next.state==='downloading'&&cacheState!=='downloading')notify('正在后台保存本机缓存，播放不受影响。');else if(cacheState==='downloading'&&next.state!=='downloading')notify(next.message);cacheState=next.state})
  async function run<T>(fn:()=>Promise<T>):Promise<T|undefined>{const identity=identityEpoch;error.value='';try{return await fn()}catch(e){if(e instanceof IdentityNavigation)throw e;if(!disposed&&identity===identityEpoch)error.value=e instanceof Error?e.message:String(e);return undefined}}
  async function refresh(){await run(async()=>{
    const likesBefore=likes.value,likedBefore=likes.value.map(t=>t.id).join('\n'),likeVersion=likeState.revision,identity=identityEpoch
    const version=playlistVersion,request=++playlistRefresh
    const [p,l,h,m]=await Promise.all([musicApi.listPlaylists(),musicApi.likes(),musicApi.history(),musicApi.me()])
    if(disposed||identity!==identityEpoch)return
    if(request===playlistRefresh){
      if(version===playlistVersion)playlists.value=p
      else{
        const retryVersion=playlistVersion
        const latest=await musicApi.listPlaylists()
        if(disposed||identity!==identityEpoch)return
        if(request===playlistRefresh&&retryVersion===playlistVersion)playlists.value=latest
      }
    }
    if(likeVersion===likeState.revision&&likesBefore===likes.value&&likedBefore===likes.value.map(t=>t.id).join('\n'))likes.value=l
    history.value=h;userKind.value=m.user.kind;user.value=m.user
  })}
  function acceptPlaylist(p:Playlist, mode:'created'|'updated'|'read'='updated'){
    const index=playlists.value.findIndex(v=>v.id===p.id)
    if(index<0){
      if(mode!=='created')return
      playlists.value.push(p)
    }else{
      if(playlists.value[index]!.revision>p.revision)return
      playlists.value[index]=p
    }
    if(mode!=='read')playlistVersion++
  }
  async function refreshSyncPlaylist(id:string){
    const identity=identityEpoch,version=playlistVersion
    try{
      const next=await musicApi.getPlaylist(id)
      if(!disposed&&identity===identityEpoch&&version===playlistVersion)acceptPlaylist(next,'read')
    }catch(e){
      if(e instanceof MusicApiError&&e.status===404&&!disposed&&identity===identityEpoch&&version===playlistVersion){
        playlists.value=playlists.value.filter(p=>p.id!==id)
        if(selectedID.value===id)selectedID.value=''
        playlistVersion++
      }
    }
  }
  async function initialize(){
    ready.value=false;error.value=''
    try{
      const host=browserIdentityHost();inFeishu.value=host.isFeishu
      const result=await initializeIdentity(musicApi,host)
      library.value=result.options.library||{}
      feishuEnabled.value=result.options.feishu.enabled;feishuAppID.value=result.options.feishu.appID
      identityMessage.value=result.message;userKind.value=result.session.user.kind;user.value=result.session.user
      await Promise.all([player.initialize(),refresh()])
      const notice=sessionStorage.getItem('betago:auth-notice')
      if(notice){sessionStorage.removeItem('betago:auth-notice');error.value=notice}
      ready.value=true;return true
    }catch(e){
      if(e instanceof IdentityNavigation)return false
      error.value=e instanceof Error?e.message:String(e);ready.value=true;return false
    }
  }
  async function changeSession(action:()=>Promise<unknown>){player.pause();await player.saveQueue();player.dispose();try{await action()}catch(e){sessionStorage.setItem('betago:auth-notice',e instanceof Error?e.message:String(e))}finally{location.assign('/library')}}
  async function connectFeishu(){
    if(!feishuEnabled.value||!inFeishu.value)return
    try{await run(async()=>{
      const current=await musicApi.me()
      if(current.user.kind!=='guest'){await refresh();return}
      player.pause();await player.saveQueue()
      const navigation=browserIdentityHost().navigation
      if(!navigation)throw new Error('无法打开身份验证页面，请重新载入后重试。')
      navigation.beginConnect(feishuAppID.value,current.user.id)
    })}catch(e){if(!(e instanceof IdentityNavigation))throw e}
  }
  async function refreshFeishuProfile(){
    if(!feishuEnabled.value||!inFeishu.value||userKind.value!=='feishu')return
    try{await run(async()=>{
      const current=await musicApi.me()
      if(current.user.kind!=='feishu')throw new Error('当前身份已变化，请重新载入。')
      player.pause();await player.saveQueue()
      const navigation=browserIdentityHost().navigation
      if(!navigation)throw new Error('无法打开资料更新入口，请重新载入后重试。')
      navigation.beginProfile(feishuAppID.value,current.user.id,true)
    })}catch(e){if(!(e instanceof IdentityNavigation))throw e}
  }
  async function create(name:string,trackIDs:string[]=[]){return run(async()=>{
    const identity=identityEpoch
    const p=await musicApi.createPlaylist(name,trackIDs)
    if(disposed||identity!==identityEpoch)return
    acceptPlaylist(p,'created');selectedID.value=p.id;notify('歌单已创建');return p
  })}
  async function createSync(url:string){return run(async()=>{
    if(library.value.neteasePlaylistSync!==true)return
    const identity=identityEpoch
    const p=await musicApi.createSyncPlaylist(url)
    if(disposed||identity!==identityEpoch)return
    acceptPlaylist(p,'created');selectedID.value=p.id;notify('同步歌单已创建');return p
  })}
  async function sync(p:Playlist){
    const identity=identityEpoch
    if(library.value.neteasePlaylistSync!==true||p.kind!=='sync'||syncing.value.has(p.id))return
    syncing.value.add(p.id)
    try{
      return await run(async()=>{
        const next=await musicApi.syncPlaylist(p.id)
        if(disposed||identity!==identityEpoch)return
        acceptPlaylist(next);notify('歌单已同步');return next
      })
    }finally{
      if(!disposed&&identity===identityEpoch)await refreshSyncPlaylist(p.id)
      syncing.value.delete(p.id)
    }
  }
  async function update(p:Playlist,trackIDs:string[],name=p.name){return run(async()=>{
    if(p.kind==='sync')return
    const identity=identityEpoch
    const next=await musicApi.updatePlaylist(p,trackIDs,name)
    if(disposed||identity!==identityEpoch)return
    acceptPlaylist(next);return next
  })}
  async function remove(p:Playlist){return run(async()=>{
    const identity=identityEpoch
    try{await musicApi.deletePlaylist(p)}catch(e){
      if(p.kind==='sync'&&identity===identityEpoch)await refreshSyncPlaylist(p.id)
      throw e
    }
    if(disposed||identity!==identityEpoch)return
    playlists.value=playlists.value.filter(item=>item.id!==p.id)
    playlistVersion++
    if(selectedID.value===p.id)selectedID.value=''
    notify('歌单已删除')
  })}
  async function toggleLike(track:Track){await likeActions.toggle(track);const problem=likeState.errors[track.id];if(problem)notify(problem)}
  async function editTracks(targetID:string,tracks:Track[],action:'add'|'remove'){
    const identity=identityEpoch
    const result=await editPlaylistBatch(musicApi,targetID,tracks,action,library.value.playlistAdd===true)
    if(disposed||identity!==identityEpoch)return
    if(result.playlist&&playlists.value.some(p=>p.id===targetID))acceptPlaylist(result.playlist)
    return result
  }
  async function add(p:Playlist,track:Track){return run(async()=>{
    if(p.kind==='sync')return
    const result=await editTracks(p.id,[track],'add')
    if(!result)return
    if(result.failed.length)throw new Error(result.error||'加入歌单失败，请稍后重试。')
    notify(result.skipped.length?'歌单中已有这首歌':'已加入歌单')
    return result.playlist
  })}
  async function loadHistory(){const identity=identityEpoch;await run(async()=>{const result=await musicApi.history();if(!disposed&&identity===identityEpoch)history.value=result})}
  async function clearHistory(){await run(async()=>{await musicApi.clearHistory();history.value=[];notify('历史已清空')})}
  async function loadShares(){const identity=identityEpoch;await run(async()=>{const result=await musicApi.shares();if(!disposed&&identity===identityEpoch)shares.value=result})}
  async function revoke(id:string){await run(async()=>{await musicApi.revokeShare(id);await loadShares();notify('分享已撤销')})}
  async function importData(data:ExportData){await run(async()=>{await musicApi.importData(data);await refresh();notify('已复制到当前音乐空间')})}
  return {player,playlists,editablePlaylists,library,syncing,likes,likeState,history,shares,ready,busy,error,toast,userKind,user,interests,feishuEnabled,inFeishu,identityMessage,selectedID,selected,likedIDs,run,notify,refresh,initialize,changeSession,connectFeishu,refreshFeishuProfile,create,createSync,sync,refreshSyncPlaylist,editTracks,update,remove,toggleLike,add,loadHistory,clearHistory,loadShares,revoke,importData}
})
