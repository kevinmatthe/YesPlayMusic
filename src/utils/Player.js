import {
  api,
  ensureSession,
  details,
  resolveTrack,
  deviceID,
} from '@/api/music';
import { getAlbum } from '@/api/album';
import { getArtist } from '@/api/artist';
import { fmTrash, personalFM } from '@/api/others';
import { getPlaylistDetail, intelligencePlaylist } from '@/api/playlist';
import { getLyric } from '@/api/track';
import store from '@/store';
import { isCreateMpris, isCreateTray } from '@/utils/platform';
import { Howl } from 'howler';
import shuffle from 'lodash/shuffle';

const INDEX_IN_PLAY_NEXT = -1;

/**
 * @readonly
 * @enum {string}
 */
const UNPLAYABLE_CONDITION = {
  PLAY_NEXT_TRACK: 'playNextTrack',
  PLAY_PREV_TRACK: 'playPrevTrack',
};

const electron =
  process.env.IS_ELECTRON === true ? window.require('electron') : null;
const ipcRenderer =
  process.env.IS_ELECTRON === true ? electron.ipcRenderer : null;
const delay = ms =>
  new Promise(resolve => {
    setTimeout(() => {
      resolve('');
    }, ms);
  });
function setTitle(track) {
  document.title = track
    ? `${track.name} · ${track.ar[0].name} - BetaGo Music`
    : 'BetaGo Music';
  if (isCreateTray) {
    ipcRenderer?.send('updateTrayTooltip', document.title);
  }
  store.commit('updateTitle', document.title);
}

function setTrayLikeState(isLiked) {
  if (isCreateTray) {
    ipcRenderer?.send('updateTrayLikeState', isLiked);
  }
}

export default class {
  constructor() {
    // 播放器状态
    this._playing = false; // 是否正在播放中
    this._progress = 0; // 当前播放歌曲的进度
    this._enabled = false; // 是否启用Player
    this._repeatMode = 'off'; // off | on | one
    this._shuffle = false; // true | false
    this._reversed = false;
    this._volume = 1; // 0 to 1
    this._volumeBeforeMuted = 1; // 用于保存静音前的音量
    this._personalFMLoading = false; // 是否正在私人FM中加载新的track
    this._personalFMNextLoading = false; // 是否正在缓存私人FM的下一首歌曲

    // 播放信息
    this._list = []; // 播放列表
    this._current = 0; // 当前播放歌曲在播放列表里的index
    this._shuffledList = []; // 被随机打乱的播放列表，随机播放模式下会使用此播放列表
    this._shuffledCurrent = 0; // 当前播放歌曲在随机列表里面的index
    this._playlistSource = { type: 'music', id: '' }; // 当前播放列表的信息
    this._currentTrack = {
      id: '',
      name: '',
      ar: [{ name: '' }],
      al: { id: 0, name: '', picUrl: '' },
      dt: 0,
    }; // 当前播放歌曲的详细信息
    this._playNextList = []; // 当这个list不为空时，会优先播放这个list的歌
    this._isPersonalFM = false; // 是否是私人FM模式
    this._personalFMTrack = { id: 0 }; // 私人FM当前歌曲
    this._personalFMNextTrack = {
      id: 0,
    }; // 私人FM下一首歌曲信息（为了快速加载下一首）

    /**
     * The blob records for cleanup.
     *
     * @private
     * @type {string[]}
     */
    this.createdBlobRecords = [];

    // howler (https://github.com/goldfire/howler.js)
    this._howler = null;
    Object.defineProperty(this, '_howler', {
      enumerable: false,
    });

    // init
    this._init();

    window.yesplaymusic = {};
    window.yesplaymusic.player = this;
  }

