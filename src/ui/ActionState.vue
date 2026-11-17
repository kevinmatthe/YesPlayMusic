<script setup lang="ts">
import Icon from './Icon.vue'
withDefaults(defineProps<{title:string;description?:string;icon?:string;busy?:boolean}>(),{icon:'music',busy:false})
</script>
<template><div class="action-state" :class="{'is-busy':busy}" :role="busy?'status':undefined"><span class="state-icon" aria-hidden="true"><Icon :name="icon" :size="22"/></span><div class="state-copy"><h2>{{title}}</h2><p v-if="description">{{description}}</p><div v-if="$slots.default" class="state-actions"><slot/></div></div></div></template>
<style scoped>
.action-state{display:flex;align-items:flex-start;gap:1rem;padding:1.25rem;border:1px solid var(--line);border-radius:1rem;background:var(--surface-subtle);margin:1rem 0;min-width:0}
.state-icon{display:grid;place-items:center;flex:0 0 2.75rem;width:2.75rem;height:2.75rem;border-radius:50%;border:1px solid var(--line);color:var(--green);background:var(--paper)}
.state-copy{min-width:0}.state-copy h2{font-size:1.0625rem;line-height:1.5;margin:.125rem 0 .375rem;color:var(--ink)}.state-copy p{font-size:.875rem;line-height:1.7;margin:0;color:var(--muted);max-width:60ch;overflow-wrap:anywhere}.state-actions{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}.state-actions :deep(a),.state-actions :deep(button){font-size:.875rem;min-height:2.75rem}.is-busy .state-icon{border-style:dashed}
@media(max-width:470px){.action-state{padding:1rem;gap:.75rem}.state-icon{flex-basis:2rem;width:2rem;height:2rem}}
</style>
