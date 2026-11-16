<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import { getThemeController, type ThemeMode } from '../theme'

const theme = getThemeController()
const appearance = shallowRef(theme.snapshot())
const unsubscribe = theme.subscribe(value => { appearance.value = value })
onBeforeUnmount(unsubscribe)
function choose(event: Event) {
  theme.setMode((event.target as HTMLSelectElement).value as ThemeMode)
}
</script>

<template>
  <label class="theme-control" title="界面主题">
    <svg class="theme-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <template v-if="appearance.mode === 'system'"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></template>
      <template v-else-if="appearance.resolved === 'dark'"><path d="M20.5 13.2A8.7 8.7 0 0 1 10.8 3.5a8.7 8.7 0 1 0 9.7 9.7Z"/></template>
      <template v-else><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></template>
    </svg>
    <span class="theme-control-label">界面主题</span>
    <select class="theme-control-select" aria-label="界面主题" :value="appearance.mode" @change="choose">
      <option value="system">跟随系统</option>
      <option value="light">浅色模式</option>
      <option value="dark">深色模式</option>
    </select>
  </label>
</template>

<style scoped>
.theme-control{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:2.75rem;min-width:2.75rem;min-height:2.75rem;margin:0;border:1px solid var(--control-border,#879680);border-radius:.75rem;background:var(--surface,#fffef8);color:var(--ink,#223f33);cursor:pointer}
.theme-control-icon{width:1.125rem;height:1.125rem;flex:none;pointer-events:none}
.theme-control-label{position:absolute;overflow:hidden;width:1px;height:1px;padding:0;clip-path:inset(50%);white-space:nowrap}
.theme-control .theme-control-select{position:absolute;inset:0;width:100%;min-width:0;height:100%;min-height:2.75rem;margin:0;padding:0;border:0;opacity:0;cursor:pointer;font:inherit;color:var(--ink,#223f33);background:var(--surface,#fffef8)}
.theme-control:focus-within{outline:3px solid var(--focus-ring,#356d46);outline-offset:3px}
@media(min-width:471px){.theme-control{width:auto;gap:.5rem;padding:0 .625rem}.theme-control .theme-control-select{position:static;width:auto;max-width:8rem;min-height:2.625rem;opacity:1;padding:0 .25rem;font-size:.875rem;outline:none}}
@media(forced-colors:active){.theme-control{border-color:ButtonText}.theme-control:focus-within{outline-color:Highlight}}
</style>
