import type { PlaybackSourceInfo } from './core'
const sources:Record<string,string>={'unm:pyncmd':'网易云音源','netease:anonymous':'网易云音源','netease:account':'网易云音源'}
export function mediaSourceLabel(info:PlaybackSourceInfo|null|undefined,trackID:string):string {
  if (!info) return '音源尚未连接'
  if (info.status==='unavailable') return '外部音源暂不可用'
  const source=sources[info.mediaSource||''] || (trackID.startsWith('kuwo:')?'酷我音源':'外部音源')
  return `${source} · ${info.status==='preview'?'仅能试听':'直连音源'}`
}
// Internal provider identifiers stay in optional diagnostics, outside the default label.
export function mediaSourceDetails(info:PlaybackSourceInfo|null|undefined):string {
  if (!info) return ''
  return [info.mediaSource,info.reason,info.verification].filter(Boolean).join(' · ')
}
