import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
vi.mock('../src/stores/music',()=>({useMusic:()=>({identityMessage:'',userKind:'guest',feishuEnabled:false,inFeishu:false,error:''})}))
vi.mock('../src/stores/overlay',()=>({useOverlay:()=>({kind:'transfer',close:()=>{}})}))
import Dialogs from '../src/ui/Dialogs.vue'
import MediaSourceBadge from '../src/ui/MediaSourceBadge.vue'
import type { PlaybackSourceInfo } from '../src/core'
describe('cache settings inside the existing backup dialog',()=>{
 it('mounts the actual settings panel together with the existing import and recovery controls',async()=>{
  const router=createRouter({history:createMemoryHistory(),routes:['/','/library','/shares','/history'].map(path=>({path,component:{template:'<span/>'}}))});await router.push('/')
  const context:{teleports?:Record<string,string>}={};await renderToString(createSSRApp(Dialogs).use(router),context)
  const html=context.teleports?.body??''
  expect(html).toContain('本机音频缓存');expect(html).toContain('自动缓存完整歌曲');expect(html).toContain('清空当前空间缓存');expect(html).toContain('导入公开网易歌单');expect(html).toContain('恢复到另一台设备');expect(html).not.toMatch(/UNM|pyncmd|完整 MP3|ID与时长/)
 })
})

describe('compact player source state',()=>{
 it.each<{info?:PlaybackSourceInfo;loading?:boolean;expected:string}>([
  {info:{status:'available',reason:'device_audio_cache:external_source'},expected:'外部音源 · 本机缓存'},
  {info:{status:'available',reason:'device_audio_memory:external_source'},expected:'外部音源 · 本次未保存'},
  {info:{status:'preview',reason:'device_audio_cache:external_source'},expected:'外部音源 · 仅能试听'},
  {info:{status:'unavailable',reason:'device_audio_cache:external_source'},expected:'音源暂不可用'},
  {info:{status:'available',reason:'external_source'},expected:'外部音源 · 直连'},
  {info:{status:'available',reason:'device_audio_cache_not_really_cached'},expected:'外部音源 · 直连'},
  {info:{status:'available',reason:'device_audio_cache:external_source'},loading:true,expected:'正在连接音源…'},
  {info:{status:'available',mediaSource:'netease:account'},loading:true,expected:'正在连接音源…'},
  {info:{status:'available',mediaSource:'netease:account'},expected:'服务器账号 · 直连'},
 ])('renders only the actual state $expected without discarding the full label',async({info,loading,expected})=>{
  const html=await renderToString(createSSRApp(MediaSourceBadge,{info,loading,trackID:'netease:11',compact:true}))
  expect(html.replace(/<[^>]+>/g,'')).toBe(expected)
  expect(html).toMatch(/title="[^"]+"/);expect(html).not.toContain('<details')
 })
 it('never displays previous source details while reconnecting',async()=>{
  const html=await renderToString(createSSRApp(MediaSourceBadge,{info:{mediaSource:'netease:account',status:'available'},loading:true,trackID:'netease:11'}))
  expect(html).toContain('正在连接音源');expect(html).not.toContain('服务器账号');expect(html).not.toContain('<details')
 })
 it('retains the full readable source and optional details outside compact mode',async()=>{
  const html=await renderToString(createSSRApp(MediaSourceBadge,{info:{status:'preview',mediaSource:'unm:pyncmd',reason:'external_source'},trackID:'netease:11'}))
  expect(html).toContain('网易云（第三方连接） · 仅能试听');expect(html).toContain('<details');expect(html).toContain('连接说明')
 })
})
