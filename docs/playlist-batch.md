# 歌单多选与批量操作

打开自有歌单，点「多选」。使用单曲复选框、全选/取消全选或桌面的 Tab、空格、Ctrl/⌘ A、Esc。移动端无需悬停。歌曲按后端验证的完整 source:externalID 标识；歌单不允许同来源同ID重复，队列允许重复。

歌单接口一次返回全部歌曲，最多1000首，无分页。未筛选时全选整个歌单；输入歌单内筛选后，只全选当前筛选结果，界面显示准确范围和首数。改变筛选、切换歌单或重开网页会清空选择；同歌单的数据更新只保留仍存在的已选ID。

- 播放所选：以当前显示顺序替换播放队列，从第一首开始。音源可用性由原播放器状态说明。
- 加入播放队列：先确认服务器已保存，再追加本地；保留当前音频与位置。容量不足时保留未入队项以供重试。
- 加入其他歌单：读取目标最新 revision，跳过已有曲目并保序。不会修改源歌单。
- 从本歌单移除：确认弹窗明确歌单名称和所选首数，只修改该歌单；喜欢、其他歌单和队列不变。

写入时禁用本批量入口和相关单曲编辑。歌单写入为单目标原子提交；409或丢回包时读回状态，失败项保留可重试，重试从最新列表重新计算，不自动覆盖旧完整数组。队列保存结果未知时使用已有「重新载入队列」入口恢复，核对后重试；恢复会暂停当前播放，普通批量入队不会暂停。

实现不新增依赖、不改后端/API、登录、音源、推荐或公开歌单导入。批量工具栏在正常文档流中，避免占用全局播放器位置。动效接口仅 `.batch-toolbar`、`.is-selected`、`Transition name=motion-toolbar`。

验证命令（使用项目原有Node24与依赖）：

```sh
../.runtime/node-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run
../.runtime/node-toolchain/node_modules/node/bin/node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
../.runtime/node-toolchain/node_modules/node/bin/node node_modules/vite/bin/vite.js build
```

隔离浏览器与评审证据位于父工作区 `artifacts/playlist-batch/`。预览使用独立游客数据库；正常真实音频验证与故障注入分开记录。正式HTTPS与飞书客户端验收不能由局域网截图代替。发布状态及所需授权见父工作区 `playlist-batch-handoff-20261116.md` 和 `artifacts/playlist-batch/release-scope.md`。
