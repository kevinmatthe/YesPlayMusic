# 音乐网页动效交接

范围：保留当前配色、布局与业务。只补交互反馈、滚动层次、页面与浮层入场、播放封面的轻微呼吸。不新增依赖，不改播放逻辑、歌单选择逻辑、登录、音源、Bot 或部署。

基线为前端 `969335c`，隔离分支 `codex/music-motion-20261116`。工作树：`/mnt/RapidPool/userspace/kevinmatt/workspace/betago-music-web-motion`。原前端工作区保持干净。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/motion.css` | 140–280ms 的 hover/按压/焦点、歌曲行与歌单状态、搜索光晕、进度条可见焦点、sticky 顶栏、浮层/通知、6 秒封面呼吸、触屏和 reduced-motion 规则 |
| `src/motion.ts` | 根组件使用的生命周期模块；按页面变化注册少量 section；IntersectionObserver 控制入场和离屏封面；后台取消短动画并暂停 CSS 循环；卸载清理 observer/listener/animation/watch |
| `src/main.ts` | 在原样式之后导入 `motion.css` |
| `src/App.vue` | 稳定内容包装层、播放/滚动视觉 class；不重新挂载 RouterView、播放器或音频 |
| `src/ui/PlayerBar.vue` | 加载视觉 class，播放/暂停图标短入场 |
| `src/ui/LyricsPanel.vue` | 关闭或后台不计算歌词行及滚动；减少动态效果时使用 `behavior:'auto'` |
| `tools/motion-browser.mjs` | 可重跑的桌面/375px、音频连续性和动效检查；只允许 loopback，用内存示例 API 与生成的 WAV，不请求或写入线上数据 |

## 给歌单集成负责人的接入约定

直接 cherry-pick 这条分支的动效提交。未改 `Workspace.vue`、`TrackRows.vue`、`Dialogs.vue`、`style.css`、store/core；与批量任务的修改不重叠。

- 选中行使用 `.is-selected` 或 `[aria-selected="true"]`，自动获得内侧状态条，不改变行尺寸。
- 批量工具栏用 `<Transition name="motion-toolbar">` 包裹单一根节点。已与负责人实现的 `.batch-panel.batch-toolbar` 对齐；仅由 Transition 负责进出，避免重复动画。
- `Workspace.scrollCollection()` 和推荐区的 JS 平滑定位需在 `document.hidden` 时跳过，reduced-motion 时用 `auto`。负责人已接入此规则，集成后请保留。
- sticky 顶栏通过 `html.scroll-padding-top` 预留桌面112px、手机92px，底部预留播放器；不要另外给同一锚点叠加大留白。
- 如 `Dialogs.vue` 后续接离场效果，需由该文件负责人处理模板；本提交只通过现有 class 补入场，不操作弹层业务或焦点归属。

## 本地验证

证据目录：`/mnt/RapidPool/userspace/kevinmatt/workspace/betago-music-web/artifacts/motion-20261116/`。

| 验证 | 结果及证据 |
| --- | --- |
| TypeScript + Vite | `npm run build` 成功，见 `build.log`；没有依赖变化 |
| 现有单测 | `npm test`：14 文件、142 测试通过，见 `unit-tests.log` |
| 浏览器 | `browser-results.json`：桌面1440×960、触屏375×812；歌曲行/卡片/按钮/搜索/播放器焦点、播放/暂停、滚动及路由切换通过；控制台错误0，外部请求0 |
| 长列表 | 300首滚动前后同一行 offsetTop/height 相同，无歌曲行无限动画；音频元素同一个、播放时间继续增长 |
| 减少动态效果 | 运行时切换后循环数0；歌词跳转为auto；375px无封面缩放；保留背景/状态条/焦点框 |
| 后台/离屏 | 模拟 document.hidden + visibilitychange 后4个CSS循环均paused，返回前台恢复；封面滚出视口后无呼吸；这是浏览器事件路径测试，未当作真实手机锁屏保证 |
| 触屏 | 操作常显；375px无水平溢出，歌曲操作按钮至少36×44px，主要/播放按钮44px；搜索输入16px避免自动放大 |
| 性能 | 单次同环境无录屏采样110帧：原版中位16.7ms/P95 18.0ms，新版16.6ms/P95 18.4ms；两次播放均持续。仅为本机对照，非设备性能保证。详见 `baseline-performance/` 与 `current-performance/` |
| 独立评审 | `review.json`：fixed顶栏遮挡锚点、异步section入场、reduced-motion按压优先级均已修正；375px/1440px锚点复测通过 |

截图覆盖普通、卡片/歌曲行hover、按钮按下、搜索/进度/弹层焦点、播放/暂停、长列表、375px、减少动态效果。录屏为 `desktop-demo.webm`、`mobile-demo.webm`（另提供MP4和 `preview.html`）。示例内容已明确标记为本地演示，不代表线上音源验收。

重跑（已安装依赖时）：

```sh
export PATH=/mnt/RapidPool/userspace/kevinmatt/workspace/betago-music-web/.runtime/node-toolchain/node_modules/node/bin:$PATH
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 37841 --strictPort
```

另一个终端运行：

```sh
PLAYWRIGHT_BROWSERS_PATH=/mnt/RapidPool/userspace/kevinmatt/.cache/ms-playwright \
MOTION_ARTIFACTS=/tmp/music-motion-evidence \
node tools/motion-browser.mjs
```

可通过 `PLAYWRIGHT_MODULE`、`MOTION_CHROME` 指定现有Playwright模块和Chromium路径；`MOTION_PERF=1` 单独采无录屏滚动数据。脚本默认使用本机既有工具，不将Playwright加入产品依赖。

## 公网状态与待办

没有推送、创建PR、触发远程CI或部署。集成负责人统一完成合并与发布授权；本提交不得按“已上线”汇报。

已用严格TLS读取公网旧版，绕过环境代理，没有关闭证书验证：

```sh
curl --noproxy '*' --fail --silent --show-error https://music.kmhomelab.cn:2443/library | sha256sum
# 7c5f936abee2e9246bc3e49565e7094b9ed3ff7673456ade534114dd1a194350  -
```

旧版JS为 `index-CNepirX8.js`，SHA256 `d3fc780eb00f050ef927ce9f9214b377cf6811860a15efa6b55c72ae876659cf`；CSS为 `index-C_b-pz_a.css`，SHA256 `a6464ae3a1e347df6180c33085b171c17840d8f4dd4c61dbf27cae667cff8b9d`，与原frontend/dist一致。详见 `public-baseline.json`。

发布后负责人需补最终公网资源hash，以及桌面/375px新版本的动效、焦点、300首滚动和播放连续性验证。若使用内存示例数据跑公网静态资源，必须明确标记只验视觉；真实源播放验收应另用既有受控流程。这里没有把本地示例音频当作线上完整音频缓存的证明。

实现依据：[Vue composables生命周期](https://vuejs.org/guide/reusability/composables.html)、[Vue Transition](https://vuejs.org/guide/built-ins/transition.html)、[IntersectionObserver](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)。Context7未配密钥，已直接核对当前官方文档，无需用户提供密钥。
