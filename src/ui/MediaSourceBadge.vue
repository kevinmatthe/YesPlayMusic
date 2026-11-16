<script setup lang="ts">
import { computed } from 'vue'
import type { PlaybackSourceInfo } from '../core'
import { mediaSourceLabel } from '../source-label'
const props=defineProps<{info?:PlaybackSourceInfo|null;trackID:string;loading?:boolean}>()
const label=computed(()=>props.loading&&!props.info?'正在解析音源…':mediaSourceLabel(props.info,props.trackID))
</script>
<template><small class="media-source-label" data-testid="media-source-label" :title="label+'；来源与探测范围不代表已核实同一录音。'">{{label}}</small></template>
<style scoped>.media-source-label{display:block;color:#8a9a78;font-size:.625rem;line-height:1.6;overflow-wrap:anywhere}</style>
