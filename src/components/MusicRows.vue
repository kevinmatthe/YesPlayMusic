<template>
  <div class="music-rows">
    <div
      v-for="(track, index) in tracks"
      :key="track.id + ':' + index"
      class="music-track-row"
      :class="{ current: player.currentTrackID === track.id }"
      :data-track-id="track.id"
    >
      <TrackList
        :tracks="[track]"
        :column-number="1"
        dbclick-track-func="none"
      />
      <div class="music-track-actions">
        <button :aria-label="'播放 ' + track.name" @click="$emit('play', index)"
          >▶</button
        >
        <button
          :aria-label="'喜欢 ' + track.name"
          :class="{ liked: liked.songs.includes(track.id) }"
          @click="$emit('like', track.id)"
          >{{ liked.songs.includes(track.id) ? '♥' : '♡' }}</button
        >
        <button
          :aria-label="'加入队列 ' + track.name"
          @click="$emit('enqueue', track.id)"
          >＋队列</button
        >
        <button
          :aria-label="'加入歌单 ' + track.name"
          @click="$emit('add', track.id)"
          >＋歌单</button
        >
        <button
          :aria-label="'分享 ' + track.name"
          @click="$emit('share', track.id)"
          >↗</button
        >
        <template v-if="editable"
          ><button
            :disabled="index === 0"
            aria-label="上移"
            @click="$emit('move', { index, delta: -1 })"
            >↑</button
          ><button
            :disabled="index === tracks.length - 1"
            aria-label="下移"
            @click="$emit('move', { index, delta: 1 })"
            >↓</button
          ><button aria-label="移除" @click="$emit('remove', index)"
            >×</button
          ></template
        >
      </div>
    </div>
  </div>
</template>
<script>
import TrackList from './TrackList.vue';
import { mapState } from 'vuex';
export default {
  components: { TrackList },
  props: {
    tracks: { type: Array, default: () => [] },
    editable: Boolean,
    queue: Boolean,
  },
  computed: { ...mapState(['player', 'liked']) },
};
</script>
