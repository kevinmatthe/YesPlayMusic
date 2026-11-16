<script setup lang="ts">
import { computed } from 'vue'
import type { PlaybackSourceInfo } from '../core'
import { mediaSourceLabel, mediaSourceDetails } from '../source-label'
const props=defineProps<{info?:PlaybackSourceInfo|null;trackID:string;loading?:boolean;compact?:boolean}>()
const label=computed(()=>props.loading&&!props.info?'正在连接外部音源…':mediaSourceLabel(props.info,props.trackID))
</script>
<template><small class="media-source-label" data-testid="media-source-label">{{label}}<details v-if="info&&!compact"><summary>音源详情</summary><span>{{mediaSourceDetails(info)}}；歌曲标识和目录时长不能证明音频完整，播放时长以实际音频为准。</span></details></small></template>
<style scoped>.media-source-label{display:block;color:#8a9a78;font-size:.625rem;line-height:1.6;overflow-wrap:anywhere}summary{cursor:pointer}details{font-size:.6rem}</style>
