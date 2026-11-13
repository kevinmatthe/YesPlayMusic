import { reactive } from 'vue';
import { musicApi } from './api';
import { withTranslation } from './lyrics';
import type { LyricLine, MusicApi, Queue, Resolution, Track } from './types';

type RepeatMode = 'off' | 'all' | 'one';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface PlayerState {
  tracks: Track[];
  currentIndex: number;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  loading: boolean;
  status: string;
  resolutionStatus: string;
  lyricLines: LyricLine[];
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  queueRevision: number;
  queueConflict: boolean;
  ready: boolean;
}
export interface PlayerOptions {
  api?: MusicApi;
  audioFactory?: () => HTMLAudioElement;
  storage?: StorageLike;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const fallbackStorage = (): StorageLike => {
  const memory = new Map<string, string>();
  return {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: key => {
      memory.delete(key);
    },
  };
};
const validIndex = (index: number, length: number) =>
  Math.min(Math.max(0, Math.floor(index) || 0), Math.max(0, length - 1));

export class NativePlayer {
  readonly state = reactive<PlayerState>({
    tracks: [],
    currentIndex: 0,
    positionMs: 0,
    durationMs: 0,
    playing: false,
    loading: false,
    status: '',
    resolutionStatus: '',
    lyricLines: [],
    volume: 0.8,
    repeat: 'off',
    shuffle: false,
    queueRevision: 0,
    queueConflict: false,
    ready: false,
  });
  readonly audio: HTMLAudioElement;
  readonly deviceID: string;
  private readonly api: MusicApi;
  private readonly storage: StorageLike;
  private epoch = 0;
  private resolution: Resolution | undefined;
  private retries = 0;
  private recovering = false;
  private failed = false;
  private metadataReady = false;
  private pendingPosition = 0;
  private playIntent = false;
  private dirty = 0;
  private saved = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | undefined;
  private initialization: Promise<void> | undefined;
  private disposed = false;
  private readonly listeners: Array<[string, EventListener]> = [];
  private readonly hide = () => {
    void this.saveQueue(true);
  };

