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
.profile-badge{display:flex;align-items:center;gap:.6rem;min-width:2.75rem;min-height:2.75rem;max-width:13rem;padding:0;text-align:left;flex:0 1 auto;color:var(--ink,#28543f)}
.profile-avatar{display:grid;place-items:center;flex:0 0 2.125rem;width:2.125rem;height:2.125rem;border-radius:50%;overflow:hidden;background:#e7eddd;border:1px solid #d6e0cb;color:#53704d;font-weight:600;font-size:.85rem}
.profile-avatar img{display:block;width:100%;height:100%;object-fit:cover}.profile-avatar.is-loading{opacity:.6}
.profile-copy{display:grid;gap:.12rem;min-width:0}.profile-copy small{font-size:.6rem;color:#8b9a7e;font-weight:400;line-height:1.2}.profile-copy strong{display:block;font-size:.75rem;font-weight:500;line-height:1.4;max-width:9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:760px){.profile-badge{gap:.4rem;max-width:8rem}.profile-copy strong{font-size:.68rem;max-width:5rem}.profile-copy small{font-size:.55rem}}
</style>
