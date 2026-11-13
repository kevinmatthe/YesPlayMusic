<script setup lang="ts">
import { artworkURL } from '../artwork'
import type { Track } from '../core'
import { useMusic } from '../stores/music'
import Icon from './Icon.vue'
const props=withDefaults(defineProps<{tracks:Track[];editable?:boolean;queue?:boolean}>(),{editable:false,queue:false})
const emit=defineEmits<{play:[index:number];add:[track:Track];share:[track:Track];remove:[index:number];move:[from:number,to:number]}>()
const music=useMusic()
function time(ms:number){const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
</script>
<template>
 <div class="track-table" role="list">
  <div v-for="(track,index) in props.tracks" :key="`${track.id}:${index}`" class="track-row" :class="{current:music.player.currentTrack?.id===track.id}" :data-track-id="track.id" role="listitem">
   <button class="track-play" :aria-label="`播放 ${track.title}`" @click="emit('play',index)"><span>{{String(index+1).padStart(2,'0')}}</span><Icon name="play" :size="15"/></button>
   <img class="track-cover" :src="artworkURL(track.picture)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src='/music-cover.svg'"/>
   <button class="track-info" @click="emit('play',index)"><strong>{{track.title}}</strong><span>{{track.artist || '未知歌手'}} <i v-if="track.album">· {{track.album}}</i></span></button>
   <span class="track-duration">{{time(track.durationMs)}}</span>
   <div class="track-actions">
    <button :class="{liked:music.likedIDs.has(track.id)}" :aria-label="`喜欢 ${track.title}`" :aria-pressed="music.likedIDs.has(track.id)" @click="music.toggleLike(track)"><Icon name="heart" :size="18"/></button>
    <button :aria-label="`加入队列 ${track.title}`" title="加入队列" @click="music.player.enqueue(track);music.notify('已加入待播队列')"><Icon name="queue" :size="18"/></button>
    <button :aria-label="`加入歌单 ${track.title}`" title="加入歌单" @click="emit('add',track)"><Icon name="plus" :size="18"/></button>
    <button :aria-label="`分享 ${track.title}`" title="分享歌曲" @click="emit('share',track)"><Icon name="share" :size="18"/></button>
    <template v-if="editable"><button aria-label="上移" :disabled="index===0" @click="emit('move',index,index-1)"><Icon name="up" :size="17"/></button><button aria-label="下移" :disabled="index===tracks.length-1" @click="emit('move',index,index+1)"><Icon name="down" :size="17"/></button><button aria-label="移除" @click="emit('remove',index)"><Icon name="close" :size="17"/></button></template>
   </div>
  </div>
 </div>
</template>
