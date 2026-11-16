import type { PlaybackSourceInfo } from './core'
const sources:Record<string,string>={'unm:pyncmd':'网易云音源','netease:anonymous':'网易云音源','netease:account':'网易云音源'}
export function mediaSourceLabel(info:PlaybackSourceInfo|null|undefined,trackID:string):string {
  if (!info) return '音源尚未连接'
  if (info.status==='unavailable') return '外部音源暂不可用'
  const source=sources[info.mediaSource||''] || (trackID.startsWith('kuwo:')?'酷我音源':'外部音源')
  const local=(prefix:string)=>info.reason===prefix||info.reason?.startsWith(prefix+':')
  const delivery=local('device_audio_cache')?'本机缓存':local('device_audio_memory')?'本次音频未保存':'直连音源'
  if(info.status!=='preview')return `${source} · ${delivery}`
  return `${source} · 仅能试听`
}
// Internal provider identifiers stay in optional diagnostics, outside the default label.
export function mediaSourceDetails(info:PlaybackSourceInfo|null|undefined):string {
  if (!info) return ''
  return [info.mediaSource,info.reason,info.verification].filter(Boolean).join(' · ')
}
