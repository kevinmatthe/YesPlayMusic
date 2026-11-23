import type { Resolution } from './types';

export function hasVerifiedKuwoMatch(trackID: string, source?: Partial<Resolution>): boolean {
  return trackID.startsWith('netease:') && source?.mediaSource === 'unm:kuwo' &&
    /^kuwo:[1-9][0-9]*$/.test(source.originTrackID || '') &&
    source.matchMethod === 'title_artist_album_duration' && source.verification === 'id_and_duration';
}
