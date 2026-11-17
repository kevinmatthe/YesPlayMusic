import type { RecommendationAssociation } from './core/types'

export interface AssociationAttribution { label:string; note:string; url?:string }

/** Attribution is a public metadata page, never an API URL or an audio source. */
function publicSourceURL(raw:unknown,source:RecommendationAssociation['source']):string|undefined {
  if(typeof raw!=='string'||raw.length>2000||raw!==raw.trim()||/[\u0000-\u0020\u007f]/.test(raw))return
  try{
    const decoded=decodeURIComponent(raw)
    if(/(?:^|\/)\.\.?(?:\/|$)/.test(decoded)||/(?:api[_-]?key|token|secret|password)\s*=/i.test(decoded))return
    const url=new URL(raw)
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.search)return
    if(source==='lastfm'){
      if(!['www.last.fm','last.fm'].includes(url.hostname)||url.hash||!/^\/music\/[^/]+(?:\/.*)?$/.test(url.pathname))return
    }else if(url.hostname!=='music.163.com'||url.pathname!=='/'||!/^#\/song\?id=\d+$/.test(url.hash))return
    return url.href
  }catch{return}
}

/** Copy only the supported optional contract, dropping unknown diagnostics. */
export function normalizeAssociation(value:unknown):RecommendationAssociation|undefined {
  if(!value||typeof value!=='object')return
  const row=value as Record<string,unknown>
  if(row.kind!=='similar_song'||(row.source!=='netease'&&row.source!=='lastfm')||typeof row.seedTrackID!=='string'||!row.seedTrackID||row.seedTrackID.length>200)return
  const sourceURL=publicSourceURL(row.sourceURL,row.source)
  return {kind:'similar_song',source:row.source,seedTrackID:row.seedTrackID,...(sourceURL?{sourceURL}:{}),...(typeof row.match==='number'&&Number.isFinite(row.match)?{match:row.match}:{})}
}

export function associationAttribution(value:RecommendationAssociation|undefined):AssociationAttribution|undefined {
  const association=normalizeAssociation(value)
  if(!association)return
  return {label:association.source==='lastfm'?'Last.fm':'网易云音乐',note:'歌曲关联，供发现参考',...(association.sourceURL?{url:association.sourceURL}:{})}
}
