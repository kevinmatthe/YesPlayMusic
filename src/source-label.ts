import type { PlaybackSourceInfo } from './core'
const sources:Record<string,string>={'unm:pyncmd':'UNM · pyncmd','netease:anonymous':'网易云匿名音源','netease:account':'网易云授权音源'}
export function mediaSourceLabel(info:PlaybackSourceInfo|null|undefined,trackID:string):string {
  const source=sources[info?.mediaSource||'']||'原始音源未知'
  const cached=info?.reason?.startsWith('owned_minio_cache')?' · 自有缓存':''
  let verification='校验信息未知'
  if(info?.originTrackID&&info.originTrackID!==trackID)verification='来源标识未核对'
  else if(info?.verification==='audio_prefix')verification='仅检查音频前缀'
  else if(info?.verification==='id_and_duration'&&info.originTrackID===trackID&&info.matchMethod==='provider_external_id')verification='ID与时长已核对'
  return `${source}${cached} · ${verification}`
}
