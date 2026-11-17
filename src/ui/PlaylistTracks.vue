<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Playlist, Track } from '../core'
import { musicApi } from '../core'
import { editPlaylistBatch, reconcileSelection } from '../playlist-batch'
import { markTracksLiked } from '../batch-like'
import { useMusic } from '../stores/music'
import { useOverlay } from '../stores/overlay'
import TrackRows from './TrackRows.vue'
import Icon from './Icon.vue'

const props=defineProps<{playlist:Playlist}>()
const emit=defineEmits<{busy:[value:boolean];play:[tracks:Track[],index:number];move:[from:number,to:number];remove:[index:number]}>()
const music=useMusic(),overlay=useOverlay(),selecting=ref(false),ids=ref<string[]>([]),filter=ref(''),busy=ref(false)
const root=ref<HTMLElement>(),entry=ref<HTMLButtonElement>(),target=ref(''),adding=ref(false),notice=ref(''),problem=ref(false)
const visible=computed(()=>{const q=filter.value.trim().toLocaleLowerCase();return q?props.playlist.tracks.filter(t=>`${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase().includes(q)):props.playlist.tracks})
const selected=computed(()=>visible.value.filter(t=>ids.value.includes(t.id)))
const all=computed(()=>visible.value.length>0&&selected.value.length===visible.value.length)
const others=computed(()=>music.playlists.filter(p=>p.id!==props.playlist.id))
const scope=computed(()=>filter.value.trim()?`当前筛选结果（${visible.value.length} 首）`:`整个歌单（${props.playlist.tracks.length} 首）`)
watch(busy,value=>emit('busy',value),{flush:'sync'})
watch(filter,()=>{ids.value=[];notice.value='';adding.value=false})
watch(()=>props.playlist.tracks.map(t=>t.id),()=>{ids.value=reconcileSelection(ids.value,visible.value)})
watch(()=>props.playlist.id,()=>{ids.value=[];selecting.value=false;filter.value='';notice.value='';adding.value=false})
function toggle(track:Track){if(busy.value)return;ids.value=ids.value.includes(track.id)?ids.value.filter(id=>id!==track.id):[...ids.value,track.id]}
function toggleAll(){if(!busy.value)ids.value=all.value?[]:visible.value.map(t=>t.id)}
async function start(){selecting.value=true;notice.value='';await nextTick();root.value?.querySelector<HTMLInputElement>('input[type=checkbox]')?.focus()}
async function done(){if(busy.value)return;selecting.value=false;ids.value=[];adding.value=false;notice.value='';await nextTick();entry.value?.focus()}
function keyboard(e:KeyboardEvent){
 if(!selecting.value||busy.value)return
 const el=e.target as HTMLElement
 if(el.matches('input:not([type=checkbox]),textarea,select,[contenteditable=true]'))return
 if(e.key==='Escape'){e.preventDefault();void done()}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();ids.value=visible.value.map(t=>t.id)}
}
function report(text:string,failed:Track[]=[]){notice.value=text;problem.value=failed.length>0;ids.value=failed.map(t=>t.id)}
async function mutate(action:'add'|'remove'){
 if(busy.value||!selected.value.length)return
 const tracks=selected.value.slice(),source=props.playlist,targetID=action==='remove'?source.id:target.value
 if(!targetID)return
 if(action==='remove'&&!confirm(`从「${source.name}」移除所选 ${tracks.length} 首歌曲？只影响这张歌单，喜欢、其他歌单与播放队列不变。`))return
 busy.value=true;notice.value=''
 try{
  const result=await editPlaylistBatch(musicApi,targetID,tracks,action)
  if(result.playlist){const i=music.playlists.findIndex(p=>p.id===targetID);if(i>=0)music.playlists[i]=result.playlist}
  const verb=action==='add'?'加入':'移除',skipped=action==='add'?'已存在':'已不在歌单'
  report(`${verb}成功 ${result.succeeded.length} 首，${skipped} ${result.skipped.length} 首，失败 ${result.failed.length} 首。${result.error||''}${result.failed.length?' 未成功的歌曲已保留选中，可重试。':''}`,result.failed)
  if(!result.failed.length)adding.value=false
 }catch(e){report(`成功 0 首，失败 ${tracks.length} 首。${e instanceof Error?e.message:'请稍后重试。'}`,tracks)}
 finally{busy.value=false}
}
async function enqueue(){
 if(busy.value||!selected.value.length)return
 const tracks=selected.value.slice();busy.value=true;notice.value=''
 try{const r=await music.player.enqueueMany(tracks);report(`已加入队列 ${r.accepted.length} 首，失败 ${r.failed.length} 首。${r.error||''}${r.failed.length?' 未入队的歌曲已保留选中，可重试。':''}`,r.failed)}
 catch(e){report(`已入队 0 首，失败 ${tracks.length} 首。${e instanceof Error?e.message:'请稍后重试。'}`,tracks)}
 finally{busy.value=false}
}
async function playSelected(){
 if(busy.value||!selected.value.length)return
 const tracks=selected.value.slice();busy.value=true;notice.value=''
 try{await music.player.playTracks(tracks);notice.value=`播放队列已切换为所选 ${tracks.length} 首；音源可用性见播放器。`;problem.value=false}
 finally{busy.value=false}
}
async function likeSelected(){
 if(busy.value||!selected.value.length)return
 const tracks=selected.value.slice(),confirmed=new Set<string>()
 busy.value=true;notice.value=''
 try{
  const result=await markTracksLiked(musicApi,tracks,track=>{
   confirmed.add(track.id)
   if(!music.likedIDs.has(track.id))music.likes.push(track)
  })
  for(const track of result.skipped){
   if(!music.likedIDs.has(track.id))music.likes.push(track)
  }
  if(result.likes)music.likes=result.likes
  report(`标记喜欢成功 ${result.succeeded.length} 首，已喜欢 ${result.skipped.length} 首，失败 ${result.failed.length} 首。${result.error||''}${result.failed.length?' 未成功的歌曲已保留选中，可重试。':''}`,result.failed)
  problem.value=result.failed.length>0||result.unconfirmed
 }catch(e){
  const failed=tracks.filter(track=>!confirmed.has(track.id))
  report(`已确认成功 ${confirmed.size} 首，其余 ${failed.length} 首结果未能确认。${e instanceof Error?e.message:'请刷新后重试。'}`,failed)
  problem.value=true
 }finally{busy.value=false}
}
function play(index:number){emit('play',visible.value,index)}
function actualIndex(index:number){return props.playlist.tracks.findIndex(t=>t.id===visible.value[index]?.id)}
</script>

<template>
 <section ref="root" class="playlist-tracks" aria-label="歌单歌曲" @keydown="keyboard">
  <div class="playlist-list-tools">
   <label class="playlist-filter"><Icon name="search" :size="17"/><input v-model="filter" aria-label="筛选歌单歌曲" placeholder="筛选这张歌单" :disabled="busy"/></label>
   <button v-if="!selecting" ref="entry" class="subtle" :disabled="!playlist.tracks.length||busy" @click="start">多选 / 全选</button>
   <button v-else class="subtle" :disabled="busy" @click="done">完成多选</button>
  </div>
  <p v-if="!selecting&&playlist.tracks.length" class="batch-entry-hint muted">多选后可全选歌曲，一次标记喜欢或加入其他歌单。</p>
  <Transition name="motion-toolbar"><div v-if="selecting" class="batch-panel batch-toolbar" :aria-busy="busy">
   <div class="batch-summary"><label class="batch-all"><input type="checkbox" :checked="all" :indeterminate="ids.length>0&&!all" :disabled="!visible.length||busy" :aria-label="`全选${scope}`" @change="toggleAll"/><span>{{all?'取消全选':'全选'}}</span></label><strong role="status">已选 {{selected.length}} 首</strong></div>
   <p class="batch-scope">全选范围：{{scope}}。{{filter.trim()?'更改筛选会清空选择。':'已完整加载，无分页。'}}<span class="batch-keyboard"> Tab / 空格勾选，Ctrl / ⌘ A 全选，Esc 退出。</span></p>
   <div class="batch-actions">
    <button class="primary" :disabled="!selected.length||busy" @click="playSelected"><Icon name="play" :size="16"/>播放所选</button>
    <button class="subtle" :disabled="!selected.length||busy" @click="enqueue"><Icon name="queue" :size="16"/>加入播放队列</button>
    <button class="subtle" :disabled="!selected.length||busy" @click="likeSelected"><Icon name="heart" :size="16"/>标记为喜欢</button>
    <button class="subtle" :disabled="!selected.length||busy" :aria-expanded="adding" @click="adding=!adding"><Icon name="plus" :size="16"/>加入其他歌单</button>
    <button class="subtle batch-remove" :disabled="!selected.length||busy" @click="mutate('remove')"><Icon name="trash" :size="16"/>从本歌单移除</button>
   </div>
   <form v-if="adding" class="batch-target" @submit.prevent="mutate('add')"><label for="batch-target">选择目标歌单</label><select id="batch-target" v-model="target" :disabled="busy" required><option value="" disabled>请选择其他歌单</option><option v-for="p in others" :key="p.id" :value="p.id">{{p.name}}（{{p.tracks.length}} 首）</option></select><button class="primary" :disabled="!target||busy">{{busy?'正在保存…':'确认加入'}}</button><p v-if="!others.length">还没有其他歌单，请先新建一张歌单。</p></form>
   <p v-if="busy" role="status" class="batch-progress">正在处理，请稍候…</p>
  </div></Transition>
  <p v-if="notice" class="batch-result" :class="{'has-failures':problem}" role="status">{{notice}}</p>
  <TrackRows :tracks="visible" :editable="!selecting&&!filter.trim()" :selecting="selecting" :selection="ids" :disabled="busy" @select="toggle" @play="play" @move="(from,to)=>emit('move',from,to)" @remove="emit('remove',actualIndex($event))" @add="overlay.add" @share="overlay.share('track',$event.id)"/>
  <p v-if="filter.trim()&&!visible.length" class="muted">这张歌单没有匹配的歌曲。<button class="subtle" :disabled="busy" @click="filter=''">清空筛选</button></p>
 </section>
</template>

<style scoped>
.playlist-tracks{min-width:0}.batch-entry-hint{margin:.25rem 0 1rem;font-size:.875rem;line-height:1.6}.playlist-list-tools{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:1rem 0}
.playlist-filter{display:flex;align-items:center;gap:.5rem;flex:1;min-width:0;border:1px solid var(--line);border-radius:.625rem;padding:0 .75rem;color:var(--muted);background:var(--input-bg)}
.playlist-filter input{width:100%;min-width:0;min-height:2.75rem;border:0;background:transparent;font:inherit;font-size:1rem;color:var(--ink);outline-offset:3px}.playlist-list-tools>button{min-height:2.75rem}
.batch-panel{padding:clamp(.5rem,2vw,1rem);border:1px solid var(--line);border-radius:.875rem;background:var(--surface-subtle)}
.batch-summary{display:flex;align-items:center;flex-wrap:wrap;gap:1rem;font-size:.9375rem}.batch-all{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;cursor:pointer}.batch-all input{width:1.2rem;height:1.2rem;padding:0;accent-color:var(--green)}
.batch-scope{color:var(--muted);font-size:.875rem;line-height:1.7;margin:.25rem 0 .9rem}.batch-keyboard{display:none}
.batch-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:.5rem}.batch-actions button{min-height:2.75rem;min-width:0;padding:.65rem .5rem;font-size:.875rem;justify-content:center;white-space:normal;line-height:1.5}.batch-actions button svg{flex-shrink:0}.batch-actions button{scroll-margin-block:1rem}.batch-actions .batch-remove{color:var(--danger-text)}
.batch-target{display:grid;gap:.6rem;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line);min-width:0;font-size:.875rem}.batch-target select{width:100%;min-width:0;min-height:2.75rem;padding:.65rem;font:inherit;font-size:1rem;background:var(--input-bg);border:1px solid var(--line);border-radius:.5rem;color:var(--ink)}.batch-target button{min-height:2.75rem;justify-content:center}
.batch-result{padding:.85rem 1rem;font-size:.875rem;line-height:1.7;background:var(--success-surface);color:var(--success-text);border-radius:.625rem;overflow-wrap:anywhere}.batch-result.has-failures{background:var(--warning-surface);color:var(--warning-text)}.batch-progress{font-size:.875rem;margin-bottom:0}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px}
@media(min-width:761px){.batch-actions{display:flex;flex-wrap:wrap}.batch-actions button{padding:.65rem 1rem}.batch-keyboard{display:inline}.playlist-filter{max-width:24rem}.batch-target{grid-template-columns:minmax(0,1fr) auto}.batch-target label,.batch-target p{grid-column:1/-1}}
</style>