  constructor(options: PlayerOptions = {}) {
    this.api = options.api ?? musicApi;
    this.storage =
      options.storage ??
      (typeof localStorage === 'undefined' ? fallbackStorage() : localStorage);
    this.audio = options.audioFactory?.() ?? new Audio();
    this.audio.preload = 'metadata';
    this.audio.volume = this.state.volume;
    let device = this.storage.getItem('music-device');
    if (!device) {
      device =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), v =>
              v.toString(16).padStart(2, '0')
            ).join('');
      this.storage.setItem('music-device', device);
    }
    this.deviceID = device;
    this.on('loadedmetadata', () => this.loaded());
    this.on('play', () => {
      this.state.playing = true;
      this.touch();
      this.mediaPosition();
      void this.record();
    });
    this.on('pause', () => {
      this.state.playing = false;
      this.mediaPosition();
    });
    this.on('timeupdate', () => {
      if (this.metadataReady) {
        this.state.positionMs =
          Math.max(0, Number(this.audio.currentTime) || 0) * 1000;
        this.touch();
        this.mediaPosition();
      }
    });
    this.on('durationchange', () => {
      if (
        this.metadataReady &&
        Number.isFinite(this.audio.duration) &&
        this.audio.duration > 0
      )
        this.state.durationMs = this.audio.duration * 1000;
    });
    this.on('error', () => {
      if (!this.failed) void this.recover(this.epoch, this.playIntent);
    });
    this.on('ended', () => {
      this.state.playing = false;
      this.state.positionMs = this.state.durationMs;
      void this.record();
      if (this.state.repeat === 'one') {
        this.seek(0);
        void this.play();
      } else this.next();
    });
    if (typeof window !== 'undefined')
      window.addEventListener('pagehide', this.hide);
    this.mediaHandlers();
  }
  get currentTrack(): Track | null {
    return this.state.tracks[this.state.currentIndex] ?? null;
  }
  private on(name: string, listener: EventListener) {
    this.audio.addEventListener(name, listener);
    this.listeners.push([name, listener]);
  }
  initialize(): Promise<void> {
    return (this.initialization ??= this.initializeOnce());
  }
  private async initializeOnce() {
    try {
      await this.api.ensureGuest();
      await this.loadQueue();
    } catch (error) {
      this.state.status = '恢复音乐空间失败：' + message(error);
    } finally {
      this.state.ready = true;
    }
  }
  private async loadQueue() {
    const q = await this.api.queue(this.deviceID);
    const tracks = q.trackIDs.length ? await this.api.details(q.trackIDs) : [];
    if (this.disposed) return;
    this.state.tracks = tracks;
    this.state.currentIndex = validIndex(q.currentIndex, tracks.length);
    this.state.queueRevision = q.revision;
    this.dirty = 0;
    this.saved = 0;
    this.state.queueConflict = false;
    if (tracks.length)
      await this.select(this.state.currentIndex, false, q.positionMs);
    else this.resetAudio();
  }
  async reloadQueue() {
    this.pause();
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.saving) await this.saving;
    this.epoch++;
    this.state.ready = false;
    try {
      await this.loadQueue();
      this.state.status =
        this.state.resolutionStatus === 'preview' ? '当前音源仅可试听' : '';
    } catch (error) {
      this.state.status = '载入服务器队列失败：' + message(error);
    } finally {
      this.state.ready = true;
    }
  }
  async playTracks(tracks: Track[], startIndex = 0) {
    if (!tracks.length) {
      this.clear();
      return;
    }
    this.state.tracks = tracks.slice();
    this.state.currentIndex = validIndex(startIndex, tracks.length);
    this.state.positionMs = 0;
    this.touch();
    await this.select(this.state.currentIndex, true, 0);
  }
  async playAt(index: number) {
    if (index < 0 || index >= this.state.tracks.length) return;
    this.state.currentIndex = index;
    this.state.positionMs = 0;
    this.touch();
    await this.select(index, true, 0);
  }
  private async select(index: number, autoplay: boolean, positionMs: number) {
    const track = this.state.tracks[index];
    if (!track) return;
    const epoch = ++this.epoch;
    this.resetAudio(false);
    this.retries = 0;
    this.recovering = false;
    this.failed = false;
    this.resolution = undefined;
    this.pendingPosition = Math.max(0, positionMs);
    this.state.positionMs = this.pendingPosition;
    this.state.durationMs = track.durationMs;
    this.playIntent = autoplay;
    this.state.loading = true;
    this.state.status = '正在解析音源…';
    this.state.resolutionStatus = '';
    this.state.lyricLines = [];
    this.mediaMetadata(track);
    void this.api
      .lyrics(track.id)
      .then(lyrics => {
        if (epoch === this.epoch && lyrics.trackID === this.currentTrack?.id)
          this.state.lyricLines = withTranslation(
            lyrics.lrc,
            lyrics.translatedLrc
          );
      })
      .catch(() => {
        /* Lyrics failure does not interrupt audio or replace a newer track's lines. */
      });
    try {
      const resolution = await this.api.resolve(track.id);
      if (epoch !== this.epoch || this.disposed) return;
      if (resolution.trackID !== track.id)
        throw new Error('音源标识与当前歌曲不一致');
      if (resolution.status === 'unavailable' || !resolution.url) {
        this.unavailable(resolution.reason || '当前音源不可用');
        return;
      }
      this.resolution = resolution;
      if (this.expired(resolution)) {
        await this.recover(epoch, autoplay);
        return;
      }
      this.loadAudio(resolution, this.pendingPosition, autoplay);
    } catch (error) {
      if (epoch === this.epoch)
        this.unavailable('音源解析失败：' + message(error));
    }
  }
  private expired(resolution: Resolution) {
    const at = Date.parse(resolution.expiresAt || '');
    return !Number.isFinite(at) || at <= Date.now();
  }
  private loadAudio(
    resolution: Resolution,
    positionMs: number,
    autoplay: boolean
  ) {
    this.resolution = resolution;
    this.pendingPosition = positionMs;
    this.playIntent = autoplay;
    this.metadataReady = false;
    this.state.loading = true;
    this.state.resolutionStatus = resolution.status;
    this.state.status =
      resolution.status === 'preview' ? '当前音源仅可试听' : '';
    this.audio.src = resolution.url!;
    this.audio.load();
  }
  private loaded() {
    if (!this.resolution || this.failed || this.disposed) return;
    if (
      this.audio.currentSrc &&
      new URL(
        this.audio.currentSrc,
        typeof location === 'undefined'
          ? 'https://local.invalid'
          : location.href
      ).href !==
        new URL(
          this.resolution.url!,
          typeof location === 'undefined'
            ? 'https://local.invalid'
            : location.href
        ).href
    )
      return;
    this.metadataReady = true;
    this.state.loading = false;
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0)
      this.state.durationMs = this.audio.duration * 1000;
    const maximum = Math.max(0, this.state.durationMs - 100);
    const position = Math.min(Math.max(0, this.pendingPosition), maximum);
    try {
      this.audio.currentTime = position / 1000;
    } catch {
      this.state.status = '当前音源无法恢复播放位置';
    }
    this.state.positionMs = position;
    this.mediaPosition();
    if (this.playIntent) void this.startAudio();
  }
  private async startAudio() {
    const epoch = this.epoch;
    try {
      await this.audio.play();
      if (epoch !== this.epoch || this.disposed) return;
      if (!this.audio.paused) {
        this.state.playing = true;
        if (
          this.state.status.startsWith('浏览器未允许自动播放') ||
          this.state.status.startsWith('播放失败，请点击播放按钮重试')
        )
          this.state.status =
            this.state.resolutionStatus === 'preview' ? '当前音源仅可试听' : '';
      }
      this.mediaPosition();
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      this.state.playing = false;
      this.state.status =
        (error as { name?: string })?.name === 'NotAllowedError'
          ? '浏览器未允许自动播放，请点击播放按钮继续。'
          : '播放失败，请点击播放按钮重试：' + message(error);
    }
  }
  private async recover(epoch: number, autoplay: boolean) {
    if (epoch !== this.epoch || this.recovering || this.disposed) return;
    if (this.retries >= 1) {
      this.failed = true;
      this.playIntent = false;
      this.audio.pause();
      this.state.playing = false;
      this.state.loading = false;
      this.state.status = '音源加载失败，已停止重试。可以手动重试当前歌曲。';
      return;
    }
    const track = this.currentTrack;
    if (!track) return;
    const position = this.metadataReady
      ? Math.max(0, Number(this.audio.currentTime) || 0) * 1000
      : this.state.positionMs;
    this.retries++;
    this.recovering = true;
    this.audio.pause();
    this.metadataReady = false;
    this.state.positionMs = position;
    this.state.loading = true;
    this.state.status = '音源已失效，正在重新解析…';
    try {
      const next = await this.api.resolve(track.id);
      if (epoch !== this.epoch || this.disposed) return;
      if (
        next.trackID !== track.id ||
        next.status === 'unavailable' ||
        !next.url ||
        this.expired(next)
      ) {
        this.unavailable(next.reason || '音源不可用，已停止重试');
        return;
      }
      this.loadAudio(next, position, autoplay);
    } catch (error) {
      if (epoch === this.epoch)
        this.unavailable('恢复音源失败，已停止重试：' + message(error));
    } finally {
      if (epoch === this.epoch) this.recovering = false;
    }
  }
  private unavailable(reason: string) {
    this.failed = true;
    this.state.loading = false;
    this.state.playing = false;
    this.state.resolutionStatus = 'unavailable';
    const messages: Record<string, string> = {
      provider_preview_requires_official_player: '这首歌需要在酷我官方播放器中试听或播放，当前网页无法提供音源。',
      provider_access_denied: '当前来源不允许播放这首歌。',
      anonymous_source_unavailable_or_restricted: '当前音源不可用或受限，请选择其他歌曲或来源。',
      insecure_audio_https_unavailable: '音源暂时无法通过 HTTPS 安全读取，请稍后重试。',
      source_not_supported: '暂不支持这个歌曲来源。',
      source_not_configured: '这个音源尚未配置。',
    };
    this.state.status = messages[reason] || (reason.startsWith('source_mismatch:') ? '音源返回了其他来源的文件，已停止播放。' : reason);
    this.playIntent = false;
    this.resetAudio(false);
  }
  async play() {
    if (!this.currentTrack) return;
    this.playIntent = true;
    if (this.failed || !this.resolution) {
      await this.select(this.state.currentIndex, true, this.state.positionMs);
      return;
    }
    if (this.expired(this.resolution)) {
      await this.recover(this.epoch, true);
      return;
    }
    if (this.metadataReady) await this.startAudio();
  }
  pause() {
    this.playIntent = false;
    this.audio.pause();
    this.state.playing = false;
    this.touch();
    void this.saveQueue();
    void this.record();
  }
  toggle() {
    return this.state.playing ? (this.pause(), Promise.resolve()) : this.play();
  }
  async retry() {
    if (this.currentTrack)
      await this.select(this.state.currentIndex, true, this.state.positionMs);
  }
  next() {
    if (!this.state.tracks.length) return;
    let next = this.state.currentIndex + 1;
    if (this.state.shuffle && this.state.tracks.length > 1) {
      const options = this.state.tracks
        .map((_, i) => i)
        .filter(i => i !== this.state.currentIndex);
      next = options[Math.floor(Math.random() * options.length)]!;
    }
    if (next >= this.state.tracks.length) {
      if (this.state.repeat === 'all') next = 0;
      else {
        this.pause();
        if (this.state.resolutionStatus === 'preview')
          this.state.status = '试听片段已结束';
        return;
      }
    }
    void this.playAt(next);
  }
  previous() {
    if (!this.state.tracks.length) return;
    if (this.state.positionMs > 3000) {
      this.seek(0);
      return;
    }
    const previous =
      this.state.currentIndex > 0
        ? this.state.currentIndex - 1
        : this.state.repeat === 'all'
        ? this.state.tracks.length - 1
        : 0;
    void this.playAt(previous);
  }
  seek(ms: number) {
    const position = Math.min(
      Math.max(0, Number(ms) || 0),
      Math.max(0, this.state.durationMs - 100)
    );
    this.pendingPosition = position;
    this.state.positionMs = position;
    if (this.metadataReady) {
      try {
        this.audio.currentTime = position / 1000;
      } catch {
        /* Keep desired position for next metadata event. */
      }
    }
    this.touch();
    this.mediaPosition();
  }
  setVolume(value: number) {
    this.state.volume = Math.min(1, Math.max(0, value));
    this.audio.volume = this.state.volume;
  }
  setRepeat(mode: RepeatMode) {
    this.state.repeat = mode;
  }
  setShuffle(value: boolean) {
    this.state.shuffle = value;
  }
  enqueue(track: Track) {
    const first = !this.state.tracks.length;
    this.state.tracks.push(track);
    if (first) {
      this.state.currentIndex = 0;
      void this.select(0, false, 0);
    }
    this.touch();
  }
  removeAt(index: number) {
    if (index < 0 || index >= this.state.tracks.length) return;
    const current = this.state.currentIndex;
    const active = index === current;
    if (active) this.pause();
    this.state.tracks.splice(index, 1);
    if (!this.state.tracks.length) {
      this.clear();
      return;
    }
    this.state.currentIndex = active
      ? Math.min(current, this.state.tracks.length - 1)
      : index < current
      ? current - 1
      : current;
    if (active) {
      this.state.positionMs = 0;
      void this.select(this.state.currentIndex, false, 0);
    }
    this.touch();
  }
  move(from: number, to: number) {
    if (
      from < 0 ||
      to < 0 ||
      from >= this.state.tracks.length ||
      to >= this.state.tracks.length ||
      from === to
    )
      return;
    const current = this.state.currentIndex;
    const [track] = this.state.tracks.splice(from, 1);
    this.state.tracks.splice(to, 0, track!);
    this.state.currentIndex =
      from === current
        ? to
        : from < current && to >= current
        ? current - 1
        : from > current && to <= current
        ? current + 1
        : current;
    this.touch();
  }
  clear() {
    this.epoch++;
    this.playIntent = false;
    this.resetAudio();
    this.resolution = undefined;
    this.state.tracks = [];
    this.state.currentIndex = 0;
    this.state.status = '';
    this.state.resolutionStatus = '';
    this.state.lyricLines = [];
    this.touch();
    void this.saveQueue();
  }
  async loadLegacy(url: string) {
    const track = await this.api.legacyDescriptor(url);
    await this.playTracks([track]);
  }
  private resetAudio(resetPosition = true) {
    this.audio.pause();
    this.metadataReady = false;
    this.audio.removeAttribute('src');
    this.audio.load();
    if (resetPosition) {
      this.state.positionMs = 0;
      this.state.durationMs = 0;
    }
    this.state.playing = false;
    try {
      this.audio.currentTime = 0;
    } catch {
      /* Some browsers reject seeking before metadata. */
    }
  }
  private touch() {
    this.dirty++;
    if (!this.state.ready || this.state.queueConflict || this.disposed) return;
    if (this.timer === undefined)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.saveQueue();
      }, 1500);
  }
  async saveQueue(keepalive = false): Promise<void> {
    if (!this.state.ready || this.state.queueConflict || this.disposed) return;
    if (this.saving) {
      await this.saving;
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.state.tracks.some(track => track.source === 'legacy')) {
      this.state.status = '旧卡片缺少曲库标识，当前队列只在当前页面保留。';
      return;
    }
    const version = this.dirty;
    const snapshot: Queue = {
      revision: this.state.queueRevision,
      trackIDs: this.state.tracks.map(t => t.id),
      currentIndex: this.state.tracks.length ? this.state.currentIndex : 0,
      positionMs: this.state.tracks.length
        ? Math.max(0, Math.round(this.state.positionMs))
        : 0,
    };
    this.saving = (async () => {
      try {
        const saved = await this.api.saveQueue(
          this.deviceID,
          snapshot,
          keepalive
        );
        this.state.queueRevision = saved.revision;
        this.saved = version;
      } catch (error) {
        if ((error as { status?: number }).status === 409) {
          this.state.queueConflict = true;
          this.state.status =
            '队列已在其他窗口更新。请重新载入服务器队列后继续编辑。';
        } else if (!this.state.status)
          this.state.status = '队列保存失败：' + message(error);
      } finally {
        this.saving = undefined;
        if (
          this.dirty > this.saved &&
          !this.state.queueConflict &&
          !this.disposed &&
          this.timer === undefined
        )
          this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.saveQueue();
          }, 1500);
      }
    })();
    await this.saving;
  }
  private async record() {
    const track = this.currentTrack;
    if (!track || !this.state.ready) return;
    try {
      await this.api.recordHistory(track.id, this.state.positionMs);
    } catch {
      /* History availability must not interrupt current playback. */
    }
  }
  private mediaHandlers() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator))
      return;
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      [
        'play',
        () => {
          void this.play();
        },
      ],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.previous()],
      ['nexttrack', () => this.next()],
      ['stop', () => this.pause()],
      ['seekto', d => this.seek((d.seekTime ?? 0) * 1000)],
      [
        'seekbackward',
        d => this.seek(this.state.positionMs - (d.seekOffset ?? 10) * 1000),
      ],
      [
        'seekforward',
        d => this.seek(this.state.positionMs + (d.seekOffset ?? 10) * 1000),
      ],
    ];
    for (const [name, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {
        /* Unsupported action on this browser. */
      }
    }
  }
  private mediaMetadata(track: Track) {
    if (typeof document !== 'undefined')
      document.title = track.title + ' · BetaGo Music';
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      typeof MediaMetadata === 'undefined'
    )
      return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.picture ? [{ src: track.picture }] : [],
      });
    } catch {
      /* Metadata support varies across embedded clients. */
    }
  }
  private mediaPosition() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator))
      return;
    navigator.mediaSession.playbackState = this.state.playing
      ? 'playing'
      : 'paused';
    if (this.state.durationMs > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.state.durationMs / 1000,
          position:
            Math.min(this.state.positionMs, this.state.durationMs) / 1000,
          playbackRate: 1,
        });
      } catch {
        /* Not every platform implements position state. */
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.epoch++;
    clearTimeout(this.timer);
    for (const [name, listener] of this.listeners)
      this.audio.removeEventListener(name, listener);
    this.audio.pause();
    this.audio.removeAttribute('src');
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', this.hide);
  }
}
export function createPlayer(options: PlayerOptions = {}): NativePlayer {
  return new NativePlayer(options);
}