  get repeatMode() {
    return this._repeatMode;
  }
  set repeatMode(mode) {
    if (this._isPersonalFM) return;
    if (!['off', 'on', 'one'].includes(mode)) {
      console.warn("repeatMode: invalid args, must be 'on' | 'off' | 'one'");
      return;
    }
    this._repeatMode = mode;
  }
  get shuffle() {
    return this._shuffle;
  }
  set shuffle(shuffle) {
    if (this._isPersonalFM) return;
    if (shuffle !== true && shuffle !== false) {
      console.warn('shuffle: invalid args, must be Boolean');
      return;
    }
    this._shuffle = shuffle;
    if (shuffle) {
      this._shuffleTheList();
    }
  }
  get reversed() {
    return this._reversed;
  }
  set reversed(reversed) {
    if (this._isPersonalFM) return;
    if (reversed !== true && reversed !== false) {
      console.warn('reversed: invalid args, must be Boolean');
      return;
    }
    console.log('changing reversed to:', reversed);
    this._reversed = reversed;
  }
  get volume() {
    return this._volume;
  }
  set volume(volume) {
    this._volume = volume;
    this._howler?.volume(volume);
  }
  get list() {
    return this.shuffle ? this._shuffledList : this._list;
  }
  set list(list) {
    this._list = list;
  }
  get current() {
    return this.shuffle ? this._shuffledCurrent : this._current;
  }
  set current(current) {
    if (this.shuffle) {
      this._shuffledCurrent = current;
    } else {
      this._current = current;
    }
  }
  get enabled() {
    return this._enabled;
  }
  get playing() {
    return this._playing;
  }
  get currentTrack() {
    return this._currentTrack;
  }
  get currentTrackID() {
    return this._currentTrack?.id ?? 0;
  }
  get playlistSource() {
    return this._playlistSource;
  }
  get playNextList() {
    return this._playNextList;
  }
  get isPersonalFM() {
    return this._isPersonalFM;
  }
  get personalFMTrack() {
    return this._personalFMTrack;
  }
  get currentTrackDuration() {
    if (this._currentTrack == null) {
      this.setDefault();
    }
    const trackDuration = this._currentTrack.dt || 1000;
    let duration = ~~(trackDuration / 1000);
    return duration > 1 ? duration - 1 : duration;
  }
  get progress() {
    return this._progress;
  }
  set progress(value) {
    if (this._howler) {
      this._howler.seek(value);
      if (isCreateMpris) {
        ipcRenderer?.send('seeked', this._howler.seek());
      }
    }
  }
  get isCurrentTrackLiked() {
    return store.state.liked.songs.includes(this.currentTrack.id);
  }

