import type { MusicApi, Track } from './core'

// Discovery follows the server's bounded candidate pool. A service outage is
// observable, never silently replaced by one hard-coded artist or recording.
export async function loadDiscovery(api: Pick<MusicApi, 'recommendations'>,onUpdate:(tracks:Track[])=>void=()=>{},signal?:AbortSignal): Promise<Track[]> {
  const result=await api.recommendations(8,signal)
  if(signal?.aborted)return []
  const tracks=[...new Map(result.tracks.map(item=>[item.track.id,item.track])).values()]
  onUpdate(tracks)
  return tracks
}
