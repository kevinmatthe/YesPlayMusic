<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Playlist } from '../core'
import { playlistSyncMessage } from '../playlist-sync'
import { useMusic } from '../stores/music'

const props = defineProps<{playlist: Playlist}>()
const music = useMusic()
const sync = computed(() => props.playlist.sync)
const sourceURL = computed(() => 'https://music.163.com/playlist?id=' + encodeURIComponent(sync.value?.sourcePlaylistID || ''))
const dateFormat = new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium', timeStyle:'short'})
const lastSuccess = computed(() => {
  const timestamp = Date.parse(sync.value?.lastSuccessAt || '')
  return Number.isFinite(timestamp) ? dateFormat.format(timestamp) : '暂无'
})
const remoteRunning = ref(false)
const localRunning = computed(() => music.syncing.has(props.playlist.id))
let timer: ReturnType<typeof setTimeout> | undefined
let active = false
function scheduleStatusRefresh() {
  clearTimeout(timer)
  const remaining = Date.parse(sync.value?.runningUntil || '') - Date.now()
  remoteRunning.value = remaining > 0
  if (active && !document.hidden && !localRunning.value && remaining > 0) {
    timer = setTimeout(refreshVisible, Math.min(remaining, 2500))
  }
}
async function refreshVisible() {
  if (active && !document.hidden && !localRunning.value) {
    await music.refreshSyncPlaylist(props.playlist.id)
  }
  scheduleStatusRefresh()
}
watch([() => sync.value?.runningUntil, localRunning], scheduleStatusRefresh)
onMounted(() => {
  active = true
  void refreshVisible()
  document.addEventListener('visibilitychange', refreshVisible)
})
onUnmounted(() => {
  active = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', refreshVisible)
})
</script>

<template>
  <div v-if="sync" class="sync-status" role="status">
    <a :href="sourceURL" target="_blank" rel="noopener noreferrer">来自网易云 ↗</a>
    <p>最近一次成功同步 <time v-if="sync.lastSuccessAt" :datetime="sync.lastSuccessAt">{{lastSuccess}}</time><span v-else>{{lastSuccess}}</span></p>
    <p v-if="localRunning || remoteRunning">正在同步网易云曲目…</p>
    <p v-else-if="sync.lastError" class="sync-error">上次同步失败，已保留原曲目。{{playlistSyncMessage(sync.lastError)}}</p>
  </div>
</template>

<style scoped>
.sync-status{margin:.5rem 0 .75rem;color:var(--muted);font-size:.875rem;line-height:1.6;overflow-wrap:anywhere}
.sync-status a{display:inline-flex;align-items:center;min-height:2.75rem;color:var(--green);text-decoration:underline;text-underline-offset:.2em}
.sync-status p{margin:0}
.sync-status .sync-error{color:var(--danger-text);margin-top:.25rem}
</style>
