import { describe, expect, it } from 'vitest'
import { mediaSourceLabel } from '../src/source-label'
describe('cautious media-source labels',()=>{
 it('keeps original UNM source visible alongside own cache and the actual verification scope',()=>{
  const text=mediaSourceLabel({mediaSource:'unm:pyncmd',originTrackID:'netease:11',matchMethod:'provider_external_id',verification:'id_and_duration',reason:'owned_minio_cache'},'netease:11')
  expect(text).toContain('UNM');expect(text).toContain('pyncmd');expect(text).toContain('缓存');expect(text).toContain('ID与时长已核对');expect(text).not.toContain('同录音已验证')
 })
 it('does not turn a prefix-only probe into recording verification',()=>{
  const text=mediaSourceLabel({mediaSource:'netease:anonymous',originTrackID:'netease:11',verification:'audio_prefix'},'netease:11')
  expect(text).toContain('仅检查音频前缀');expect(text).not.toContain('已验证')
 })
 it('does not expose unknown raw strings or label a mismatched identity as verified',()=>{
  const text=mediaSourceLabel({mediaSource:'<img src=x onerror=alert(1)>',originTrackID:'kuwo:11',matchMethod:'provider_external_id',verification:'id_and_duration'},'netease:11')
  expect(text).not.toContain('<img');expect(text).not.toContain('ID与时长已核对');expect(text).toContain('未核对')
  expect(mediaSourceLabel(null,'netease:11')).toContain('未知')
 })
})
