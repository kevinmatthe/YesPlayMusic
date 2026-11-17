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
   <button class="track-artwork" :disabled="disabled" :aria-label="selecting?`切换选择 ${track.title}`:`播放 ${track.title}`" @click="selecting?emit('select',track):emit('play',index)"><img class="track-cover" :src="artworkURL(track.picture)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src='/music-cover.svg'"/><span v-if="!selecting" class="cover-play" aria-hidden="true"><Icon name="play" :size="13"/></span></button>
   <button class="track-info" :disabled="disabled" :aria-label="selecting?`切换选择 ${track.title}`:undefined" @click="selecting?emit('select',track):emit('play',index)"><strong>{{track.title}}</strong><span><b class="track-source">{{sourceName(track.source)}}</b> {{track.artist || '未知歌手'}} <i v-if="track.album">· {{track.album}}</i></span><small v-if="notes?.[track.id]" class="track-reason">{{notes[track.id]}}</small></button>
   <span class="track-duration">{{time(track.durationMs)}}</span>
   <div v-if="!selecting" class="track-actions" :inert="disabled||undefined">
    <button :class="{liked:music.likedIDs.has(track.id)}" :aria-label="`喜欢 ${track.title}`" :aria-pressed="music.likedIDs.has(track.id)" @click="music.toggleLike(track)"><Icon name="heart" :size="18"/><span class="row-action-label">{{music.likedIDs.has(track.id)?'已喜欢':'喜欢'}}</span></button>
    <button :aria-label="`加入队列 ${track.title}`" title="加入队列" @click="music.player.enqueue(track);music.notify('已加入待播队列')"><Icon name="queue" :size="18"/></button>
    <button :aria-label="`加入歌单 ${track.title}`" title="加入歌单" @click="emit('add',track)"><Icon name="plus" :size="18"/><span class="row-action-label">歌单</span></button>
    <button :aria-label="`分享 ${track.title}`" title="分享歌曲" @click="emit('share',track)"><Icon name="share" :size="18"/></button>
    <template v-if="editable"><button aria-label="上移" :disabled="index===0" @click="emit('move',index,index-1)"><Icon name="up" :size="17"/></button><button aria-label="下移" :disabled="index===tracks.length-1" @click="emit('move',index,index+1)"><Icon name="down" :size="17"/></button><button aria-label="移除" @click="emit('remove',index)"><Icon name="close" :size="17"/></button></template>
   </div>
  </div>
 </div>
</template>

<style scoped>
.track-check{display:flex;align-items:center;justify-content:center;flex:0 0 2.75rem;min-height:2.75rem;cursor:pointer}.track-check input{width:1.2rem;height:1.2rem;padding:0;accent-color:var(--green);cursor:pointer}
.track-check:has(input:focus-visible){outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:.5rem}.track-row.is-selected{background:var(--selected);border-radius:.5rem}
.track-row .track-info{min-width:0}.track-row .track-info strong{font-size:1rem;line-height:1.4}.track-row .track-info>span{font-size:.875rem;line-height:1.4}
.track-row.selectable .track-info{min-height:2.75rem}.track-row.selectable .track-info strong,.track-row.selectable .track-info>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}.track-row.selectable{padding-inline:.3rem}
.track-artwork{position:relative;flex:0 0 3.5rem;width:3.5rem;height:3.5rem;border-radius:.5rem}.track-artwork .track-cover{display:block;width:100%;height:100%;object-fit:cover}
.cover-play{position:absolute;right:-.25rem;bottom:-.25rem;display:grid;place-items:center;width:1.5rem;height:1.5rem;border-radius:50%;background:var(--green);color:var(--on-accent);border:2px solid var(--paper)}
.row-action-label{font-size:.8125rem;line-height:1.3;white-space:nowrap}.track-row .track-actions button:has(.row-action-label){display:inline-flex;width:auto;align-items:center;gap:.35rem;padding:.5rem .6rem;border-radius:.5rem}.track-row .track-actions button:has(.row-action-label):hover{background:var(--hover)}
.track-row.current .track-artwork{outline:2px solid var(--green);outline-offset:2px}
.track-row .track-actions{gap:.25rem}.track-row .track-actions button{min-width:2.75rem;min-height:2.75rem}.track-row .track-actions button.liked{color:var(--danger-text)}
.track-source{font-size:.75rem;line-height:1.4;font-weight:600;color:var(--green);border:1px solid var(--line);background:var(--surface-subtle);border-radius:.3rem;padding:.1rem .3rem;margin-right:.3rem;white-space:nowrap}
.track-reason{display:block;max-width:100%;font-size:.875rem;line-height:1.6;color:var(--muted);overflow-wrap:anywhere;white-space:normal;margin-top:.25rem}
@media(max-width:760px){
 .track-row:not(.selectable){display:grid;grid-template-columns:3.5rem minmax(0,1fr);gap:.625rem .75rem}
 .track-row:not(.selectable) .track-artwork{grid-column:1}.track-row:not(.selectable) .track-info{grid-column:2;min-width:0;width:100%}
 .track-row:not(.selectable) .track-actions{grid-column:1/-1;display:flex;flex-wrap:wrap;justify-content:flex-end;padding-left:0;margin:0;gap:.25rem}
 .track-row.selectable{display:grid;grid-template-columns:2.75rem 3.5rem minmax(0,1fr);gap:.5rem;min-height:4.5rem}.track-row.selectable .track-info{width:100%;min-width:0}.track-row.selectable .track-check{grid-column:1}.track-row.selectable .track-artwork{grid-column:2}.track-row.selectable .track-info{grid-column:3}
}
</style>