  _init() {
    this._musicReady = false;
    this._loadEpoch = 0;
    this._queueRevision = 0;
    this._queueDirty = false;
    this._syncing = false;
    this._queueConflict = false;
    this._status = '';
    this._initMediaSession();
    this._setIntervals();
    window.addEventListener('pagehide', () => this.saveQueue(true));
    this.ready = this.restoreQueue();
  }
  async restoreQueue() {
    try {
      await ensureSession();
      const q = await api('/queue/' + deviceID());
      this._queueRevision = q.revision;
      this._list = q.trackIDs;
      this._current = q.currentIndex;
      this._playNextList = [];
      if (q.trackIDs.length)
        await this._replaceCurrentTrack(
          q.trackIDs[q.currentIndex],
          false,
          undefined,
          q.positionMs / 1000
        );
      this._musicReady = true;
    } catch (e) {
      this._status = '恢复失败：' + e.message;
    }
  }
  async saveQueue(force = false) {
    if (
      !this._musicReady ||
      this._queueConflict ||
      this._syncing ||
      (!this._queueDirty && !force)
    )
      return;
    this._syncing = true;
    this._queueDirty = false;
    try {
      const q = await api('/queue/' + deviceID(), 'PUT', {
        revision: this._queueRevision,
        trackIDs: this.list,
        currentIndex: Math.max(0, this.current),
        positionMs: this.list.length
          ? Math.round((this.seek() || this._progress || 0) * 1000)
          : 0,
      });
      this._queueRevision = q.revision;
    } catch (e) {
      if (e.status === 409) this._queueConflict = true;
      this._status = '队列保存失败：' + e.message;
      this._queueDirty = true;
    } finally {
      this._syncing = false;
    }
  }
  async reloadQueue() {
    this.pause();
    this._musicReady = false;
    this._queueConflict = false;
    await this.restoreQueue();
  }
  editQueue(ids, index = this.current) {
    this._list = ids.slice();
    this._shuffledList = [];
    this._shuffle = false;
    this.current = Math.min(Math.max(index, 0), Math.max(0, ids.length - 1));
    this._queueDirty = true;
    this.saveQueue(true);
  }
  setDefault() {
    this._currentTrack = {
      id: '',
      name: '',
      ar: [{ name: '' }],
      al: { id: 0, name: '', picUrl: '' },
      dt: 0,
    };
  }
  _setPlaying(isPlaying) {
    this._playing = isPlaying;
    if ('mediaSession' in navigator)
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    if (isCreateTray) {
      ipcRenderer?.send('updateTrayPlayState', this._playing);
    }
  }
  _setIntervals() {
    let ticks = 0;
    setInterval(() => {
      if (this._howler && this._howler.state() === 'loaded') {
        this._progress = Number(this._howler.seek()) || 0;
        if (this._playing) this._queueDirty = true;
      }
      if (++ticks % 3 === 0) this.saveQueue();
      if (this._playing) this._updateMediaSessionPositionState();
    }, 1000);
  }
  _getNextTrack() {
    const next = this._reversed ? this.current - 1 : this.current + 1;

    if (this._playNextList.length > 0) {
      let trackID = this._playNextList[0];
      return [trackID, INDEX_IN_PLAY_NEXT];
    }

    // 循环模式开启，则重新播放当前模式下的相对的下一首
    if (this.repeatMode === 'on') {
      if (this._reversed && this.current === 0) {
        // 倒序模式，当前歌曲是第一首，则重新播放列表最后一首
        return [this.list[this.list.length - 1], this.list.length - 1];
      } else if (this.list.length === this.current + 1) {
        // 正序模式，当前歌曲是最后一首，则重新播放第一首
        return [this.list[0], 0];
      }
    }

    // 返回 [trackID, index]
    return [this.list[next], next];
  }
  _getPrevTrack() {
    const next = this._reversed ? this.current + 1 : this.current - 1;

    // 循环模式开启，则重新播放当前模式下的相对的下一首
    if (this.repeatMode === 'on') {
      if (this._reversed && this.current === 0) {
        // 倒序模式，当前歌曲是最后一首，则重新播放列表第一首
        return [this.list[0], 0];
      } else if (this.list.length === this.current + 1) {
        // 正序模式，当前歌曲是第一首，则重新播放列表最后一首
        return [this.list[this.list.length - 1], this.list.length - 1];
      }
    }

    // 返回 [trackID, index]
    return [this.list[next], next];
  }
  async _shuffleTheList(firstTrackID = this.currentTrackID) {
    let list = this._list.filter(tid => tid !== firstTrackID);
    if (firstTrackID === 'first') list = this._list;
    this._shuffledList = shuffle(list);
    if (firstTrackID !== 'first') this._shuffledList.unshift(firstTrackID);
  }
  async _scrobble(track, time) {
    if (!track?.id || !this._musicReady) return;
    try {
      await api('/history', 'POST', {
        trackID: track.id,
        positionMs: Math.max(0, Math.round((time || 0) * 1000)),
      });
    } catch (e) {
      this._status = '历史记录保存失败：' + e.message;
    }
  }
  _playAudioSource(
    source,
    autoplay = true,
    position = 0,
    epoch = this._loadEpoch
  ) {
    this._howler?.unload();
    const audio = new Howl({
      src: [source],
      html5: true,
      preload: true,
      format: ['mp3', 'flac', 'wav', 'm4a', 'ogg'],
      onload: () => {
        if (epoch !== this._loadEpoch) return;
        audio.seek(Math.min(position, Math.max(0, audio.duration() - 0.1)));
        this._progress = position;
        if (autoplay) this.play();
      },
      onplay: () => {
        if (epoch !== this._loadEpoch) return;
        this._setPlaying(true);
        setTitle(this.currentTrack);
        this._enabled = true;
        this._queueDirty = true;
        this._updateMediaSessionPositionState();
      },
      onpause: () => this._setPlaying(false),
      onend: () => {
        if (epoch === this._loadEpoch) this._nextTrackCallback();
      },
      onloaderror: () => this._recoverSource(epoch, autoplay),
      onplayerror: () => {
        if (epoch !== this._loadEpoch) return;
        this._setPlaying(false);
        this._status = '浏览器未允许播放，请点击播放按钮重试';
      },
    });
    this._howler = audio;
  }
  async _recoverSource(epoch, autoplay) {
    if (epoch !== this._loadEpoch) return;
    const position = this._progress || 0;
    if (this._sourceRetries >= 1) {
      this._setPlaying(false);
      this._sourceFailed = true;
      this._status = '音源加载失败，已停止重试。可手动重新播放当前歌曲。';
      return;
    }
    this._sourceRetries++;
    this._status = '重新解析音源…';
    try {
      const res = await resolveTrack(this.currentTrackID);
      if (epoch !== this._loadEpoch) return;
      if (
        !res.url ||
        res.status === 'unavailable' ||
        Date.parse(res.expiresAt) <= Date.now()
      )
        throw new Error(res.reason || '音源不可用');
      this._resolution = res;
      this._status = res.status === 'preview' ? '当前音源仅可试听' : '';
      this._playAudioSource(res.url, autoplay, position, epoch);
    } catch (e) {
      if (epoch === this._loadEpoch) {
        this._setPlaying(false);
        this._status = '无法恢复音源：' + e.message;
      }
    }
  }
  async _getAudioSource(track) {
    const res = await resolveTrack(track.id);
    this._resolution = res;
    return res.url;
  }
  async _replaceCurrentTrack(id, autoplay = true, unused, position = 0) {
    const epoch = ++this._loadEpoch;
    this._sourceRetries = 0;
    this._sourceFailed = false;
    this._status = '正在解析音源…';
    this._howler?.unload();
    this._howler = null;
    this._setPlaying(false);
    this._progress = position;
    try {
      const [track] = await details([id]);
      if (epoch !== this._loadEpoch) return false;
      this._currentTrack = track;
      this._enabled = true;
      this._updateMediaSessionMetaData(track);
      const res = await resolveTrack(id);
      if (epoch !== this._loadEpoch) return false;
      this._resolution = res;
      if (!res.url || res.status === 'unavailable') {
        this._status = res.reason || '当前音源不可用';
        return false;
      }
      if (!res.expiresAt || Date.parse(res.expiresAt) <= Date.now()) {
        this._status = '音源已过期';
        await this._recoverSource(epoch, autoplay);
        return false;
      }
      this._status = res.status === 'preview' ? '当前音源仅可试听' : '';
      this._playAudioSource(res.url, autoplay, position, epoch);
      this._queueDirty = true;
      if (autoplay) this._scrobble(track, position);
      return true;
    } catch (e) {
      if (epoch === this._loadEpoch) this._status = '播放失败：' + e.message;
      return false;
    }
  }

