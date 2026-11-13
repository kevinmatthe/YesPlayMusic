<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMusic } from './stores/music'
import { useOverlay } from './stores/overlay'
import { musicApi } from './core'
import Icon from './ui/Icon.vue'
import PlayerBar from './ui/PlayerBar.vue'
import Dialogs from './ui/Dialogs.vue'
import LyricsPanel from './ui/LyricsPanel.vue'
const music=useMusic(),overlay=useOverlay(),route=useRoute(),router=useRouter()
const navigation=[{path:'/library',name:'我的音乐',icon:'library'},{path:'/search',name:'发现歌曲',icon:'search'},{path:'/likes',name:'喜欢的歌',icon:'heart'},{path:'/history',name:'最近播放',icon:'history'},{path:'/queue',name:'待播队列',icon:'queue'}]
const title=computed(()=>route.path.startsWith('/share/')?'分享音乐':navigation.find(n=>n.path===route.path)?.name || (route.path==='/shares'?'分享管理':'正在播放'))
function select(id:string){music.selectedID=id;router.push('/library')}
function reload(){location.reload()}
function keydown(e:KeyboardEvent){if(e.key==='Escape'){overlay.close();overlay.lyrics=false;return}if(e.code==='Space'&&!['INPUT','TEXTAREA','BUTTON','SELECT'].includes((e.target as HTMLElement)?.tagName)){e.preventDefault();music.player.toggle()}}
onMounted(async()=>{music.player.audio.hidden=true;music.player.audio.dataset.testid='global-audio';document.body.appendChild(music.player.audio);window.addEventListener('keydown',keydown);await music.initialize();const params=new URLSearchParams(location.search);if(params.has('target'))await music.run(()=>music.player.loadLegacy(params.get('target')!));else if(params.has('trackID'))await music.run(async()=>music.player.playTracks(await musicApi.details([params.get('trackID')!])));if(params.has('target')||params.has('trackID')){const next=new URL(location.href);['target','trackID','source'].forEach(k=>next.searchParams.delete(k));history.replaceState({},'',next.pathname+next.search+next.hash)}})
onBeforeUnmount(()=>{window.removeEventListener('keydown',keydown);music.player.dispose();music.player.audio.remove()})
</script>
<template>
 <div class="app-shell">
  <aside class="sidebar"><RouterLink class="brand" to="/library" @click="music.selectedID=''"><span class="brand-mark"><Icon name="music" :size="23"/></span><span>BetaGo<small>MUSIC / YOUR OWN RHYTHM</small></span></RouterLink><nav class="main-nav" aria-label="音乐导航"><RouterLink v-for="n in navigation" :key="n.path" :to="n.path" @click="n.path==='/library'&&(music.selectedID='')"><Icon :name="n.icon"/><span>{{n.name}}</span><small v-if="n.path==='/queue'">{{music.player.state.tracks.length}}</small></RouterLink></nav><div class="sidebar-label"><span>我的歌单</span><button class="icon-button" aria-label="新建歌单" @click="overlay.create()"><Icon name="plus" :size="17"/></button></div><div class="sidebar-playlists"><button v-for="p in music.playlists" :key="p.id" :class="{active:music.selectedID===p.id&&route.path==='/library'}" @click="select(p.id)"><Icon name="music" :size="16"/><span>{{p.name}}</span><small>{{p.tracks.length}}</small></button><p v-if="!music.playlists.length">从一张自己的歌单开始。</p></div><div class="sidebar-bottom"><RouterLink to="/shares"><Icon name="share" :size="16"/> 分享管理</RouterLink><button @click="overlay.kind='transfer'"><span class="session-dot"/>{{music.userKind==='feishu'?'飞书个人空间':'访客空间'}}<Icon name="backup" :size="15"/></button><p>只属于你，随时带走。</p></div></aside>
  <div class="app-body"><header class="topbar"><div class="mobile-brand"><Icon name="music"/> BetaGo</div><span class="breadcrumb">BetaGo <i>/</i> {{title}}</span><div class="top-actions"><RouterLink to="/play" class="listening-link" :class="{listening:music.player.state.playing}"><span class="listening-bars"><i/><i/><i/></span><span>{{music.player.state.playing?'正在聆听':'播放器'}}</span></RouterLink><button class="subtle" @click="overlay.kind='transfer'"><Icon name="backup" :size="16"/><span>备份与恢复</span></button></div></header><main id="main"><div v-if="!music.ready" class="loading-space"><span class="loading-disc"/><p>正在打开你的音乐空间…</p></div><template v-else><div v-if="music.error && !overlay.kind" class="notice error" role="alert"><span>{{music.error}}</span><button @click="reload">重新载入</button></div><RouterView/></template></main><footer class="page-footer"><span>BetaGo Music <i>·</i> 你的音乐，自己收藏。</span><span>独立音乐空间 / 匿名曲库</span></footer></div>
  <div v-if="music.player.state.status" class="playback-notice" role="status"><span>{{music.player.state.status}}</span><button v-if="music.player.state.queueConflict" @click="music.player.reloadQueue()">重新载入队列</button><button v-else-if="!music.player.state.playing&&!music.player.state.loading&&music.player.currentTrack" @click="music.player.retry()">重试当前歌曲</button></div>
  <PlayerBar/><nav class="mobile-nav" aria-label="移动导航"><RouterLink to="/library" @click="music.selectedID=''"><Icon name="library"/><span>音乐库</span></RouterLink><RouterLink to="/search"><Icon name="search"/><span>发现</span></RouterLink><RouterLink to="/likes"><Icon name="heart"/><span>喜欢</span></RouterLink><RouterLink to="/queue"><Icon name="queue"/><span>队列</span></RouterLink></nav><div v-if="music.toast" class="toast" role="status"><Icon name="check" :size="17"/>{{music.toast}}</div><Dialogs/><LyricsPanel/>
 </div>
</template>
