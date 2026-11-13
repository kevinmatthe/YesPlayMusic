import { api, details, trackLyrics, resolveTrack } from './music';
export async function getTrackDetail(ids) {
  const list = Array.isArray(ids) ? ids : String(ids).split(',');
  return { songs: await details(list), privileges: [] };
}
export function getLyric(id) {
  return trackLyrics(id);
}
export function getMP3(id) {
  return resolveTrack(id);
}
export function likeATrack({ id, like = true }) {
  return api(
    '/likes/' + encodeURIComponent(id),
    like ? 'PUT' : 'DELETE',
    like ? {} : undefined
  );
}
export function scrobble({ id, time = 0 }) {
  return api('/history', 'POST', {
    trackID: id,
    positionMs: Math.round(time * 1000),
  });
}