  /**
   * @returns 是否成功加载音频，并使用加载完成的音频替换了howler实例
   */
  _replaceCurrentTrackAudio(track, autoplay) {
    return this._replaceCurrentTrack(track.id, autoplay);
  }
  _cacheNextTrack() {
    return;
  }
  _loadSelfFromLocalStorage() {
    /* Queue restores from own persistent service only. */
  }
  _initMediaSession() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        this.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        this.playPrevTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        this._playNextTrack(this.isPersonalFM);
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('seekto', event => {
        this.seek(event.seekTime);
        this._updateMediaSessionPositionState();
      });
      navigator.mediaSession.setActionHandler('seekbackward', event => {
        this.seek(this.seek() - (event.seekOffset || 10));
        this._updateMediaSessionPositionState();
      });
      navigator.mediaSession.setActionHandler('seekforward', event => {
        this.seek(this.seek() + (event.seekOffset || 10));
        this._updateMediaSessionPositionState();
      });
    }
  }
  _updateMediaSessionMetaData(track) {
    if ('mediaSession' in navigator === false) {
      return;
    }
    let artists = track.ar.map(a => a.name);
    const metadata = {
      title: track.name,
      artist: artists.join(','),
      album: track.al.name,
      artwork: [
        {
          src: track.al.picUrl,
          type: 'image/jpeg',
          sizes: '224x224',
        },
        {
          src: track.al.picUrl,
          type: 'image/jpeg',
          sizes: '512x512',
        },
      ],
      length: this.currentTrackDuration,
      trackId: this.current,
      url: '/trackid/' + track.id,
    };

    navigator.mediaSession.metadata = new window.MediaMetadata(metadata);
    if (isCreateMpris) {
      this._updateMprisState(track, metadata);
    }
  }
  // OSDLyrics 会检测 Mpris 状态并寻找对应歌词文件，所以要在更新 Mpris 状态之前保证歌词下载完成
  async _updateMprisState(track, metadata) {
    if (!store.state.settings.enableOsdlyricsSupport) {
      return ipcRenderer?.send('metadata', metadata);
    }

    let lyricContent = await getLyric(track.id);

    if (!lyricContent.lrc || !lyricContent.lrc.lyric) {
      return ipcRenderer?.send('metadata', metadata);
    }

    ipcRenderer.send('sendLyrics', {
      track,
      lyrics: lyricContent.lrc.lyric,
    });

    ipcRenderer.on('saveLyricFinished', () => {
      ipcRenderer?.send('metadata', metadata);
    });
  }
  _updateMediaSessionPositionState() {
    if ('mediaSession' in navigator === false) {
      return;
    }
    if ('setPositionState' in navigator.mediaSession) {
      const duration = this.currentTrackDuration;
      if (!duration) return;
      navigator.mediaSession.setPositionState({
        duration: ~~(this.currentTrack.dt / 1000),
        playbackRate: 1.0,
        position: Math.min(
          Math.max(Number(this.seek()) || 0, 0),
          this.currentTrackDuration
        ),
      });
    }
  }
  _nextTrackCallback() {
    this._scrobble(this._currentTrack, 0, true);
    if (!this.isPersonalFM && this.repeatMode === 'one') {
      this._replaceCurrentTrack(this.currentTrackID);
    } else {
      this._playNextTrack(this.isPersonalFM);
    }
  }
  _loadPersonalFMNextTrack() {
    if (this._personalFMNextLoading) {
      return [false, undefined];
    }
    this._personalFMNextLoading = true;
    return personalFM()
      .then(result => {
        if (!result || !result.data) {
          this._personalFMNextTrack = undefined;
        } else {
          this._personalFMNextTrack = result.data[0];
          this._cacheNextTrack(); // cache next track
        }
        this._personalFMNextLoading = false;
        return [true, this._personalFMNextTrack];
      })
      .catch(() => {
        this._personalFMNextTrack = undefined;
        this._personalFMNextLoading = false;
        return [false, this._personalFMNextTrack];
      });
  }
  _playDiscordPresence(track, seekTime = 0) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    let copyTrack = { ...track };
    copyTrack.dt -= seekTime * 1000;
    ipcRenderer?.send('playDiscordPresence', copyTrack);
  }
  _pauseDiscordPresence(track) {
    if (
      process.env.IS_ELECTRON !== true ||
      store.state.settings.enableDiscordRichPresence === false
    ) {
      return null;
    }
    ipcRenderer?.send('pauseDiscordPresence', track);
  }
  _playNextTrack(isPersonal) {
    if (isPersonal) {
      this.playNextFMTrack();
    } else {
      this.playNextTrack();
    }
  }

  appendTrack(trackID) {
    this.list = [...this.list, trackID];
    this._queueDirty = true;
  }
  playNextTrack() {
    // TODO: 切换歌曲时增加加载中的状态
    const [trackID, index] = this._getNextTrack();
    if (trackID === undefined) {
      this._howler?.stop();
      this._setPlaying(false);
      return false;
    }
    let next = index;
    if (index === INDEX_IN_PLAY_NEXT) {
      this._playNextList.shift();
      next = this.current;
    }
    this.current = next;
    this._replaceCurrentTrack(trackID);
    return true;
  }
  async playNextFMTrack() {
    if (this._personalFMLoading) {
      return false;
    }

    this._isPersonalFM = true;
    if (!this._personalFMNextTrack) {
      this._personalFMLoading = true;
      let result = null;
      let retryCount = 5;
      for (; retryCount >= 0; retryCount--) {
        result = await personalFM().catch(() => null);
        if (!result) {
          this._personalFMLoading = false;
          store.dispatch('showToast', 'personal fm timeout');
          return false;
        }
        if (result.data?.length > 0) {
          break;
        } else if (retryCount > 0) {
          await delay(1000);
        }
      }
      this._personalFMLoading = false;

      if (retryCount < 0) {
        let content = '获取私人FM数据时重试次数过多，请手动切换下一首';
        store.dispatch('showToast', content);
        console.log(content);
        return false;
      }
      // 这里只能拿到一条数据
      this._personalFMTrack = result.data[0];
    } else {
      if (this._personalFMNextTrack.id === this._personalFMTrack.id) {
        return false;
      }
      this._personalFMTrack = this._personalFMNextTrack;
    }
    if (this._isPersonalFM) {
      this._replaceCurrentTrack(this._personalFMTrack.id);
    }
    this._loadPersonalFMNextTrack();
    return true;
  }
  playPrevTrack() {
    const [trackID, index] = this._getPrevTrack();
    if (trackID === undefined) return false;
    this.current = index;
    this._replaceCurrentTrack(
      trackID,
      true,
      UNPLAYABLE_CONDITION.PLAY_PREV_TRACK
    );
    return true;
  }
  saveSelfToLocalStorage() {
    /* Never serialize temporary audio URLs, Howl state or sessions. */
  }
  pause() {
    this._howler?.pause();
    this._setPlaying(false);
    this._queueDirty = true;
    this.saveQueue(true);
    this._scrobble(this.currentTrack, this._progress);
  }
  play() {
    if (!this.currentTrackID) return;
    if (!this._howler || this._sourceFailed) {
      this._replaceCurrentTrack(
        this.currentTrackID,
        true,
        undefined,
        this._progress
      );
      return;
    }
    if (
      this._resolution?.expiresAt &&
      Date.parse(this._resolution.expiresAt) <= Date.now()
    ) {
      this._recoverSource(this._loadEpoch, true);
      return;
    }
    if (this._howler.playing()) return;
    this._howler.play();
  }
  playOrPause() {
    if (this._howler?.playing()) {
      this.pause();
    } else {
      this.play();
    }
  }
  seek(time = null, sendMpris = true) {
    if (isCreateMpris && sendMpris && time) {
      ipcRenderer?.send('seeked', time);
    }
    if (time !== null) {
      this._howler?.seek(time);
      if (this._playing)
        this._playDiscordPresence(this._currentTrack, this.seek(null, false));
    }
    return this._howler === null ? 0 : this._howler.seek();
  }
  mute() {
    if (this.volume === 0) {
      this.volume = this._volumeBeforeMuted;
    } else {
      this._volumeBeforeMuted = this.volume;
      this.volume = 0;
    }
  }
  setOutputDevice() {
    if (this._howler?._sounds.length <= 0 || !this._howler?._sounds[0]._node) {
      return;
    }
    const node = this._howler?._sounds[0]?._node;
    if (node?.setSinkId && store.state.settings.outputDevice)
      node.setSinkId(store.state.settings.outputDevice).catch(() => {});
  }

  directPlayTrack(track) {
    this._list = [track.id];
    this._current = 0;
    this._playNextList = [];
    return this._replaceCurrentTrack(track.id, true);
  }
  replacePlaylist(
    trackIDs,
    playlistSourceID,
    playlistSourceType,
    autoPlayTrackID = 'first'
  ) {
    this._isPersonalFM = false;
    this.list = trackIDs;
    this.current = 0;
    this._playlistSource = {
      type: playlistSourceType,
      id: playlistSourceID,
    };
    if (this.shuffle) this._shuffleTheList(autoPlayTrackID);
    if (autoPlayTrackID === 'first') {
      this._replaceCurrentTrack(this.list[0]);
    } else {
      this.current = trackIDs.indexOf(autoPlayTrackID);
      this._replaceCurrentTrack(autoPlayTrackID);
    }
  }
  playAlbumByID(id, trackID = 'first') {
    getAlbum(id).then(data => {
      let trackIDs = data.songs.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'album', trackID);
    });
  }
  playPlaylistByID(id, trackID = 'first', noCache = false) {
    console.debug(
      `[debug][Player.js] playPlaylistByID 👉 id:${id} trackID:${trackID} noCache:${noCache}`
    );
    getPlaylistDetail(id, noCache).then(data => {
      let trackIDs = data.playlist.trackIds.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'playlist', trackID);
    });
  }
  playArtistByID(id, trackID = 'first') {
    getArtist(id).then(data => {
      let trackIDs = data.hotSongs.map(t => t.id);
      this.replacePlaylist(trackIDs, id, 'artist', trackID);
    });
  }
  playTrackOnListByID(id, listName = 'default') {
    if (listName === 'default') {
      this._current = this._list.findIndex(t => t === id);
    }
    this._replaceCurrentTrack(id);
  }
  playIntelligenceListById(id, trackID = 'first', noCache = false) {
    getPlaylistDetail(id, noCache).then(data => {
      const randomId = Math.floor(
        Math.random() * (data.playlist.trackIds.length + 1)
      );
      const songId = data.playlist.trackIds[randomId].id;
      intelligencePlaylist({ id: songId, pid: id }).then(result => {
        let trackIDs = result.data.map(t => t.id);
        this.replacePlaylist(trackIDs, id, 'playlist', trackID);
      });
    });
  }
  addTrackToPlayNext(trackID, playNow = false) {
    const ids = this.list.slice();
    const at = ids.length ? this.current + 1 : 0;
    ids.splice(at, 0, trackID);
    this.editQueue(ids, playNow ? at : this.current);
    if (playNow || ids.length === 1)
      this._replaceCurrentTrack(trackID, playNow);
  }
  playPersonalFM() {
    this._isPersonalFM = true;
    if (this.currentTrackID !== this._personalFMTrack.id) {
      this._replaceCurrentTrack(this._personalFMTrack.id, true);
    } else {
      this.playOrPause();
    }
  }
  async moveToFMTrash() {
    this._isPersonalFM = true;
    let id = this._personalFMTrack.id;
    if (await this.playNextFMTrack()) {
      fmTrash(id);
    }
  }

  sendSelfToIpcMain() {
    if (process.env.IS_ELECTRON !== true) return false;
    let liked = store.state.liked.songs.includes(this.currentTrack.id);
    ipcRenderer?.send('player', {
      playing: this.playing,
      likedCurrentTrack: liked,
    });
    setTrayLikeState(liked);
  }

  switchRepeatMode() {
    if (this._repeatMode === 'on') {
      this.repeatMode = 'one';
    } else if (this._repeatMode === 'one') {
      this.repeatMode = 'off';
    } else {
      this.repeatMode = 'on';
    }
    if (isCreateMpris) {
      ipcRenderer?.send('switchRepeatMode', this.repeatMode);
    }
  }
  switchShuffle() {
    this.shuffle = !this.shuffle;
    if (isCreateMpris) {
      ipcRenderer?.send('switchShuffle', this.shuffle);
    }
  }
  switchReversed() {
    this.reversed = !this.reversed;
  }

  clearPlayNextList() {
    this._playNextList = [];
  }
  removeTrackFromQueue(index) {
    this._playNextList.splice(index, 1);
  }
}
