<script setup lang="ts">
import { artworkURL } from '../artwork'
import { computed, watch, nextTick, ref, onMounted, onBeforeUnmount } from 'vue'
import { useMusic } from '../stores/music'
import { useOverlay } from '../stores/overlay'
import Icon from './Icon.vue'
import { useDialogFocus } from './dialog-focus'
const music=useMusic(),overlay=useOverlay(),p=music.player
const current=computed(()=>p.currentTrack)
const dialog=ref<HTMLElement>()
useDialogFocus(dialog,()=>overlay.lyrics,()=>{overlay.lyrics=false})
const background=ref(document.hidden)
function visibility(){background.value=document.hidden}
onMounted(()=>document.addEventListener('visibilitychange',visibility))
onBeforeUnmount(()=>document.removeEventListener('visibilitychange',visibility))
const active=computed(()=>{if(!overlay.lyrics||background.value)return -1;let i=-1;for(let n=0;n<p.state.lyricLines.length;n++){if(p.state.lyricLines[n]!.timeMs<=p.state.positionMs)i=n;else break}return i})
watch(active,async()=>{if(!overlay.lyrics||background.value)return;await nextTick();if(!overlay.lyrics||background.value)return;document.querySelector('.lyric-line.is-current')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})})
</script>
<template><Teleport to="body"><section v-if="overlay.lyrics" ref="dialog" class="lyrics-screen" role="dialog" aria-modal="true" aria-label="正在播放与歌词"><button class="icon-button lyrics-close" aria-label="关闭歌词" @click="overlay.lyrics=false"><Icon name="down" :size="26"/></button><div class="lyrics-art"><img :src="artworkURL(current?.picture)" alt="专辑封面"/><span class="eyebrow">NOW PLAYING</span><h1>{{current?.title}}</h1><p>{{current?.artist}}</p><div class="large-controls"><button class="icon-button" aria-label="上一首" @click="p.previous()"><Icon name="previous" :size="25"/></button><button class="play-button" :aria-label="p.state.playing?'暂停':'播放'" @click="p.toggle()"><Icon :name="p.state.playing?'pause':'play'" :size="28"/></button><button class="icon-button" aria-label="下一首" @click="p.next()"><Icon name="next" :size="25"/></button></div><p v-if="p.state.status" class="lyrics-status">{{p.state.status}}</p></div><div class="lyrics-lines" aria-live="off"><template v-if="p.state.lyricLines.length"><button v-for="(line,index) in p.state.lyricLines" :key="`${line.timeMs}:${index}`" class="lyric-line" :class="{'is-current':index===active}" @click="p.seek(line.timeMs)"><span>{{line.text}}</span><small v-if="line.translation">{{line.translation}}</small></button></template><p v-else>这首歌，暂时没有歌词。</p></div></section></Teleport></template>

<style scoped>
.lyrics-art,.lyrics-lines{min-width:0}.lyrics-art h1{overflow-wrap:anywhere}.lyrics-art>p,.lyrics-art .lyrics-status{font-size:.875rem;color:var(--muted);line-height:1.7}.lyrics-screen .lyrics-close{min-width:2.75rem;min-height:2.75rem}
.lyric-line{color:var(--lyric-idle);overflow-wrap:anywhere}.lyric-line.is-current{color:var(--lyric-current)}.lyric-line small{font-size:1rem;line-height:1.6}
</style>
