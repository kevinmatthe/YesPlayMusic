import type { MusicApi, Track } from './core'

// A small editorial starting point; every title/artist/ID still comes from the provider.
// Search remains available independently of this recording and its current rights.
export async function loadDiscovery(api: Pick<MusicApi, 'details'|'search'>,onUpdate:(tracks:Track[])=>void=()=>{}): Promise<Track[]> {
  const slots:Track[][]=[[],[]]
  function collect(){const tracks=new Map<string,Track>();for(const slot of slots)for(const track of slot)if(!tracks.has(track.id))tracks.set(track.id,track);return [...tracks.values()].slice(0,8)}
  await Promise.allSettled([
    api.details(['netease:347230']),
    api.search('Beyond'),
  ].map(async(request,index)=>{slots[index]=await request;onUpdate(collect())}))
  const tracks=collect()
  if(!tracks.length) throw new Error('曲库暂时无法连接，请稍后重试或搜索其他歌曲。')
  return tracks
}
