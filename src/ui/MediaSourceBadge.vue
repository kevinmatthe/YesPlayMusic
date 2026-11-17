<script setup lang="ts">
import { computed } from 'vue'
import type { PlaybackSourceInfo } from '../core'
import { mediaSourceLabel, mediaSourceDetails, mediaSourceOrigin } from '../source-label'
const props=defineProps<{info?:PlaybackSourceInfo|null;trackID:string;loading?:boolean;compact?:boolean}>()
const fullLabel=computed(()=>props.loading?'正在连接音源…':mediaSourceLabel(props.info,props.trackID))
const label=computed(()=>{
 if(!props.compact||props.loading)return fullLabel.value
 if(!props.info)return '尚未连接'
 if(props.info.status==='unavailable')return '音源暂不可用'
 const source=mediaSourceOrigin(props.info,props.trackID,true)
 if(props.info.status==='preview')return `${source} · 仅能试听`
 const delivery=props.info.reason?.split(':',1)[0]
 return `${source} · ${delivery==='device_audio_cache'?'本机缓存':delivery==='device_audio_memory'?'本次未保存':'直连'}`
})
const tone=computed(()=>props.loading||!props.info?'pending':props.info.status==='unavailable'||props.info.status==='preview'?'limited':props.info.reason?.split(':',1)[0]==='device_audio_cache'?'local':'connected')
</script>
<template><small class="media-source-label" :class="`source-${tone}`" data-testid="media-source-label" :title="fullLabel"><span class="source-summary"><i aria-hidden="true"/>{{label}}</span><details v-if="info&&!compact&&!loading"><summary>连接说明</summary><p v-if="info.mediaSource==='netease:account'">这里的服务器账号用于提供音源，不是你的个人网易云账号。</p><p>{{info.reason?.split(':',1)[0]==='device_audio_cache'?'当前使用这台设备已保存的音频。':'连接信息不代表整首音频已核验；可播放时长以实际音频为准。'}}</p><span class="source-diagnostics">技术信息：{{mediaSourceDetails(info)}}</span></details></small></template>
<style scoped>
.media-source-label{display:block;color:var(--muted);font-size:.875rem;line-height:1.65;overflow-wrap:anywhere}
.source-summary{display:inline-flex;align-items:center;gap:.5rem;max-width:100%;padding:.25rem .625rem;border:1px solid var(--line);border-radius:.5rem;background:var(--surface-subtle)}
.source-summary i{flex:0 0 .375rem;width:.375rem;height:.375rem;border-radius:50%;background:currentColor}
.source-local .source-summary{color:var(--success-text);background:var(--success-surface)}.source-limited .source-summary{color:var(--warning-text);background:var(--warning-surface)}
summary{display:inline-flex;align-items:center;min-height:2.75rem;padding:.25rem 0;color:var(--green);text-decoration:underline;text-underline-offset:.2em;cursor:pointer}summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px;border-radius:.25rem}
details{font-size:.875rem}details p{margin:0 0 .5rem}details>span{display:block;max-width:65ch;padding-bottom:.5rem;color:var(--muted)}.source-diagnostics{font-size:.8125rem}
</style>
