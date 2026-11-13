import { api, toPlayer } from '@/api/music';

export default {
  showToast({ state, commit }, text) {
    if (state.toast.timer !== null) clearTimeout(state.toast.timer);
    commit('updateToast', {
      show: true,
      text,
      timer: setTimeout(
        () => commit('updateToast', { show: false, text: '', timer: null }),
        3200
      ),
    });
  },
  async likeATrack({ state, commit, dispatch }, id) {
    try {
      const liked = state.liked.songs.includes(id);
      await api(
        '/likes/' + encodeURIComponent(id),
        liked ? 'DELETE' : 'PUT',
        liked ? undefined : {}
      );
      const data = await api('/likes');
      commit('updateLikedXXX', {
        name: 'songs',
        data: data.tracks.map(t => t.id),
      });
      commit('updateLikedXXX', {
        name: 'songsWithDetails',
        data: data.tracks.map(toPlayer),
      });
      window.dispatchEvent(new Event('music-library-changed'));
    } catch (e) {
      dispatch('showToast', e.message);
    }
  },
  async fetchLikedSongs({ commit }) {
    const data = await api('/likes');
    commit('updateLikedXXX', {
      name: 'songs',
      data: data.tracks.map(t => t.id),
    });
  },
  async fetchLikedSongsWithDetails({ commit }) {
    const data = await api('/likes');
    commit('updateLikedXXX', {
      name: 'songsWithDetails',
      data: data.tracks.map(toPlayer),
    });
  },
  async fetchLikedPlaylist({ commit }) {
    const data = await api('/playlists');
    commit('updateLikedXXX', {
      name: 'playlists',
      data: data.playlists.map(p => ({
        ...p,
        trackCount: p.tracks.length,
        coverImgUrl: p.tracks[0]?.picture || '/music-cover.svg',
      })),
    });
  },
};
