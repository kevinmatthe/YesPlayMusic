import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const fixtures=vi.hoisted(()=>({audio:new EventTarget(),events:[] as string[],unbind:vi.fn(),bind:vi.fn(),dispose:vi.fn(),subscribe:vi.fn(),unsubscribe:vi.fn(),listener:undefined as ((state:{state:string;message:string})=>void)|undefined}))
vi.mock('../src/core',()=>({createPlayer:()=>({audio:fixtures.audio,dispose:fixtures.dispose}),musicApi:{}}))
vi.mock('../src/core/api',()=>({deviceAudioCache:{bindAudio:fixtures.bind,subscribe:fixtures.subscribe}}))
import { useMusic } from '../src/stores/music'
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();fixtures.events=[];fixtures.listener=undefined;fixtures.unbind.mockImplementation(()=>fixtures.events.push('unbind'));fixtures.bind.mockReturnValue(fixtures.unbind);fixtures.dispose.mockImplementation(()=>fixtures.events.push('dispose'));fixtures.subscribe.mockImplementation(listener=>{fixtures.listener=listener;return fixtures.unsubscribe})})
describe('global player cache event integration',()=>{
 it('binds the existing singleton audio and unbinds before its original dispose exactly once',()=>{
  const music=useMusic();expect(fixtures.bind).toHaveBeenCalledExactlyOnceWith(fixtures.audio)
  music.player.dispose();music.$dispose();expect(fixtures.events).toEqual(['unbind','dispose']);expect(fixtures.dispose).toHaveBeenCalledTimes(1)
 })
 it('also releases its media binding when the music store scope is disposed',()=>{
  const music=useMusic();music.$dispose();expect(fixtures.events).toEqual(['unbind','dispose'])
 })
 it('announces background persistence without telling listeners to wait for the first download',()=>{
  const music=useMusic();fixtures.listener?.({state:'streaming',message:'开播无需等待整曲下载。'});expect(music.toast).toBe('')
  fixtures.listener?.({state:'downloading',message:'正在后台校验并保存本机缓存，当前流式播放不受影响。'})
  expect(music.toast).toContain('后台');expect(music.toast).toContain('播放不受影响');expect(music.toast).not.toContain('首次准备');music.player.dispose();expect(fixtures.unsubscribe).toHaveBeenCalledTimes(1)
 })
})
