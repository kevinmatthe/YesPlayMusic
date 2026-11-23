const syncErrors: Record<string, string> = {
  invalid_netease_playlist: '请输入有效的网易云公开歌单分享链接。',
  netease_playlist_short_link_unavailable: '短链接暂时打不开，可改用网易云歌单的完整链接。',
  playlist_sync_already_exists: '这张网易云歌单已在你的曲库中同步。',
  playlist_sync_busy: '同步请求较多，请稍后重试。',
  playlist_sync_in_progress: '这张歌单正在同步，请稍后查看。',
  playlist_sync_limit: '每个音乐空间最多跟随 25 张歌单。',
  playlist_sync_not_configured: '当前音乐服务暂未启用网易云歌单同步。',
  playlist_sync_superseded: '同步状态已更新，请刷新歌单后再试。',
  playlist_sync_too_soon: '刚刚同步过，请等待 30 秒后再试。',
  playlist_sync_update_failed: '保存同步结果失败，请稍后重试。',
  public_playlist_access_denied: '网易云歌单不可公开读取，可能已设为私有或失效。',
  public_playlist_metadata_incomplete: '网易云返回的曲目不完整，请稍后重试。',
  public_playlist_source_unavailable: '网易云暂时不可用，请稍后重试。',
  public_playlist_too_large: '网易云歌单超过同步上限（1000 首）。',
  provider_rate_limited: '网易云请求过多，请稍后重试。',
  sync_playlist_read_only: '同步歌单的曲目由网易云更新。',
}

export function playlistSyncMessage(code: string) {
  return Object.hasOwn(syncErrors, code) ? syncErrors[code] : '同步失败，请稍后重试。'
}
