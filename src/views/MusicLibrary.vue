<template>
  <div class="music-shell">
    <aside class="music-sidebar">
      <router-link to="/library" class="music-brand"
        ><span class="brand-disc">♫</span> BetaGo<span class="brand-sub"
          >MUSIC / 你的音乐空间</span
        ></router-link
      >
      <nav aria-label="音乐导航">
        <router-link to="/library">▤ &nbsp; 我的音乐</router-link>
        <router-link to="/search">⌕ &nbsp; 发现歌曲</router-link>
        <router-link to="/queue"
          >≡ &nbsp; 待播队列
          <small>{{ player.list.length }}</small></router-link
        >
        <router-link to="/play">◉ &nbsp; 正在播放</router-link>
      </nav>
      <div class="sidebar-label"
        >我的歌单
        <button aria-label="新建歌单" @click="showCreate = true"
          >＋</button
        ></div
      >
      <button
        v-for="p in playlists"
        :key="p.id"
        class="sidebar-playlist"
        :class="{ selected: selectedID === p.id }"
        @click="selectPlaylist(p)"
        >♫ &nbsp; {{ p.name }} <small>{{ p.tracks.length }}</small></button
      >
      <div class="sidebar-foot"
        ><span class="session-dot"></span
        >{{ userKind === 'feishu' ? '飞书个人空间' : '访客空间' }}<br /><span
          >保存热爱，自由聆听。</span
        ></div
      >
    </aside>
    <main class="music-main">
      <header class="music-top"
        ><span>BetaGo / {{ pageTitle }}</span
        ><button @click="transferOpen = !transferOpen"
          >备份与恢复 ↗</button
        ></header
      >
      <section v-if="transferOpen" class="music-panel transfer-panel">
        <h2>把音乐带到下一台设备</h2>
        <p
          >当前浏览器的访客会话识别你的私有资料。清除浏览器数据后需要恢复码；不会自动识别其他设备。</p
        >
        <div class="button-row"
          ><button @click="exportJSON">导出 JSON 备份</button
          ><label class="file-button"
            >导入 JSON<input
              type="file"
              accept="application/json,.json"
              @change="importJSON" /></label
          ><button @click="makeRecovery">生成 / 轮换恢复码</button></div
        >
        <p v-if="recovery" class="recovery" data-testid="recovery-code">{{
          recovery
        }}</p>
        <p v-if="recovery"
          >恢复码只显示一次，请私密保存；轮换后旧码失效。JSON
          仅复制资料，不包含恢复码或音频地址。</p
        >
        <form class="button-row" @submit.prevent="recover"
          ><input
            v-model="recoveryInput"
            aria-label="恢复码"
            type="password"
            autocomplete="off"
            placeholder="输入另一台设备保存的恢复码"
          /><button>恢复原空间</button></form
        >
        <button v-if="feishuAvailable" @click="feishuLogin"
          >使用飞书身份</button
        >
      </section>
      <div v-if="error" class="music-error" role="alert"
        >{{ error }} <button @click="load">重新载入</button></div
      >
      <section v-if="shared" class="music-panel">
        <span class="eyebrow">与你分享 / 只读</span
        ><h1>{{ shared.playlists[0]?.name }}</h1>
        <p>复制后可在自己的空间编辑；原分享可由分享者撤销。</p>
        <button class="primary" @click="copyShared">复制到我的歌单</button>
        <MusicRows
          :tracks="sharedTracks"
          @play="playList(sharedTracks, $event)"
          @enqueue="enqueue"
          @like="like"
          @add="addTrack"
          @share="shareTrack"
        />
      </section>
      <template v-else-if="routeSection === 'search'">
        <section class="music-heading"
          ><span class="eyebrow">DISCOVER / 匿名曲库</span
          ><h1>下一首，听什么？</h1
          ><p
            >搜索曲目，收进自己的音乐空间。音源可用性以实际解析为准。</p
          ></section
        >
        <form class="search-form" @submit.prevent="search"
          ><input
            v-model="query"
            aria-label="搜索歌曲"
            placeholder="歌曲、歌手或专辑"
            maxlength="200"
          /><button class="primary" :disabled="busy">{{
            busy ? '搜索中…' : '搜索'
          }}</button></form
        >
        <p v-if="searched" class="muted"
          >{{ results.length }} 首结果 · 无需网易云账号</p
        >
        <MusicRows
          :tracks="results"
          @play="playList(results, $event)"
          @enqueue="enqueue"
          @like="like"
          @add="addTrack"
          @share="shareTrack"
        />
        <div v-if="!results.length" class="empty-state"
          ><span>⌕</span
          ><h2>{{ searched ? '没有找到结果' : '从一首喜欢的歌开始' }}</h2
          ><p>搜索结果可以播放、加入队列或收藏到自有歌单。</p></div
        >
      </template>
      <template v-else-if="routeSection === 'queue'">
        <section class="music-heading"
          ><span class="eyebrow">UP NEXT / 当前设备</span
          ><h1
            >待播队列 <small>{{ queueTracks.length }}</small></h1
          ><p
            >队列和播放位置自动保存。刷新后暂停恢复，点击播放继续。</p
          ></section
        >
        <div class="button-row"
          ><button @click="clearQueue">清空队列</button
          ><button @click="player.reloadQueue().then(refreshQueue)"
            >恢复服务器队列</button
          ><span class="muted">{{
            player._syncing
              ? '保存中…'
              : '设备队列 · revision ' + player._queueRevision
          }}</span></div
        >
        <MusicRows
          :tracks="queueTracks"
          :editable="true"
          :queue="true"
          @play="playQueue"
          @enqueue="enqueue"
          @like="like"
          @add="addTrack"
          @share="shareTrack"
          @remove="removeQueue"
          @move="moveQueue"
        />
        <div v-if="!queueTracks.length" class="empty-state"
          ><span>≡</span><h2>留一点期待给下一首</h2
          ><router-link to="/search">去发现歌曲 →</router-link></div
        >
      </template>
      <template v-else-if="routeSection === 'play'">
        <section class="music-heading"
          ><span class="eyebrow">NOW PLAYING / 播放器</span
          ><h1>{{ player.currentTrack.name || '等一首好歌' }}</h1
          ><p
            >持续聆听建议保留播放器页；桌面可用外部浏览器或飞书独立窗口打开。</p
          ></section
        >
        <section class="now-playing music-panel"
          ><img
            :src="player.currentTrack.al?.picUrl || '/music-cover.svg'"
            alt="专辑封面"
          /><div
            ><h2>{{ player.currentTrack.name || '还没有选择歌曲' }}</h2
            ><p>{{ player.currentTrack.ar?.[0]?.name }}</p
            ><div class="button-row"
              ><button @click="player.playPrevTrack()">上一首</button
              ><button class="primary" @click="player.playOrPause()">{{
                player.playing ? '暂停' : '播放'
              }}</button
              ><button @click="player.playNextTrack()">下一首</button
              ><button @click="$store.commit('toggleLyrics')"
                >打开歌词</button
              ></div
            ><div class="button-row"
              ><button
                @click="
                  player.repeatMode = player.repeatMode === 'on' ? 'off' : 'on'
                "
                >{{
                  player.repeatMode === 'on' ? '循环已开启' : '循环队列'
                }}</button
              ><button @click="player.shuffle = !player.shuffle">{{
                player.shuffle ? '随机已开启' : '随机播放'
              }}</button
              ><a :href="externalURL" target="_blank" rel="noopener noreferrer"
                >独立窗口打开 ↗</a
              ></div
            ><p class="muted">H5 后台、锁屏播放受浏览器和系统限制。</p></div
          ></section
        >
      </template>
      <template v-else>
        <section v-if="!selected" class="library-hero"
          ><div
            ><span class="eyebrow">YOUR MUSIC, YOUR SPACE</span
            ><h1>让喜欢的歌，<br />有自己的位置。</h1
            ><p>自己的歌单，自己的节奏。<br />不需要网易云登录，打开就能听。</p
            ><router-link class="primary" to="/search"
              >发现下一首 ↗</router-link
            ></div
          ><div class="hero-record"
            ><div class="vinyl"
              ><div>BetaGo<br /><b>33⅓</b></div></div
            ><span>FOR THE LOVE OF MUSIC</span></div
          ></section
        >
        <section v-if="!selected" class="library-stats"
          ><button @click="tab = 'likes'"
            ><b>{{ likes.length }}</b> 首喜欢</button
          ><button @click="tab = 'playlists'"
            ><b>{{ playlists.length }}</b> 张歌单</button
          ><button @click="tab = 'history'"
            ><b>{{ history.length }}</b> 首最近播放</button
          ></section
        >
        <div v-if="!selected" class="music-tabs"
          ><button
            :class="{ active: tab === 'playlists' }"
            @click="tab = 'playlists'"
            >我的歌单</button
          ><button :class="{ active: tab === 'likes' }" @click="tab = 'likes'"
            >喜欢的歌</button
          ><button :class="{ active: tab === 'history' }" @click="loadHistory"
            >最近播放</button
          ><button :class="{ active: tab === 'shares' }" @click="loadShares"
            >分享管理</button
          ><button class="new-playlist" @click="showCreate = true"
            >＋ 新建歌单</button
          ></div
        >
        <template v-if="selected">
          <button class="back-link" @click="selectedID = ''">← 我的音乐</button>
          <section class="playlist-heading"
            ><img
              :src="selected.tracks[0]?.picture || '/music-cover.svg'"
              alt="歌单封面"
            /><div
              ><span class="eyebrow">PRIVATE PLAYLIST / 自有歌单</span
              ><h1>{{ selected.name }}</h1
              ><p
                >{{ selected.tracks.length }} 首 · revision
                {{ selected.revision }}</p
              ><div class="button-row"
                ><button class="primary" @click="playList(selectedTracks)"
                  >播放歌单</button
                ><button @click="renamePlaylist">重命名</button
                ><button @click="sharePlaylist">只读分享</button
                ><button @click="deletePlaylist">删除</button></div
              ></div
            ></section
          >
          <MusicRows
            :tracks="selectedTracks"
            :editable="true"
            @play="playList(selectedTracks, $event)"
            @enqueue="enqueue"
            @like="like"
            @add="addTrack"
            @share="shareTrack"
            @remove="removePlaylistTrack"
            @move="movePlaylistTrack"
          />
          <div v-if="!selected.tracks.length" class="empty-state"
            ><h2>把喜欢的歌放进来</h2
            ><router-link to="/search">去搜索歌曲 →</router-link></div
          >
        </template>
        <div v-else-if="tab === 'playlists'" class="playlist-grid"
          ><button
            v-for="p in playlists"
            :key="p.id"
            class="playlist-tile"
            @click="selectPlaylist(p)"
            ><img
              :src="p.tracks[0]?.picture || '/music-cover.svg'"
              alt="歌单封面"
            /><strong>{{ p.name }}</strong
            ><span>{{ p.tracks.length }} 首 · 私有</span></button
          ><button class="playlist-tile create-tile" @click="showCreate = true"
            ><span>＋</span><strong>创建你的第一张歌单</strong
            ><small>为某段心情，留一张歌单</small></button
          ></div
        >
        <template v-else-if="tab === 'likes'"
          ><MusicRows
            :tracks="likedTracks"
            @play="playList(likedTracks, $event)"
            @enqueue="enqueue"
            @like="like"
            @add="addTrack"
            @share="shareTrack"
          /><p v-if="!likes.length" class="empty-state"
            >点击歌曲旁的 ♡，把喜欢留在这里。</p
          ></template
        >
        <template v-else-if="tab === 'history'"
          ><div class="button-row"
            ><button @click="clearHistory">清空历史</button></div
          ><MusicRows
            :tracks="historyTracks"
            @play="playList(historyTracks, $event)"
            @enqueue="enqueue"
            @like="like"
            @add="addTrack"
            @share="shareTrack"
          /><p v-if="!history.length" class="empty-state"
            >最近播放的歌曲会出现在这里。</p
          ></template
        >
        <section v-else-if="tab === 'shares'" class="music-panel"
          ><p>分享只读，30 天后过期。撤销后原链接立即失效。</p
          ><div v-for="s in shares" :key="s.id" class="share-row"
            ><span
              >{{ s.kind === 'track' ? '单曲' : '歌单' }} ·
              {{ shareName(s) }}</span
            ><button :disabled="s.revoked" @click="revoke(s)">{{
              s.revoked ? '已撤销' : '撤销分享'
            }}</button></div
          ><p v-if="!shares.length">还没有创建分享。</p></section
        >
      </template>
      <footer class="music-footer"
        >BetaGo Music · 你的音乐资料独立保存
        <span>匿名音源 / 可用性以曲目状态为准</span></footer
      >
    </main>
    <div
      v-if="showCreate || addID || shareURL"
      class="music-modal-backdrop"
      @click.self="closeModal"
      ><section
        class="music-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="showCreate ? '新建歌单' : addID ? '加入歌单' : '分享链接'"
      >
        <button class="dialog-close" aria-label="关闭" @click="closeModal"
          >×</button
        >
        <form v-if="showCreate" @submit.prevent="create"
          ><span class="eyebrow">NEW PLAYLIST</span><h2>给这份喜欢起个名字</h2
          ><input
            v-model="newName"
            autofocus
            aria-label="歌单名称"
            maxlength="100"
            placeholder="例如：散步时的歌"
            required
          /><p>默认私有，分享由你决定。</p
          ><button class="primary">创建歌单</button></form
        >
        <template v-else-if="addID"
          ><h2>加入歌单</h2
          ><button
            v-for="p in playlists"
            :key="p.id"
            class="add-playlist-row"
            @click="addTo(p)"
            >{{ p.name }} <span>{{ p.tracks.length }} 首 ＋</span></button
          ><button @click="showCreate = true">＋ 新建歌单</button></template
        >
        <template v-else
          ><h2>分享这份音乐</h2
          ><p>链接只读，任何持有链接的人可以查看；可在分享管理中撤销。</p
          ><input
            :value="shareURL"
            aria-label="分享链接"
            readonly
            @click="$event.target.select()"
          /><button class="primary" @click="copyLink"
            >复制链接</button
          ></template
        >
      </section></div
    >
  </div>
