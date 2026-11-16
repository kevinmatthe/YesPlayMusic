<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { DeviceAudioCache } from '../core/device-audio-cache'

const props=defineProps<{cache:DeviceAudioCache}>()
const state=ref(props.cache.snapshot()),working=ref(false),ready=ref(false),error=ref('')
let unsubscribe=()=>{}
const mib=(bytes:number)=>(bytes/(1024*1024)).toLocaleString('zh-CN',{maximumFractionDigits:1})+' MiB'
async function run(action:()=>Promise<unknown>){
 working.value=true;error.value=''
 try{await action()}catch{error.value='暂时无法修改本机缓存，请稍后重试。'}finally{working.value=false}
}
async function toggle(event:Event){await run(()=>props.cache.setEnabled((event.target as HTMLInputElement).checked));state.value=props.cache.snapshot()}
async function loadSettings(){
 if(working.value)return
 working.value=true;ready.value=false;error.value=''
 try{await props.cache.refresh();ready.value=true}
 catch{error.value='暂时无法读取当前空间的缓存设置；播放仍可使用。'}
 finally{working.value=false}
}
onMounted(()=>{
 unsubscribe=props.cache.subscribe(next=>state.value=next)
 void loadSettings()
})
onBeforeUnmount(()=>unsubscribe())
</script>

<template>
 <section class="device-cache-panel" aria-labelledby="device-cache-title">
  <div class="device-cache-heading"><h3 id="device-cache-title">本机音频缓存</h3><span>只在这台设备</span></div>
  <p id="device-cache-explanation" class="muted">首次准备需要完整下载，之后重播和刷新可直接使用本机音频。只保存通过完整性与时长检查的歌曲，试听片段不会当作完整缓存。</p>
  <label class="device-cache-toggle"><input type="checkbox" :checked="state.enabled" :disabled="working||!ready" aria-describedby="device-cache-explanation" @change="toggle"/><span><strong>自动缓存完整歌曲</strong><small>关闭后不再新增，已有缓存仍可播放。</small></span></label>
  <div class="device-cache-usage"><span>当前音乐空间 · {{state.count}} 首</span><strong>{{mib(state.usedBytes)}} <span>/ {{mib(state.limitBytes)}}</span></strong></div>
  <meter :value="state.usedBytes" :max="state.limitBytes" min="0" aria-label="当前空间的本机缓存用量"/>
  <p class="device-cache-help muted">各音乐空间分别识别；总缓存超过上限时会先移除较久未听的音频。单曲最多 64 MiB，歌单与喜欢仍由服务器保存。</p>
  <div class="device-cache-actions"><button v-if="!ready&&(error||working)" type="button" class="subtle" :disabled="working" @click="loadSettings">{{working?'正在读取缓存设置…':'重新读取缓存设置'}}</button><button type="button" class="subtle" :disabled="working||!ready||!state.count" @click="run(()=>cache.clear())">清空当前空间缓存</button><button type="button" class="subtle" :disabled="working||!ready||state.persistent" @click="run(()=>cache.requestPersistence())">{{state.persistent?'已请求保留':'请求浏览器保留缓存'}}</button></div>
  <p v-if="state.message" class="device-cache-status" role="status">{{state.message}}</p>
  <p v-if="error" class="device-cache-error" role="alert">{{error}}</p>
  <p class="device-cache-help muted">浏览器可能因空间不足、隐私模式或手动清理而移除缓存。保留请求可能不获批准；清空缓存不影响你的账号、歌单和喜欢，也不代表跨设备下载或离线应用。</p>
 </section>
</template>

<style scoped>
.device-cache-panel{min-width:0;margin-top:1.5rem;padding-top:1.2rem;border-top:1px solid #dfe7d3;overflow-wrap:anywhere}.device-cache-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem}.device-cache-heading h3{font-size:.95rem;margin:0}.device-cache-heading>span{font-size:.7rem;color:#667154}.device-cache-panel>p{font-size:.8rem;line-height:1.65}.device-cache-panel .device-cache-toggle{display:flex;align-items:center;gap:.75rem;width:100%;min-width:0;max-width:100%;min-height:3rem;padding:.5rem 0;cursor:pointer}.device-cache-panel .device-cache-toggle>input[type=checkbox]{flex:0 0 1.2rem;width:1.2rem;min-width:1.2rem;max-width:1.2rem;height:1.2rem;padding:0;margin:0;accent-color:#536d35}.device-cache-panel .device-cache-toggle>span{display:grid;flex:1 1 0%;min-width:0;gap:.2rem;white-space:normal}.device-cache-toggle strong{font-size:.85rem}.device-cache-toggle small{font-size:.75rem;color:#667154}.device-cache-usage{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.4rem;margin:.6rem 0;font-size:.75rem}.device-cache-usage strong{font-variant-numeric:tabular-nums;font-weight:500}.device-cache-usage strong span{color:#667154}.device-cache-panel meter{display:block;width:100%;height:.65rem;accent-color:#667e43}.device-cache-actions{display:flex;flex-direction:column;align-items:stretch;gap:.5rem}.device-cache-actions button{min-height:2.75rem;white-space:normal}.device-cache-help{font-size:.75rem!important}.device-cache-status,.device-cache-error{padding:.6rem .75rem;border-radius:.5rem;background:#edf4e6;font-size:.8rem}.device-cache-error{color:#8b382c;background:#fbede6}@media(min-width:470px){.device-cache-actions{flex-direction:row;flex-wrap:wrap;align-items:center}}
</style>
