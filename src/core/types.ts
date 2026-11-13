export interface Track {
  id: string;
  source: string;
  externalID: string;
  title: string;
  artist: string;
  album: string;
  picture: string;
  durationMs: number;
}
export interface Playlist {
  id: string;
  name: string;
  revision: number;
  tracks: Track[];
}
export interface Queue {
  revision: number;
  trackIDs: string[];
  currentIndex: number;
  positionMs: number;
}
export interface Resolution {
  trackID: string;
  status: 'available' | 'preview' | 'unavailable';
  url?: string;
  expiresAt?: string;
  reason?: string;
}
export interface Lyrics {
  trackID: string;
  lrc: string;
  translatedLrc: string;
}
export interface LyricLine {
  timeMs: number;
  text: string;
  translation?: string;
}
export interface HistoryItem {
  track: Track;
  positionMs: number;
  playedAt: string;
}
export interface Share {
  id: string;
  kind: 'playlist' | 'track';
  targetID: string;
  revoked: boolean;
  expiresAt: string;
}
export interface ExportData {
  format: 'betago-music';
  version: 1;
  playlists: { name: string; tracks: Track[] }[];
  likes: Track[];
}
export interface AuthOptions {
  guest: boolean;
  feishu: { enabled: boolean; appID: string };
}
export interface Session {
  user: { id: string; kind: 'guest' | 'feishu' };
  expiresAt: string;
}
export interface CatalogueSource {
  id: string;
  name: string;
}
export interface CatalogueOptions {
  defaultSource: string;
  sources: CatalogueSource[];
}
export interface MusicApi {
  catalogOptions(): Promise<CatalogueOptions>;
  authOptions(): Promise<AuthOptions>;
  ensureGuest(): Promise<Session>;
  me(): Promise<Session>;
  search(q: string, source?: string): Promise<Track[]>;
  details(ids: string[]): Promise<Track[]>;
  resolve(id: string): Promise<Resolution>;
  lyrics(id: string): Promise<Lyrics>;
  listPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string, trackIDs?: string[]): Promise<Playlist>;
  updatePlaylist(
    p: Playlist,
    trackIDs: string[],
    name?: string
  ): Promise<Playlist>;
  deletePlaylist(p: Playlist): Promise<void>;
  likes(): Promise<Track[]>;
  setLike(id: string, like: boolean): Promise<void>;
  history(): Promise<HistoryItem[]>;
  clearHistory(): Promise<void>;
  recordHistory(id: string, positionMs: number): Promise<void>;
  queue(deviceID: string): Promise<Queue>;
  saveQueue(deviceID: string, q: Queue, keepalive?: boolean): Promise<Queue>;
  shares(): Promise<Share[]>;
  createShare(
    kind: 'playlist' | 'track',
    targetID: string
  ): Promise<{ id: string; token: string }>;
  revokeShare(id: string): Promise<void>;
  shared(token: string): Promise<ExportData>;
  copyShare(token: string): Promise<{ imported: number }>;
  exportData(): Promise<ExportData>;
  importData(data: ExportData): Promise<{ imported: number }>;
  recovery(): Promise<string>;
  recover(code: string): Promise<Session>;
  exchangeFeishu(code: string): Promise<Session>;
  logout(): Promise<void>;
  legacyDescriptor(url: string): Promise<Track>;
}
