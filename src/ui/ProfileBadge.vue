<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Session } from '../core'
import { profileName, profileAvatarURL, profileInitial } from '../profile'
const props=defineProps<{user?:Session['user'];loading?:boolean}>()
const emit=defineEmits<{open:[]}>()
const name=computed(()=>profileName(props.user)),avatar=computed(()=>profileAvatarURL(props.user?.kind==='feishu'?props.user.avatarURL:undefined)),failed=ref(false)
watch(avatar,()=>failed.value=false)
</script>
<template>
 <button class="profile-badge" :aria-label="loading?'正在打开个人空间':`Hello，${name}，查看个人资料`" :title="loading?'正在打开个人空间':name" @click="emit('open')">
  <span class="profile-avatar" :class="{'is-loading':loading}" aria-hidden="true"><img v-if="avatar&&!failed&&!loading" :src="avatar" alt="" referrerpolicy="no-referrer" decoding="async" @error="failed=true"/><span v-else>{{loading?'♪':profileInitial(name)}}</span></span>
  <span class="profile-copy"><small>{{loading?'欢迎回来':'Hello，'}}</small><strong>{{loading?'音乐空间准备中':name}}</strong></span>
 </button>
</template>
<style scoped>
.profile-badge{display:flex;align-items:center;gap:.65rem;min-width:2.75rem;min-height:2.75rem;max-width:14rem;padding:0;text-align:left;flex:0 1 auto;color:var(--ink)}
.profile-avatar{display:grid;place-items:center;flex:0 0 2.5rem;width:2.5rem;height:2.5rem;border-radius:50%;overflow:hidden;background:var(--accent-soft);border:1px solid var(--line);color:var(--green);font-weight:600;font-size:1rem}
.profile-avatar img{display:block;width:100%;height:100%;object-fit:cover}.profile-avatar.is-loading{opacity:.65}
.profile-copy{display:grid;gap:.12rem;min-width:0}.profile-copy small{font-size:.875rem;color:var(--muted);font-weight:400;line-height:1.3}.profile-copy strong{display:block;font-size:.9375rem;font-weight:600;line-height:1.4;max-width:9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:760px){.profile-badge{gap:.5rem;max-width:8rem}.profile-copy strong{font-size:.875rem;max-width:5rem}.profile-copy small{font-size:.8125rem}}
</style>
