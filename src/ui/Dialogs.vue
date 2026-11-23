<script setup lang="ts">
import { artworkURL } from '../artwork'
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMusic } from '../stores/music'
import { useOverlay } from '../stores/overlay'
import { musicApi } from '../core'
import type { ExportData, PlaylistImportResult } from '../core'
import Icon from './Icon.vue'
import DeviceCachePanel from './DeviceCachePanel.vue'
import { deviceAudioCache } from '../core/api'
import { useDialogFocus } from './dialog-focus'
const music=useMusic(),overlay=useOverlay(),name=ref(''),recovery=ref(''),recoveryInput=ref(''),nameInput=ref<HTMLInputElement>(),working=ref(false)
const router=useRouter(),sourcePlaylist=ref(''),importName=ref(''),importResult=ref<PlaylistImportResult>(),importError=ref('')
const dialog=ref<HTMLElement>()
const syncMode=ref(false),syncLink=ref(''),syncInput=ref<HTMLInputElement>()
useDialogFocus(dialog,()=>overlay.kind,()=>overlay.close(),()=>overlay.kind==='create'?(syncMode.value?syncInput.value:nameInput.value):undefined)
watch(()=>overlay.kind,async kind=>{if(kind==='create'){name.value='';syncLink.value='';syncMode.value=false;music.error='';await nextTick();nameInput.value?.focus()}if(kind!=='transfer')recovery.value=''})
async function create(){if(!name.value.trim())return;working.value=true;const p=await music.create(name.value,overlay.track?[overlay.track.id]:[]);if(p)overlay.close();working.value=false}
async function selectSyncMode(value:boolean){
 syncMode.value=value;music.error=''
 await nextTick()
 if(value)syncInput.value?.focus()
 else nameInput.value?.focus()
}
async function createSync(){
 const link=syncLink.value.trim()
 if(!link||working.value)return
 working.value=true
 try{
  const created=await music.createSync(link)
  if(created){if(overlay.kind==='create')overlay.close();await router.push('/library')}
 }finally{working.value=false}
}
async function add(id:string){const p=music.editablePlaylists.find(p=>p.id===id);if(p&&overlay.track){const result=await music.add(p,overlay.track);if(result)overlay.close()}}
async function exportJSON(){await music.run(async()=>{const data=await musicApi.exportData();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='betago-music-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)})}
async function importJSON(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;await music.run(async()=>{if(file.size>2*1024*1024)throw new Error('备份文件不能超过 2 MiB');await music.importData(JSON.parse(await file.text()) as ExportData)});input.value=''}
async function recover(){working.value=true;await music.changeSession(()=>musicApi.recover(recoveryInput.value));working.value=false}
async function copy(){await music.run(async()=>{await navigator.clipboard.writeText(overlay.shareURL);music.notify('分享链接已复制')})}
async function importPublicPlaylist(){
 working.value=true;importError.value='';importResult.value=undefined
 try{importResult.value=await musicApi.importNetEasePlaylist(sourcePlaylist.value,importName.value);await music.refresh()}
 catch(error){importError.value=error instanceof Error?error.message:'导入失败，请稍后重试。'}
 finally{working.value=false}
}
function viewImported(){if(importResult.value){music.selectedID=importResult.value.playlist.id;overlay.close();router.push('/library')}}
</script>
<template><Teleport to="body"><div v-if="overlay.kind" class="modal-shade" @click.self="overlay.close()"><section ref="dialog" class="dialog" :class="{'dialog-wide':overlay.kind==='transfer'}" role="dialog" aria-modal="true" :aria-label="{create:'新建歌单',add:'加入歌单',share:'分享音乐',transfer:'备份与恢复'}[overlay.kind]"><button class="icon-button dialog-close" aria-label="关闭" @click="overlay.close()"><Icon name="close"/></button>
 <template v-if="overlay.kind==='create'">
  <form v-if="syncMode && music.library.neteasePlaylistSync===true" class="sync-create" @submit.prevent="createSync">
   <h2>新建同步歌单</h2>
   <p class="muted">跟随公开网易云歌单。每天自动同步，也可随时手动同步。</p>
   <label class="field-label" for="sync-playlist-link">网易云歌单分享链接</label>
   <input id="sync-playlist-link" ref="syncInput" v-model="syncLink" maxlength="2048" placeholder="粘贴网易云的分享链接" autocapitalize="none" autocomplete="off" spellcheck="false" :disabled="working" required/>
   <button class="primary full" :disabled="working" :aria-busy="working">{{working?'正在读取歌单…':'创建同步歌单'}}</button>
   <button type="button" class="subtle full sync-create-switch" :disabled="working" @click="selectSyncMode(false)">返回普通歌单</button>
  </form>
  <form v-else @submit.prevent="create">
   <span class="eyebrow">A PLACE FOR YOUR FAVORITES</span>
   <h2>给这份喜欢起个名字。</h2>
   <label class="field-label" for="playlist-name">歌单名称</label>
   <input id="playlist-name" ref="nameInput" v-model="name" maxlength="100" placeholder="例如：下班路上的歌" required/>
   <p class="muted">歌单默认私有，你可以随时创建或撤销分享。</p>
   <button class="primary full" :disabled="working">{{working?'保存中…':'创建歌单'}}</button>
   <button v-if="music.library.neteasePlaylistSync===true&&!overlay.track" type="button" class="subtle full sync-create-switch" :disabled="working" @click="selectSyncMode(true)">跟随网易云歌单</button>
  </form>
 </template>
 <template v-else-if="overlay.kind==='add'"><span class="eyebrow">SAVE TO YOUR COLLECTION</span><h2>加入歌单</h2><p class="muted">{{overlay.track?.title}}</p><p v-if="!music.editablePlaylists.length" class="muted">还没有可加入的普通歌单。</p><div class="dialog-playlists"><button v-for="p in music.editablePlaylists" :key="p.id" @click="add(p.id)"><img :src="artworkURL(p.tracks[0]?.picture)" alt=""/><span><strong>{{p.name}}</strong><small>{{p.tracks.length}} 首歌曲</small></span><Icon name="plus"/></button></div><button class="subtle full" @click="overlay.create()"><Icon name="plus" :size="17"/> 新建歌单</button></template>
 <template v-else-if="overlay.kind==='share'"><span class="eyebrow">GOOD MUSIC IS MEANT TO BE SHARED</span><h2>分享这份音乐。</h2><p class="muted">持有链接的人可以查看和复制歌单。分享只读，可在「分享管理」随时撤销。</p><label class="field-label" for="share-link">分享链接</label><input id="share-link" :value="overlay.shareURL" readonly @click="($event.target as HTMLInputElement).select()"/><button class="primary full" @click="copy"><Icon name="share" :size="17"/> 复制链接</button></template>
 <template v-else><span class="eyebrow">TAKE YOUR MUSIC WITH YOU</span><h2>音乐，也能带走。</h2><p class="muted">访客空间由当前浏览器的会话识别。其他设备不会自动认出你；恢复码可以打开同一空间，JSON 备份会复制歌单和喜欢。</p><p v-if="music.identityMessage" class="muted">{{music.identityMessage}}</p><nav class="dialog-utilities" aria-label="音乐空间管理"><RouterLink class="subtle" to="/shares" @click="overlay.close()"><Icon name="share" :size="17"/>分享管理</RouterLink><RouterLink class="subtle" to="/history" @click="overlay.close()"><Icon name="history" :size="17"/>最近播放</RouterLink></nav><div v-if="music.userKind==='feishu'" class="recovery-area"><h3>飞书个人资料</h3><p class="muted">已连接飞书个人空间，昵称和头像由飞书核实。刷新资料不会切换账号。</p><button class="subtle" :disabled="!music.inFeishu||!music.feishuEnabled" @click="music.refreshFeishuProfile()">刷新资料</button><p v-if="!music.inFeishu" class="muted">在飞书内打开后可刷新昵称和头像。</p></div><div v-else-if="music.feishuEnabled&&music.inFeishu" class="recovery-area"><h3>切换到飞书个人空间</h3><p class="muted">飞书空间与当前访客空间分别保存，不会自动合并。先导出 JSON 或保存下方恢复码，再切换；之后可将 JSON 导入飞书空间。</p><button v-if="!recovery" class="subtle" @click="music.run(async()=>recovery=await musicApi.recovery())">先生成访客恢复码</button><template v-else><code class="recovery-code">{{recovery}}</code><button class="primary" @click="music.connectFeishu()">我已保存恢复码，连接飞书</button></template></div><p v-else-if="music.inFeishu" class="muted">当前飞书网页身份尚未配置，访客功能可正常使用。</p><section class="playlist-import"><h3>导入公开网易歌单</h3><p class="muted">无需网易云登录，复制曲目到自己的新歌单，不覆盖现有歌单。最多 1000 首，播放时仍按音源权限检查。</p><form @submit.prevent="importPublicPlaylist"><label class="field-label" for="source-playlist">网易歌单链接或数字 ID</label><input id="source-playlist" v-model="sourcePlaylist" maxlength="2048" placeholder="https://music.163.com/playlist?id=…" :disabled="working" required/><label class="field-label" for="import-playlist-name">新歌单名称（可选）</label><input id="import-playlist-name" v-model="importName" maxlength="100" placeholder="留空使用原歌单名称" :disabled="working"/><button class="primary" :disabled="working">{{working?'正在读取公开歌单…':'导入为新歌单'}}</button></form><p v-if="importError" class="dialog-error" role="alert">{{importError}}</p><div v-if="importResult" class="playlist-import-result" role="status"><p>已复制到「{{importResult.playlist.name}}」：{{importResult.imported}} 首，跳过重复 {{importResult.duplicatesSkipped}} 首。</p><button class="subtle" @click="viewImported">查看导入歌单 →</button></div></section><div class="transfer-options"><button @click="exportJSON"><Icon name="backup"/><strong>导出 JSON 备份</strong><small>歌单与喜欢，不含音频或密钥</small></button><label class="import-file"><Icon name="library"/><strong>导入 JSON 备份</strong><small>复制到当前空间</small><input type="file" aria-label="导入 JSON" accept="application/json,.json" @change="importJSON"/></label></div><DeviceCachePanel :cache="deviceAudioCache"/><div class="recovery-area"><h3>恢复到另一台设备</h3><p class="muted">恢复码相当于空间钥匙，请私密保存。清除浏览器数据后，仍可用它恢复；轮换后旧码立即失效。</p><button class="subtle" @click="music.run(async()=>recovery=await musicApi.recovery())">生成 / 轮换恢复码</button><code v-if="recovery" class="recovery-code" data-testid="recovery-code">{{recovery}}</code><form class="recover-form" @submit.prevent="recover"><input v-model="recoveryInput" aria-label="恢复码" type="password" autocomplete="off" placeholder="输入保存的恢复码" required/><button :disabled="working" class="primary">恢复空间</button></form></div></template>
 <p v-if="music.error" class="dialog-error" role="alert">{{music.error}}</p>
 </section></div></Teleport></template>

<style scoped>
.dialog{color:var(--ink)}.dialog p,.dialog .muted,.dialog .field-label{font-size:.875rem;line-height:1.7}.dialog .field-label{display:block;color:var(--muted)}
.dialog input:not([type=file]):not([type=checkbox]):not([type=radio]){min-height:2.75rem;font-size:1rem}.dialog .dialog-close{min-width:2.75rem;min-height:2.75rem}
.sync-create .primary,.sync-create-switch{min-height:2.75rem}.sync-create-switch{margin-top:.5rem;justify-content:center}
.dialog-utilities{display:flex;flex-wrap:wrap;gap:.5rem;margin:1.25rem 0}.dialog-utilities>a{min-height:2.75rem;font-size:.875rem}
.transfer-options{align-items:stretch}.transfer-options strong{font-size:.9375rem}.transfer-options small{font-size:.875rem;color:var(--muted);line-height:1.65}.import-file{position:relative;min-width:0}
.import-file input[type=file]{display:block;position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;opacity:0;cursor:pointer}.import-file:focus-within{outline:2px solid var(--focus-ring);outline-offset:3px}
.playlist-import{margin-top:1.75rem;padding-top:1.5rem;border-top:1px solid var(--line)}.playlist-import h3{font-size:1.0625rem}.playlist-import form{display:grid;gap:.25rem}.playlist-import .primary{justify-self:start;margin-top:.5rem;min-height:2.75rem;white-space:normal}
.playlist-import-result{margin-top:1rem;border-radius:.625rem;background:var(--success-surface);color:var(--success-text);padding:.85rem 1rem;font-size:.875rem;overflow-wrap:anywhere}
.recovery-area h3{font-size:1.0625rem}.recovery-area .recovery-code{color:var(--ink);background:var(--input-bg);font-size:.875rem;line-height:1.7}.recover-form{flex-wrap:wrap}.recover-form input{min-width:0;flex:1 1 12rem}.recover-form>.primary{min-height:2.75rem;font-size:.875rem}
</style>