</template>
<script>
import { mapState } from 'vuex';
import MusicRows from '@/components/MusicRows.vue';
import {
  api,
  toPlayer,
  details,
  catalogue,
  ensureSession,
  resetSession,
} from '@/api/music';
export default {
  components: { MusicRows },
  data: () => ({
    playlists: [],
    likes: [],
    history: [],
    shares: [],
    selectedID: '',
    tab: 'playlists',
    error: '',
    query: '',
    results: [],
    busy: false,
    searched: false,
    showCreate: false,
    newName: '',
    addID: '',
    shareURL: '',
    transferOpen: false,
    recovery: '',
    recoveryInput: '',
    userKind: 'guest',
    queueTracks: [],
    shared: null,
    feishuAvailable: false,
  }),
  computed: {
    ...mapState(['player']),
    routeSection() {
      return this.$route.path.split('/')[1];
    },
    pageTitle() {
      return (
        {
          library: '我的音乐',
          search: '发现歌曲',
          queue: '待播队列',
          play: '正在播放',
          share: '分享音乐',
        }[this.routeSection] || '我的音乐'
      );
    },
    selected() {
      return this.playlists.find(p => p.id === this.selectedID);
    },
    selectedTracks() {
      return (this.selected?.tracks || []).map(toPlayer);
    },
    likedTracks() {
      return this.likes.map(toPlayer);
    },
    historyTracks() {
      return this.history.map(h => toPlayer(h.track));
    },
    sharedTracks() {
      return (this.shared?.playlists[0]?.tracks || []).map(toPlayer);
    },
    queueKey() {
      return this.player.list.join(',');
    },
    externalURL() {
      return location.origin + '/play';
    },
  },
  watch: {
    queueKey() {
      this.refreshQueue();
    },
    '$route.path'() {
      this.loadShared();
      if (this.routeSection === 'queue') this.refreshQueue();
    },
  },
  async mounted() {
    await this.load();
    this.refreshQueue();
    this.loadShared();
    window.addEventListener('music-library-changed', this.load);
    window.addEventListener('music-add-track', this.addEvent);
    window.addEventListener('music-share-track', this.shareEvent);
    this.feishuAvailable = Boolean(window.tt?.requestAccess);
  },
  beforeDestroy() {
    window.removeEventListener('music-library-changed', this.load);
    window.removeEventListener('music-add-track', this.addEvent);
    window.removeEventListener('music-share-track', this.shareEvent);
  },
  methods: {
    async run(fn) {
      this.error = '';
      try {
        return await fn();
      } catch (e) {
        this.error = e.message;
        return null;
      }
    },
    async load() {
      return this.run(async () => {
        await ensureSession();
        const [ps, likes, hist, me] = await Promise.all([
          api('/playlists'),
          api('/likes'),
          api('/history'),
          api('/me'),
        ]);
        this.playlists = ps.playlists;
        this.likes = likes.tracks;
        this.history = hist.history;
        this.userKind = me.user.kind;
        [...this.likes, ...ps.playlists.flatMap(p => p.tracks)].forEach(
          toPlayer
        );
        this.$store.commit('updateLikedXXX', {
          name: 'songs',
          data: this.likes.map(t => t.id),
        });
      });
    },
    async search() {
      this.busy = true;
      await this.run(async () => {
        const r = await api('/search?q=' + encodeURIComponent(this.query));
        this.results = r.tracks.map(toPlayer);
        this.searched = true;
      });
      this.busy = false;
    },
    selectPlaylist(p) {
      this.selectedID = p.id;
      if (this.$route.path !== '/library') this.$router.push('/library');
    },
    async create() {
      await this.run(async () => {
        const p = await api('/playlists', 'POST', {
          name: this.newName,
          trackIDs: this.addID ? [this.addID] : [],
        });
        this.newName = '';
        this.closeModal();
        await this.load();
        this.selectPlaylist(p);
      });
    },
    async updatePlaylist(p, ids, name = p.name) {
      const result = await api('/playlists/' + p.id, 'PUT', {
        name,
        trackIDs: ids,
        revision: p.revision,
      });
      const at = this.playlists.findIndex(x => x.id === p.id);
      this.$set(this.playlists, at, result);
      return result;
    },
    renamePlaylist() {
      const name = prompt('歌单的新名称', this.selected.name);
      if (name?.trim())
        this.run(() =>
          this.updatePlaylist(
            this.selected,
            this.selected.tracks.map(t => t.id),
            name
          )
        );
    },
    deletePlaylist() {
      const p = this.selected;
      if (confirm('删除歌单“' + p.name + '”？'))
        this.run(async () => {
          await api('/playlists/' + p.id, 'DELETE', { revision: p.revision });
          this.selectedID = '';
          await this.load();
        });
    },
    removePlaylistTrack(index) {
      this.run(() =>
        this.updatePlaylist(
          this.selected,
          this.selected.tracks.filter((_, i) => i !== index).map(t => t.id)
        )
      );
    },
    movePlaylistTrack({ index, delta }) {
      this.run(() => {
        const ids = this.selected.tracks.map(t => t.id);
        const [id] = ids.splice(index, 1);
        ids.splice(index + delta, 0, id);
        return this.updatePlaylist(this.selected, ids);
      });
    },
    addEvent(e) {
      this.addTrack(e.detail);
    },
    shareEvent(e) {
      this.shareTrack(e.detail);
    },
    addTrack(id) {
      this.addID = id;
    },
    async addTo(p) {
      await this.run(async () => {
        await this.updatePlaylist(p, [...p.tracks.map(t => t.id), this.addID]);
        this.closeModal();
      });
    },
    like(id) {
      this.$store.dispatch('likeATrack', id);
    },
    playList(tracks, index = 0) {
      if (!tracks.length) return;
      this.player.replacePlaylist(
        tracks.map(t => t.id),
        '',
        'music',
        tracks[index]?.id || 'first'
      );
    },
    enqueue(id) {
      this.player.addTrackToPlayNext(id);
    },
    async refreshQueue() {
      if (!this.player.list.length) {
        this.queueTracks = [];
        return;
      }
      await this.run(async () => {
        this.queueTracks = await details(this.player.list);
      });
    },
    playQueue(index) {
      this.player.current = index;
      this.player._replaceCurrentTrack(this.player.list[index]);
    },
    removeQueue(index) {
      const ids = this.player.list.slice();
      const current = this.player.current;
      ids.splice(index, 1);
      if (index === current) {
        this.player.pause();
        if (ids.length)
          this.player._replaceCurrentTrack(
            ids[Math.min(current, ids.length - 1)],
            false
          );
      }
      this.player.editQueue(ids, index < current ? current - 1 : current);
      this.refreshQueue();
    },
    moveQueue({ index, delta }) {
      const ids = this.player.list.slice();
      const current = this.player.current;
      const [id] = ids.splice(index, 1);
      ids.splice(index + delta, 0, id);
      let next = current;
      if (current === index) next = index + delta;
      else if (current === index + delta) next = index;
      this.player.editQueue(ids, next);
      this.refreshQueue();
    },
    clearQueue() {
      this.player.pause();
      this.player.editQueue([], 0);
      this.player._loadEpoch++;
      this.player._howler?.unload();
      this.player._howler = null;
      this.player._enabled = false;
      this.player.setDefault();
      this.queueTracks = [];
    },
    async loadHistory() {
      this.tab = 'history';
      await this.run(async () => {
        this.history = (await api('/history')).history;
      });
    },
    async clearHistory() {
      await this.run(async () => {
        await api('/history', 'DELETE');
        this.history = [];
      });
    },
    async loadShares() {
      this.tab = 'shares';
      await this.run(async () => {
        this.shares = (await api('/shares')).shares;
      });
    },
    async revoke(s) {
      await this.run(async () => {
        await api('/shares/' + s.id, 'DELETE');
        s.revoked = true;
      });
    },
    shareName(s) {
      return s.kind === 'playlist'
        ? this.playlists.find(p => p.id === s.targetID)?.name || '已删除的歌单'
        : catalogue.get(s.targetID)?.title || s.targetID;
    },
    sharePlaylist() {
      this.share('playlist', this.selected.id);
    },
    shareTrack(id) {
      this.share('track', id);
    },
    async share(kind, targetID) {
      await this.run(async () => {
        const r = await api('/shares', 'POST', { kind, targetID });
        this.shareURL = location.origin + '/share/' + r.token;
      });
    },
    async copyLink() {
      await this.run(async () => {
        await navigator.clipboard.writeText(this.shareURL);
        this.$store.dispatch('showToast', '链接已复制');
      });
    },
    async loadShared() {
      this.shared = null;
      if (this.$route.params.token)
        await this.run(async () => {
          this.shared = await api('/shared/' + this.$route.params.token);
        });
    },
    async copyShared() {
      await this.run(async () => {
        await api('/shared/' + this.$route.params.token + '/copy', 'POST', {});
        await this.load();
        this.$router.push('/library');
      });
    },
    closeModal() {
      this.showCreate = false;
      this.addID = '';
      this.shareURL = '';
    },
    async exportJSON() {
      await this.run(async () => {
        const data = await api('/export');
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
          })
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'betago-music-v1.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    },
    async importJSON(e) {
      const file = e.target.files[0];
      if (!file) return;
      await this.run(async () => {
        if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MiB');
        await api('/import', 'POST', JSON.parse(await file.text()));
        await this.load();
      });
      e.target.value = '';
    },
    async makeRecovery() {
      await this.run(async () => {
        this.recovery = (await api('/auth/recovery', 'POST', {})).recoveryCode;
      });
    },
    async recover() {
      if (!this.recoveryInput) return;
      await this.run(async () => {
        await api('/auth/recover', 'POST', {
          recoveryCode: this.recoveryInput,
        });
        resetSession();
        location.href = '/library';
      });
    },
    async feishuLogin() {
      await this.run(async () => {
        const res = await window.tt.requestAccess({
          appID: process.env.VUE_APP_FEISHU_APP_ID,
          scopeList: [],
        });
        await api('/auth/feishu/exchange', 'POST', { code: res.code });
        resetSession();
        location.href = '/library';
      });
    },
  },
};
</script>
