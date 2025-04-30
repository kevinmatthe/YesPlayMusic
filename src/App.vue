<template>
  <div id="app" :class="{ 'user-select-none': userSelectNone }">
    <transition name="slide-up">
      <Player v-if="enablePlayer" v-show="showPlayer" ref="player" />
    </transition>
    <Toast />
    <transition v-if="enablePlayer" name="slide-up">
      <Lyrics v-show="showLyrics" />
    </transition>
  </div>
</template>

<script>
import Player from './components/Player.vue';
import Toast from './components/Toast.vue';
import { ipcRenderer } from './electron/ipcRenderer';
import { isAccountLoggedIn, isLooseLoggedIn } from '@/utils/auth';
import Lyrics from './views/lyrics.vue';
import { mapState } from 'vuex';

export default {
  name: 'App',
  components: {
    Player,
    Toast,
    Lyrics,
  },
  data() {
    return {
      isElectron: process.env.IS_ELECTRON, // true || undefined
      userSelectNone: false,
    };
  },
  computed: {
    ...mapState(['showLyrics', 'settings', 'player', 'enableScrolling']),
    isAccountLoggedIn() {
      return isAccountLoggedIn();
    },
    showPlayer() {
      return (
        [
          'mv',
          'loginUsername',
          'login',
          'loginAccount',
          'lastfmCallback',
        ].includes(this.$route.name) === false
      );
    },
    enablePlayer() {
      return true;
    },
    showNavbar() {
      return this.$route.name !== 'lastfmCallback';
    },
  },
  created() {
    if (this.isElectron) ipcRenderer(this);
    window.addEventListener('keydown', this.handleKeydown);
    this.fetchData();
  },
  mounted: function () {
    var searchParams = new URLSearchParams(window.location.search);
    var targetUrl = `https://kutt.kmhomelab.cn/${searchParams.get('target')}`;
    const fetchTarget = () => {
      var request = new XMLHttpRequest();
      request.open('GET', targetUrl, false);
      request.send(null);
      var result = JSON.parse(request.response);
      return result;
    };

    var target = fetchTarget();

    var musicPicUrl = target.PictureURL;
    var musicSongUrl = target.MusicURL;
    var lyricsUrl = target.LyricsURL;
    var duration = target.Duration;
    var albumName = target.Album;
    var artist = target.Artist;
    var name = target.Title;
    this.$store.commit('toggleLyrics');
    this.player.directPlayTrack(
      albumName,
      name,
      artist,
      musicPicUrl,
      musicSongUrl,
      lyricsUrl,
      duration
    );
    console.log(musicPicUrl, musicSongUrl, lyricsUrl);
  },
  methods: {
    handleKeydown(e) {
      if (e.code === 'Space') {
        if (e.target.tagName === 'INPUT') return false;
        if (this.$route.name === 'mv') return false;
        e.preventDefault();
        this.player.playOrPause();
      }
    },
    fetchData() {
      if (!isLooseLoggedIn()) return;
      this.$store.dispatch('fetchLikedSongs');
      this.$store.dispatch('fetchLikedSongsWithDetails');
      this.$store.dispatch('fetchLikedPlaylist');
      if (isAccountLoggedIn()) {
        this.$store.dispatch('fetchLikedAlbums');
        this.$store.dispatch('fetchLikedArtists');
        this.$store.dispatch('fetchLikedMVs');
        this.$store.dispatch('fetchCloudDisk');
      }
    },
    handleScroll() {
      this.$refs.scrollbar.handleScroll();
    },
  },
};
</script>

<style lang="scss">
#app {
  width: 100%;
  transition: all 0.4s;
}

main {
  position: fixed;
  top: 0;
  bottom: 0;
  right: 0;
  left: 0;
  overflow: auto;
  padding: 64px 10vw 96px 10vw;
  box-sizing: border-box;
  scrollbar-width: none; // firefox
}

@media (max-width: 1336px) {
  main {
    padding: 64px 5vw 96px 5vw;
  }
}

main::-webkit-scrollbar {
  width: 0px;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.4s;
}
.slide-up-enter,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
