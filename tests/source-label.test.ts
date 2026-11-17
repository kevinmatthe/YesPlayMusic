import { describe, expect, it } from 'vitest'
import { mediaSourceLabel,mediaSourceDetails,mediaSourceOrigin } from '../src/source-label'
describe('readable and truthful playback source labels',()=>{
 it('distinguishes third-party, anonymous and server account connections',()=>{
  expect(mediaSourceLabel({mediaSource:'unm:pyncmd',verification:'id_and_duration'},'netease:11')).toBe('网易云（第三方连接） · 外部直连')
  expect(mediaSourceLabel({mediaSource:'netease:anonymous'},'netease:11')).toBe('网易云（匿名连接） · 外部直连')
  expect(mediaSourceLabel({mediaSource:'netease:account'},'netease:11')).toBe('网易云（服务器账号） · 外部直连')
  expect(mediaSourceOrigin({mediaSource:'netease:account'},'netease:11',true)).toBe('服务器账号')
 })
 it('does not turn diagnostic metadata into a complete audio claim',()=>{
  const info={mediaSource:'unm:pyncmd',originTrackID:'netease:11',matchMethod:'provider_external_id',verification:'id_and_duration',reason:'owned_minio_cache'}
  expect(mediaSourceLabel(info,'netease:11')).not.toMatch(/缓存|完整|已核验|pyncmd/)
  expect(mediaSourceDetails(info)).toContain('pyncmd')
 })
 it('labels previews and unavailable sources honestly',()=>{
  expect(mediaSourceLabel({status:'preview'},'kuwo:11')).toBe('酷我音源 · 仅能试听')
  expect(mediaSourceLabel({status:'unavailable'},'netease:11')).toContain('不可用')
  expect(mediaSourceLabel(null,'netease:11')).toContain('尚未')
 })
 it('does not expose arbitrary provider identifiers in default text',()=>{
  expect(mediaSourceLabel({mediaSource:'<img src=x>',verification:'audio_prefix'},'netease:11')).toBe('外部音源 · 外部直连')
 })
 it('matches only exact cache reason namespaces and keeps preview status first',()=>{
  expect(mediaSourceLabel({status:'available',mediaSource:'unm:pyncmd',reason:'device_audio_cache:external_source'},'netease:11')).toBe('网易云（第三方连接） · 本机缓存')
  expect(mediaSourceLabel({status:'available',reason:'device_audio_memory:external_source'},'kuwo:11')).toBe('酷我音源 · 本次音频未保存')
  expect(mediaSourceLabel({status:'preview',reason:'device_audio_cache:external_source'},'netease:11')).toContain('仅能试听')
  expect(mediaSourceLabel({reason:'device_audio_cache_not_really_cached'},'netease:11')).not.toContain('本机缓存')
 })
})
