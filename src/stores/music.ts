import { computed, markRaw, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { createPlayer, musicApi } from '../core'
import type { Playlist, Track, HistoryItem, Share, ExportData, Session } from '../core'
import { initializeIdentity, browserIdentityHost, IdentityNavigation } from '../identity'
import { createInterestFeed } from '../interest-feed'
import { loadDiscovery } from '../discovery'
import { deviceAudioCache } from '../core/api'

export const useMusic = defineStore('music', () => {
  const player=markRaw(createPlayer())
  const unbindCache=player.audio?deviceAudioCache.bindAudio(player.audio):()=>{}
  let unsubscribeCache=()=>{}
  const originalDispose=player.dispose.bind(player)
  let disposed=false
  const disposePlayer=()=>{if(disposed)return;disposed=true;unbindCache();unsubscribeCache();clearTimeout(toastTimer);originalDispose()}
  if(player.audio)player.dispose=disposePlayer
  onScopeDispose(disposePlayer)
  const playlists=ref<Playlist[]>([]), likes=ref<Track[]>([]), history=ref<HistoryItem[]>([]), shares=ref<Share[]>([])
  const ready=ref(false), busy=ref(false), error=ref(''), toast=ref(''), userKind=ref('guest')
  const user=ref<Session['user']>()
  const interests=markRaw(createInterestFeed(musicApi,()=>loadDiscovery(musicApi)))
  watch(()=>user.value?.id||'',id=>interests.setOwner(id),{flush:'sync'})
  const feishuEnabled=ref(false),feishuAppID=ref(''),inFeishu=ref(false),identityMessage=ref('')
  const selectedID=ref(''), selected=computed(()=>playlists.value.find(p=>p.id===selectedID.value))
  const likedIDs=computed(()=>new Set(likes.value.map(t=>t.id)))
  let toastTimer:ReturnType<typeof setTimeout>|undefined
  function notify(message:string){toast.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',3200)}
  let cacheState=''
  unsubscribeCache=deviceAudioCache.subscribe(next=>{if(next.state==='downloading'&&cacheState!=='downloading')notify('首次准备需要完整下载，稍后即可播放。');cacheState=next.state})
  async function run<T>(fn:()=>Promise<T>):Promise<T|undefined>{error.value='';try{return await fn()}catch(e){if(e instanceof IdentityNavigation)throw e;error.value=e instanceof Error?e.message:String(e);return undefined}}
  async function refresh(){await run(async()=>{const[p,l,h,m]=await Promise.all([musicApi.listPlaylists(),musicApi.likes(),musicApi.history(),musicApi.me()]);playlists.value=p;likes.value=l;history.value=h;userKind.value=m.user.kind;user.value=m.user})}
  async function initialize(){
    ready.value=false;error.value=''
    try{
      const host=browserIdentityHost();inFeishu.value=host.isFeishu
      const result=await initializeIdentity(musicApi,host)
      feishuEnabled.value=result.options.feishu.enabled;feishuAppID.value=result.options.feishu.appID
      identityMessage.value=result.message;userKind.value=result.session.user.kind;user.value=result.session.user
      await player.initialize();await refresh()
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
  async function create(name:string,trackIDs:string[]=[]){return run(async()=>{const p=await musicApi.createPlaylist(name,trackIDs);await refresh();selectedID.value=p.id;notify('歌单已创建');return p})}
  async function update(p:Playlist,trackIDs:string[],name=p.name){return run(async()=>{const next=await musicApi.updatePlaylist(p,trackIDs,name);const index=playlists.value.findIndex(v=>v.id===p.id);if(index>=0)playlists.value[index]=next;return next})}
  async function remove(p:Playlist){return run(async()=>{await musicApi.deletePlaylist(p);if(selectedID.value===p.id)selectedID.value='';await refresh();notify('歌单已删除')})}
  async function toggleLike(track:Track){await run(async()=>{await musicApi.setLike(track.id,!likedIDs.value.has(track.id));likes.value=await musicApi.likes()})}
  async function add(p:Playlist,track:Track){const result=await update(p,[...p.tracks.map(t=>t.id),track.id]);if(result)notify('已加入歌单');return result}
  async function loadHistory(){await run(async()=>{history.value=await musicApi.history()})}
  async function clearHistory(){await run(async()=>{await musicApi.clearHistory();history.value=[];notify('历史已清空')})}
  async function loadShares(){await run(async()=>shares.value=await musicApi.shares())}
  async function revoke(id:string){await run(async()=>{await musicApi.revokeShare(id);await loadShares();notify('分享已撤销')})}
  async function importData(data:ExportData){await run(async()=>{await musicApi.importData(data);await refresh();notify('已复制到当前音乐空间')})}
  return {player,playlists,likes,history,shares,ready,busy,error,toast,userKind,user,interests,feishuEnabled,inFeishu,identityMessage,selectedID,selected,likedIDs,run,notify,refresh,initialize,changeSession,connectFeishu,refreshFeishuProfile,create,update,remove,toggleLike,add,loadHistory,clearHistory,loadShares,revoke,importData}
})
