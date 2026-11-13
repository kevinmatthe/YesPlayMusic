<template>
  <div id="app">
    <router-view v-if="ready" />
    <div v-else class="music-loading">{{
      error || '正在打开你的音乐空间…'
    }}</div>
    <div v-if="player._status" class="music-status" role="status"
      >{{ player._status }}
      <button v-if="player._queueConflict" @click="player.reloadQueue()"
        >重新载入队列</button
      ></div
    >
    <Player v-if="ready && player.enabled" />
    <Lyrics v-if="ready && player.enabled" v-show="showLyrics" />
    <Toast />
  </div>
</template>
<script>
import Player from '@/components/Player.vue';
import Lyrics from '@/views/lyrics.vue';
import Toast from '@/components/Toast.vue';
import { mapState } from 'vuex';
import { api, ensureSession, legacyTarget } from '@/api/music';
export default {
  components: { Player, Lyrics, Toast },
  data: () => ({ ready: false, error: '' }),
  computed: { ...mapState(['player', 'showLyrics']) },
  async mounted() {
    try {
      await ensureSession();
      await this.player.ready;
      this.ready = true;
      const p = new URLSearchParams(location.search);
      if (p.get('target')) {
        const track = await legacyTarget(p.get('target'));
        await this.player.directPlayTrack(track);
      } else if (p.get('trackID')) {
        await this.player.ready;
        await api('/tracks/details', 'POST', { ids: [p.get('trackID')] });
        this.player.replacePlaylist([p.get('trackID')], '', 'music');
      }
      if (p.has('target') || p.has('trackID')) {
        const url = new URL(location.href);
        ['target', 'trackID', 'source'].forEach(k =>
          url.searchParams.delete(k)
        );
        history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch (e) {
      this.error = e.message;
      this.ready = true;
      this.player._status = '打开失败：' + e.message;
    }
    window.addEventListener('keydown', this.keydown);
  },
  beforeDestroy() {
    window.removeEventListener('keydown', this.keydown);
  },
  methods: {
    keydown(e) {
      if (
        e.code !== 'Space' ||
        ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(e.target.tagName)
      )
        return;
      e.preventDefault();
      this.player.playOrPause();
    },
  },
};
</script>
<style lang="scss">
@import '@/assets/css/music.scss';
</style>
