<script setup lang="ts">
import { artworkURL } from '../artwork'
import { computed } from 'vue'
import { useMusic } from '../stores/music'
import { useOverlay } from '../stores/overlay'
import Icon from './Icon.vue'
import MediaSourceBadge from './MediaSourceBadge.vue'
const music=useMusic(),overlay=useOverlay(),p=music.player
const current=computed(()=>p.currentTrack)
const time=(ms:number)=>{const s=Math.floor((ms||0)/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
const seek=(event:Event)=>p.seek(Number((event.target as HTMLInputElement).value))
</script>
<template>
 <footer class="player-dock" :class="{'is-loading':p.state.loading}" aria-label="全局播放器">
  <div v-if="current" class="dock-progress"><input aria-label="播放进度" type="range" min="0" :max="Math.max(p.state.durationMs,1)" :value="p.state.positionMs" @change="seek"/><span :style="{width:`${100*p.state.positionMs/Math.max(p.state.durationMs,1)}%`}"/></div>
  <div class="dock-track" v-if="current"><RouterLink to="/play"><img :src="artworkURL(current.picture)" alt="当前专辑" @error="($event.target as HTMLImageElement).src='/music-cover.svg'"/></RouterLink><RouterLink class="dock-track-name" to="/play"><strong>{{current.title}}</strong><span>{{current.artist}}</span><MediaSourceBadge compact :info="p.state.sourceInfo" :trackID="current.id" :loading="p.state.loading"/></RouterLink><button class="icon-button dock-like" :class="{liked:music.likedIDs.has(current.id)}" :aria-label="music.likeState.pending.includes(current.id)?'正在保存喜欢':'喜欢当前歌曲'" :disabled="music.likeState.pending.includes(current.id)" :aria-busy="music.likeState.pending.includes(current.id)" :title="music.likeState.errors[current.id]" :aria-pressed="music.likedIDs.has(current.id)" @click="music.toggleLike(current)"><Icon name="heart"/></button></div>
  <div v-else class="dock-empty"><Icon name="music"/><span>让下一首，成为喜欢。</span></div>
  <div class="dock-controls"><button class="icon-button shuffle-button" :aria-label="p.state.shuffle?'关闭随机播放':'开启随机播放'" :aria-pressed="p.state.shuffle" :title="p.state.shuffle?'随机播放已开启':'随机播放已关闭'" @click="p.setShuffle(!p.state.shuffle)"><Icon name="shuffle" :size="18"/><span>随机</span></button><button class="icon-button" aria-label="上一首" :disabled="!current" @click="p.previous()"><Icon name="previous"/></button><button class="play-button" :aria-label="p.state.playing?'暂停':'播放'" :disabled="!current || p.state.loading" @click="p.toggle()"><Icon :key="p.state.playing?'pause':'play'" :name="p.state.playing?'pause':'play'" :size="22"/></button><button class="icon-button" aria-label="下一首" :disabled="!current" @click="p.next()"><Icon name="next"/></button><span class="dock-time">{{time(p.state.positionMs)}} <i>/ {{time(p.state.durationMs)}}</i></span></div>
  <div class="dock-extras"><button class="icon-button" aria-label="打开歌词" :disabled="!current" @click="overlay.lyrics=true"><Icon name="lyrics"/></button><RouterLink class="icon-button" to="/queue" aria-label="待播队列"><Icon name="queue"/></RouterLink><button class="icon-button repeat-button" :class="{active:p.state.repeat!=='off'}" :aria-label="p.state.repeat==='off'?'开启队列循环':p.state.repeat==='all'?'切换为单曲循环':'关闭循环'" @click="p.setRepeat(p.state.repeat==='off'?'all':p.state.repeat==='all'?'one':'off')"><Icon name="repeat"/><small v-if="p.state.repeat==='one'">1</small></button><label class="volume-control"><Icon name="volume" :size="18"/><input aria-label="音量" type="range" min="0" max="1" step="0.01" :value="p.state.volume" @input="p.setVolume(Number(($event.target as HTMLInputElement).value))"/></label></div>
 </footer>
</template>

<style scoped>
.dock-track-name{gap:.2rem}.dock-track-name :deep(.media-source-label){font-size:.8125rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.shuffle-button{display:flex;align-items:center;justify-content:center;gap:.35rem;min-width:4.5rem;min-height:2.75rem;width:auto;padding:.35rem .5rem;border-radius:.625rem;font-size:.875rem;line-height:1.2}.shuffle-button[aria-pressed=true]{color:var(--green);background:var(--selected)}.repeat-button{position:relative}.repeat-button small{position:absolute;font-size:.65rem;right:.35rem;bottom:.2rem}
@media(max-width:760px){.player-dock .dock-controls .shuffle-button{flex-direction:column;gap:0;padding:.15rem;min-width:44px;width:auto;height:auto;min-height:44px;font-size:.875rem}.shuffle-button span{white-space:nowrap}.shuffle-button svg{width:16px;height:16px}}
</style>
