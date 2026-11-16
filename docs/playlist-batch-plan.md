# 歌单常见操作实施范围

已授权直接实现，按当前视觉风格完成，不新增依赖或改后端。

- [ ] 选择与数据：完整 source:externalID；当前歌单局部筛选；筛选或歌单切换清空选择，同歌单刷新仅保留仍存在项。全选明确整个歌单或当前筛选结果。
- [ ] 批量操作：播放所选、立即持久化入队、加入另一歌单、确认后移出当前歌单。单目标 revision 原子更新，容量不足报告成功/跳过/失败数，失败保留选择可重试；提交中锁定相关入口。丢失响应读回验证，不盲目重发旧列表。
- [ ] 组件边界：TrackRows 只负责受控勾选，PlaylistTracks 负责筛选/选择/批量栏；Workspace 接入。动效通过另一任务给出的 class/composable 接入。
- [ ] 验证：先写稳定身份/容量/读回/冲突测试；完整测试与构建；专用新游客做真实接口与真实音频浏览器检查；故障注入单列；桌面和 375px 截图，无横向溢出，播放不中断。
- [ ] 交付：隔离预览、最小提交、动效集成、审查、回退包；主对话核准 push/上线后再发布并公网实测。未发布前保持待验收。

依据 Vue 官方文档的 checkbox、watch 与键盘修饰符实现：https://vuejs.org/guide/essentials/forms.html#checkbox 、https://vuejs.org/guide/essentials/watchers.html 、https://vuejs.org/guide/essentials/event-handling.html#key-modifiers 。Context7 缺少本环境 API key，已回退官方文档。
