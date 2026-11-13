<script setup lang="ts">
withDefaults(defineProps<{name:string;size?:number}>(),{size:20})
const paths:Record<string,string>={
 music:'M9 18V5l12-2v13M9 9l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Zm12-2a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
 library:'M4 4v16M9 4v16M14 5l5-1 3 15-5 1Z', search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
 queue:'M4 6h16M4 12h10M4 18h10m4-5 4 3-4 3Z',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 play:'m8 4 12 8-12 8Z',pause:'M8 4v16M16 4v16',next:'m5 4 11 8-11 8ZM19 4v16',previous:'m19 4-11 8 11 8ZM5 4v16',
 plus:'M12 5v14M5 12h14',close:'m6 6 12 12M6 18 18 6',up:'m6 15 6-6 6 6',down:'m6 9 6 6 6-6',
 share:'m14 3 7 7-7 7M21 10H9a6 6 0 0 0-6 6v5',history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2',
 arrow:'M5 12h14m-6-6 6 6-6 6',backup:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',repeat:'m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3',
 shuffle:'m18 2 4 4-4 4M2 6h3c5 0 9 12 14 12h3m-4-4 4 4-4 4M2 18h3c5 0 9-12 14-12h3',volume:'m11 5-6 4H2v6h3l6 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',lyrics:'M4 4h16v16H4ZM8 8h8M8 12h8M8 16h5',menu:'M4 6h16M4 12h16M4 18h16',check:'m5 12 4 4L20 5',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',edit:'m16 3 5 5L8 21H3v-5Z',logout:'M9 3H3v18h6m7-14 5 5-5 5M9 12h12'
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.music" :fill="name==='play'?'currentColor':'none'"/></svg></template>
