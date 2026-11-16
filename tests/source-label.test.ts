import { describe, expect, it } from 'vitest'
import { mediaSourceLabel,mediaSourceDetails } from '../src/source-label'
describe('plain direct source labels',()=>{
 it('shows a readable source and direct delivery without internal claims',()=>{
  const info={mediaSource:'unm:pyncmd',originTrackID:'netease:11',matchMethod:'provider_external_id',verification:'id_and_duration',reason:'owned_minio_cache'}
  const text=mediaSourceLabel(info,'netease:11')
  expect(text).toBe('网易云音源 · 直连音源');expect(text).not.toMatch(/UNM|pyncmd|缓存|核对|完整/)
  expect(mediaSourceDetails(info)).toContain('pyncmd')
 })
 it('labels explicit previews and unavailable sources honestly',()=>{
  expect(mediaSourceLabel({status:'preview'},'kuwo:11')).toBe('酷我音源 · 仅能试听')
  expect(mediaSourceLabel({status:'unavailable'},'netease:11')).toContain('不可用')
  expect(mediaSourceLabel(null,'netease:11')).toContain('尚未')
 })
 it('does not expose arbitrary provider identifiers in default text',()=>{
  expect(mediaSourceLabel({mediaSource:'<img src=x>',verification:'audio_prefix'},'netease:11')).toBe('外部音源 · 直连音源')
 })
})
