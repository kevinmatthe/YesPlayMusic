<script setup lang="ts">
import { computed } from 'vue'
import type { PlaybackSourceInfo } from '../core'
import { mediaSourceLabel, mediaSourceDetails } from '../source-label'
const props=defineProps<{info?:PlaybackSourceInfo|null;trackID:string;loading?:boolean;compact?:boolean}>()
const fullLabel=computed(()=>props.loading&&!props.info?'正在连接外部音源…':mediaSourceLabel(props.info,props.trackID))
const label=computed(()=>{
 if(!props.compact)return fullLabel.value
 if(props.loading)return '正在取源'
 if(!props.info)return '尚未连接'
 if(props.info.status==='unavailable')return '不可用'
 if(props.info.status==='preview')return '仅能试听'
 // Delivery is encoded by the cache decorator's reason namespace. Match its
 // exact segment so a similarly named provider reason cannot claim a hit.
 const delivery=props.info.reason?.split(':',1)[0]
 if(delivery==='device_audio_cache')return '本机缓存'
 if(delivery==='device_audio_memory')return '本次未保存'
 return '直连音源'
})
</script>
<template><small class="media-source-label" data-testid="media-source-label" :title="fullLabel">{{label}}<details v-if="info&&!compact"><summary>音源详情</summary><span>{{mediaSourceDetails(info)}}；歌曲标识和目录时长不能证明音频完整，播放时长以实际音频为准。</span></details></small></template>
<style scoped>
.media-source-label{display:block;color:var(--muted);font-size:.875rem;line-height:1.65;overflow-wrap:anywhere}
summary{display:inline-flex;align-items:center;min-height:2.75rem;padding:.25rem 0;color:var(--green);text-decoration:underline;text-underline-offset:.2em;cursor:pointer}summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px;border-radius:.25rem}
details{font-size:.875rem}details>span{display:block;max-width:65ch;padding-bottom:.5rem;color:var(--muted)}
</style>
