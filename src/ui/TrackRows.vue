<script setup lang="ts">
import { artworkURL } from '../artwork'
import type { Track } from '../core'
import { useMusic } from '../stores/music'
import Icon from './Icon.vue'
const props=withDefaults(defineProps<{tracks:Track[];editable?:boolean;queue?:boolean;notes?:Record<string,string>;selecting?:boolean;selection?:string[];disabled?:boolean}>(),{editable:false,queue:false,selecting:false,selection:()=>[],disabled:false})
const emit=defineEmits<{play:[index:number];add:[track:Track];share:[track:Track];remove:[index:number];move:[from:number,to:number];select:[track:Track]}>()
const music=useMusic()
function sourceName(source:string){return source==='netease'?'网易云':source==='kuwo'?'酷我':source==='legacy'?'旧卡片':source}
function time(ms:number){const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
</script>
<template>
 <div class="track-table" role="list">
  <div v-for="(track,index) in props.tracks" :key="`${track.id}:${index}`" class="track-row" :class="{current:music.player.currentTrack?.id===track.id,selectable:selecting,'is-selected':selecting&&selection.includes(track.id)}" :data-track-id="track.id" role="listitem">
   <label v-if="selecting" class="track-check"><input type="checkbox" :checked="selection.includes(track.id)" :disabled="disabled" :aria-label="`选择 ${track.title}（${sourceName(track.source)}）`" @change="emit('select',track)"/></label>
   <button class="track-play" :disabled="disabled" :aria-label="`播放 ${track.title}`" @click="emit('play',index)"><span>{{String(index+1).padStart(2,'0')}}</span><Icon name="play" :size="15"/></button>
   <img class="track-cover" :src="artworkURL(track.picture)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src='/music-cover.svg'"/>
   <button class="track-info" :disabled="disabled" :aria-label="selecting?`切换选择 ${track.title}`:undefined" @click="selecting?emit('select',track):emit('play',index)"><strong>{{track.title}}</strong><span><b class="track-source">{{sourceName(track.source)}}</b> {{track.artist || '未知歌手'}} <i v-if="track.album">· {{track.album}}</i></span><small v-if="notes?.[track.id]" class="track-reason">{{notes[track.id]}}</small></button>
   <span class="track-duration">{{time(track.durationMs)}}</span>
   <div v-if="!selecting" class="track-actions" :inert="disabled||undefined">
    <button :class="{liked:music.likedIDs.has(track.id)}" :aria-label="`喜欢 ${track.title}`" :aria-pressed="music.likedIDs.has(track.id)" @click="music.toggleLike(track)"><Icon name="heart" :size="18"/></button>
    <button :aria-label="`加入队列 ${track.title}`" title="加入队列" @click="music.player.enqueue(track);music.notify('已加入待播队列')"><Icon name="queue" :size="18"/></button>
    <button :aria-label="`加入歌单 ${track.title}`" title="加入歌单" @click="emit('add',track)"><Icon name="plus" :size="18"/></button>
    <button :aria-label="`分享 ${track.title}`" title="分享歌曲" @click="emit('share',track)"><Icon name="share" :size="18"/></button>
    <template v-if="editable"><button aria-label="上移" :disabled="index===0" @click="emit('move',index,index-1)"><Icon name="up" :size="17"/></button><button aria-label="下移" :disabled="index===tracks.length-1" @click="emit('move',index,index+1)"><Icon name="down" :size="17"/></button><button aria-label="移除" @click="emit('remove',index)"><Icon name="close" :size="17"/></button></template>
   </div>
  </div>
 </div>
</template>

<style scoped>
.track-check{display:flex;align-items:center;justify-content:center;flex:0 0 2.75rem;min-height:2.75rem;cursor:pointer}.track-check input{width:1.15rem;height:1.15rem;accent-color:#526f42;cursor:pointer}.track-check:has(input:focus-visible){outline:2px solid #6d864d;outline-offset:2px;border-radius:6px}.track-row.is-selected{background:#e7eedc;border-radius:8px}.track-row.selectable .track-info{min-width:0}.track-row.selectable .track-info strong,.track-row.selectable .track-info>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}.track-row.selectable .track-info{min-height:2.75rem}.track-row.selectable{padding-inline:.3rem}
@media(max-width:760px){.track-row.selectable{display:grid;grid-template-columns:2.75rem 2.75rem minmax(0,1fr);gap:.5rem;min-height:4.5rem}.track-row.selectable .track-info{width:100%;min-width:0}.track-row.selectable .track-check{grid-column:1}.track-row.selectable .track-cover{grid-column:2}.track-row.selectable .track-info{grid-column:3}}
.track-source{font-size:.65rem;letter-spacing:.02em;font-weight:600;color:#73844d;border:1px solid #dbe3c9;border-radius:4px;padding:1px 4px;margin-right:4px;white-space:nowrap}
.track-reason{display:block;max-width:100%;font-size:.65rem;line-height:1.6;color:#80916c;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:3px}
</style>
