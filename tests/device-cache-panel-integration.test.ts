import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
vi.mock('../src/stores/music',()=>({useMusic:()=>({identityMessage:'',userKind:'guest',feishuEnabled:false,inFeishu:false,error:''})}))
vi.mock('../src/stores/overlay',()=>({useOverlay:()=>({kind:'transfer',close:()=>{}})}))
import Dialogs from '../src/ui/Dialogs.vue'
describe('cache settings inside the existing backup dialog',()=>{
 it('mounts the actual settings panel together with the existing import and recovery controls',async()=>{
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<span/>'}}]});await router.push('/')
  const context:{teleports?:Record<string,string>}={};await renderToString(createSSRApp(Dialogs).use(router),context)
  const html=context.teleports?.body??''
  expect(html).toContain('本机音频缓存');expect(html).toContain('自动缓存完整歌曲');expect(html).toContain('清空当前空间缓存');expect(html).toContain('导入公开网易歌单');expect(html).toContain('恢复到另一台设备');expect(html).not.toMatch(/UNM|pyncmd|完整 MP3|ID与时长/)
 })
})
