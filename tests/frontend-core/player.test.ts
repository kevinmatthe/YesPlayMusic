import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlayer,
  type MusicApi,
  type Queue,
  type Track,
} from '../../src/core';
import { parseLrc } from '../../src/core/lyrics';

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 120;
  volume = 1;
  paused = true;
  preload = '';
  error: MediaError | null = null;
  load() {}
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  ready() {
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  fail() {
    this.dispatchEvent(new Event('error'));
  }
  tick(seconds: number) {
    this.currentTime = seconds;
    this.dispatchEvent(new Event('timeupdate'));
  }
}
const track = (id: string): Track => ({
  id,
  source: 'netease',
  externalID: id.split(':')[1],
  title: id,
  artist: 'Artist',
  album: 'Album',
  picture: '',
  durationMs: 120000,
});
const A = track('netease:11'),
  B = track('netease:22'),
  C = track('netease:33');
const empty: Queue = {
  revision: 0,
  trackIDs: [],
  currentIndex: 0,
  positionMs: 0,
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
};
const available = (id: string) => ({
  trackID: id,
  status: 'available' as const,
  url: `https://audio.example/${id}.mp3`,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
function setup(overrides: Partial<MusicApi> = {}) {
  const audio = new FakeAudio();
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const api = {
    ensureGuest: vi
      .fn()
      .mockResolvedValue({
        user: { id: 'guest', kind: 'guest' },
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    queue: vi.fn().mockResolvedValue(empty),
    details: vi.fn(async (ids: string[]) => ids.map(track)),
    resolve: vi.fn(async (id: string) => available(id)),
    lyrics: vi.fn(async (id: string) => ({
      trackID: id,
      lrc: `[00:00]${id}`,
      translatedLrc: '',
    })),
    saveQueue: vi.fn(async (_device: string, q: Queue) => ({
      ...q,
      revision: q.revision + 1,
    })),
    recordHistory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MusicApi;
  const player = createPlayer({
    api,
    audioFactory: () => audio as unknown as HTMLAudioElement,
    storage,
  });
  cleanups.push(() => player.dispose());
  return { player, audio, api, storage };
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(f => f());
  vi.useRealTimers();
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('native single player', () => {
  it('restores the server queue paused and seeks only after metadata', async () => {
    const { player, audio } = setup({
      queue: vi
        .fn()
        .mockResolvedValue({
          revision: 4,
          trackIDs: [A.id, B.id],
          currentIndex: 1,
          positionMs: 17000,
        }),
    });
    await player.initialize();
    expect(player.currentTrack?.id).toBe(B.id);
    expect(player.state.playing).toBe(false);
    expect(audio.currentTime).toBe(0);
    audio.ready();
    await flush();
    expect(audio.currentTime).toBe(17);
    expect(player.state.queueRevision).toBe(4);
  });
  it('discards stale resolve and lyric responses after a track change', async () => {
    const oldResolve = deferred<ReturnType<typeof available>>();
    const oldLyric =
      deferred<{ trackID: string; lrc: string; translatedLrc: string }>();
    const { player, audio } = setup({
      resolve: vi.fn((id: string) =>
        id === A.id ? oldResolve.promise : Promise.resolve(available(id))
      ),
      lyrics: vi.fn((id: string) =>
        id === A.id
          ? oldLyric.promise
          : Promise.resolve({
              trackID: id,
              lrc: '[00:01]correct B',
              translatedLrc: '',
            })
      ),
    });
    await player.initialize();
    const pending = player.playTracks([A, B], 0);
    await flush();
    await player.playAt(1);
    oldResolve.resolve(available(A.id));
    oldLyric.resolve({
      trackID: A.id,
      lrc: '[00:01]STALE A',
      translatedLrc: '',
    });
    await pending;
    await flush();
    expect(player.currentTrack?.id).toBe(B.id);
    expect(audio.src).toContain(B.id);
    expect(player.state.lyricLines.map(l => l.text)).toEqual(['correct B']);
  });
  it('re-resolves once after media error, preserves position and then stops without skipping', async () => {
    const { player, audio, api } = setup();
    await player.initialize();
    await player.playTracks([A, B]);
    audio.ready();
    await flush();
    audio.tick(19);
    audio.fail();
    await flush();
    expect(api.resolve).toHaveBeenCalledTimes(2);
    audio.ready();
    await flush();
    expect(audio.currentTime).toBe(19);
    audio.fail();
    await flush();
    expect(api.resolve).toHaveBeenCalledTimes(2);
    expect(player.currentTrack?.id).toBe(A.id);
    expect(player.state.playing).toBe(false);
    expect(player.state.status).toContain('停止');
  });
  it('honors preview and unavailable results without switching songs', async () => {
    const { player, audio } = setup({
      resolve: vi.fn(async (id: string) =>
        id === A.id
          ? {
              ...available(id),
              status: 'preview' as const,
              reason: 'preview_only',
            }
          : {
              trackID: id,
              status: 'unavailable' as const,
              reason: 'permission_denied',
            }
      ),
    });
    await player.initialize();
    await player.playTracks([A, B]);
    expect(player.state.resolutionStatus).toBe('preview');
    expect(player.state.status).toContain('试听');
    await player.playAt(1);
    expect(player.currentTrack?.id).toBe(B.id);
    expect(player.state.playing).toBe(false);
    expect(player.state.status).toContain('permission_denied');
    expect(audio.src).toBe('');
  });
  it('explains an unavailable official-player-only recording without requesting media or switching tracks', async () => {
    const item={...A,id:'kuwo:5886682',source:'kuwo',externalID:'5886682'};
    const {player,audio}=setup({resolve:vi.fn(async (id:string)=>({trackID:id,status:'unavailable' as const,reason:'provider_preview_requires_official_player'}))});
    await player.initialize();
    await player.playTracks([item,A]);
    expect(player.currentTrack?.id).toBe(item.id);
    expect(audio.src).toBe('');
    expect(player.state.status).toContain('酷我官方播放器');
  });
  it('shows autoplay rejection and remains available for an explicit user retry', async () => {
    const { player, audio } = setup();
    audio.play = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
      )
      .mockImplementationOnce(async () => {
        audio.paused = false;
        audio.dispatchEvent(new Event('play'));
      });
    await player.initialize();
    await player.playTracks([A]);
    audio.ready();
    await flush();
    expect(player.state.playing).toBe(false);
    expect(player.state.status).toContain('点击');
    await player.play();
    expect(player.state.playing).toBe(true);
  });
  it('preserves duplicate occurrences through reorder and current-track removal', async () => {
    const { player } = setup();
    await player.initialize();
    await player.playTracks([A, B, A, C], 2);
    player.move(0, 3);
    expect(player.state.tracks.map(t => t.id)).toEqual([
      B.id,
      A.id,
      C.id,
      A.id,
    ]);
    expect(player.state.currentIndex).toBe(1);
    player.removeAt(0);
    expect(player.state.currentIndex).toBe(0);
    expect(player.currentTrack?.id).toBe(A.id);
    player.removeAt(0);
    await flush();
    expect(player.currentTrack?.id).toBe(C.id);
    expect(player.state.playing).toBe(false);
  });
  it('serializes queue saves and halts writes after revision conflict until reload', async () => {
    const conflict = Object.assign(new Error('revision_conflict'), {
      status: 409,
    });
    const save = vi.fn().mockRejectedValue(conflict);
    const { player, api } = setup({ saveQueue: save });
    await player.initialize();
    await player.playTracks([A]);
    await player.saveQueue();
    expect(player.state.queueConflict).toBe(true);
    const n = save.mock.calls.length;
    player.enqueue(B);
    await player.saveQueue();
    expect(save).toHaveBeenCalledTimes(n);
    expect(api.queue).toHaveBeenCalledTimes(1);
    await player.reloadQueue();
    expect(player.state.queueConflict).toBe(false);
    expect(api.queue).toHaveBeenCalledTimes(2);
  });
  it('does not let a rejected old play promise overwrite the new track', async () => {
    let rejectOld!: (error: Error) => void;
    const oldPlay = new Promise<void>((_, reject) => {
      rejectOld = reject;
    });
    const { player, audio } = setup();
    audio.play = vi
      .fn()
      .mockImplementationOnce(() => oldPlay)
      .mockImplementation(async () => {
        audio.paused = false;
        audio.dispatchEvent(new Event('play'));
      });
    await player.initialize();
    await player.playTracks([A, B]);
    audio.ready();
    await flush();
    await player.playAt(1);
    audio.ready();
    await flush();
    rejectOld(
      Object.assign(new Error('old autoplay denied'), {
        name: 'NotAllowedError',
      })
    );
    await flush();
    expect(player.currentTrack?.id).toBe(B.id);
    expect(player.state.playing).toBe(true);
    expect(player.state.status).not.toContain('点击');
  });
  it('re-resolves an expired paused source and restores its progress before user playback', async () => {
    vi.useFakeTimers();
    const { player, audio, api } = setup();
    await player.initialize();
    await player.playTracks([A]);
    audio.ready();
    await flush();
    audio.tick(23);
    player.pause();
    await vi.advanceTimersByTimeAsync(61000);
    await player.play();
    expect(api.resolve).toHaveBeenCalledTimes(2);
    audio.ready();
    await flush();
    expect(audio.currentTime).toBe(23);
    expect(player.state.playing).toBe(true);
  });
  it('clearly keeps unidentified legacy descriptors in memory without claiming a saved queue', async () => {
    const { player, audio, api } = setup();
    const legacy = {
      ...A,
      id: 'legacy:abc',
      source: 'legacy',
      externalID: 'abc',
    };
    await player.initialize();
    await player.playTracks([legacy]);
    await player.saveQueue();
    expect(api.saveQueue).not.toHaveBeenCalled();
    expect(player.state.status).toContain('当前页面');
    audio.ready();
    await flush();
    expect(player.state.status).toContain('当前页面');
  });
  it('never stores a temporary media URL or session in local storage', async () => {
    const { player, audio, storage } = setup();
    await player.initialize();
    await player.playTracks([A]);
    audio.ready();
    audio.tick(5);
    await player.saveQueue();
    expect(storage.getItem('music-device')).toBeTruthy();
    expect(storage.getItem('music-player')).toBeNull();
  });
});

describe('LRC parser', () => {
  it('normalizes centiseconds, milliseconds and repeated timestamps', () => {
    expect(parseLrc('[00:01.20][00:03.250] hello\n[00:02]middle')).toEqual([
      { timeMs: 1200, text: 'hello' },
      { timeMs: 2000, text: 'middle' },
      { timeMs: 3250, text: 'hello' },
    ]);
  });
});
