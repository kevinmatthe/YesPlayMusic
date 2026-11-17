import type { PlaybackSourceInfo } from './core'
const connections:Record<string,[string,string]>={
 'unm:pyncmd':['网易云（第三方连接）','第三方连接'],
 'netease:anonymous':['网易云（匿名连接）','匿名连接'],
 'netease:account':['网易云（服务器账号）','服务器账号']
}
export function mediaSourceOrigin(info:PlaybackSourceInfo|null|undefined,trackID:string,compact=false):string {
 const connection=connections[info?.mediaSource||'']
 return connection?.[compact?1:0] || (trackID.startsWith('kuwo:')?'酷我音源':'外部音源')
}
export function mediaSourceLabel(info:PlaybackSourceInfo|null|undefined,trackID:string):string {
 if(!info)return '音源尚未连接'
 if(info.status==='unavailable')return '外部音源暂不可用'
 const source=mediaSourceOrigin(info,trackID)
 if(info.status==='preview')return `${source} · 仅能试听`
 const delivery=info.reason?.split(':',1)[0]
 const label=delivery==='device_audio_cache'?'本机缓存':delivery==='device_audio_memory'?'本次音频未保存':'外部直连'
 return `${source} · ${label}`
}
// Raw identifiers remain in optional diagnostics, never interpreted as full audio verification.
export function mediaSourceDetails(info:PlaybackSourceInfo|null|undefined):string {
 if(!info)return ''
 return [info.mediaSource,info.reason,info.verification].filter(Boolean).join(' · ')
}
