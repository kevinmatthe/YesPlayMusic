# 多端与明暗视觉实现计划

**Goal:** 在保留已上线音乐功能的前提下，交付可读、可触控、可键盘使用的浅/深色响应式候选。

**Architecture:** 全局语义颜色与尺寸token负责视觉，独立主题controller负责设备偏好；SFC只做样式/必要UI入口与弹窗焦点生命周期。音乐core、store、身份/API和单一audio实例保留。Vue3/TypeScript/Vite/Vitest及已有浏览器工具，不新增依赖。

## 文件边界与执行

- [x] 核正式master69与tree d38；新worktree `frontend-visual-refresh`，旧目录/线上dist保持。
- [x] 新工作树313项基线通过；42张只读基线与audit/test-plan在根artifacts/visual-refresh-20261117。
- [x] Theme负责人：`src/theme.ts`、`ui/ThemeControl.vue`、`tests/theme.test.ts`；App/main/index最小接入。先RED验证system/light/dark、读写失败、系统与storage事件、manual优先、解绑和启动模式，再实现。用原生select保证键盘/移动体验。
- [x] Root：`theme.css`定义成对的背景/文字/状态token；现`style.css`/`motion.css`颜色映射到token，补`responsive.css`统一文字尺度、44px控件、紧凑导航、safe-area、横屏与长文本。拆可读CSS区块，不以全局!important掩盖级联。
- [x] 组件负责人：Workspace与ui组件scoped颜色/文字/触控；Dialogs/Lyrics有界焦点与背景恢复、file输入键盘可达、已有分享/循环移动入口。DeviceCachePanel只改样式，保留已修复checkbox与重试逻辑。
- [x] 集成：审查所有diff与protected核心hash；依次跑新增targeted、完整回归、strict、生产构建，输出到独立artifacts路径，禁止构建进live frontend/dist。
- [ ] 浏览器负责人：唯一空闲37848隔离预览+现有37844隔离API，绑定新JS哈希；双主题/系统偏好/存储失败/键盘焦点/触控/长文本/safe-area/减少动画与同一audio检查；桌面/手机/平板截图并实际查看。
- [ ] Root：修真实浏览器发现的问题，保留精确源码/构建/截图证据，交候选入口与部署/回退边界。验证通过后按既有本地发布授权只切换前端静态文件，保留上版index与哈希资源；不重启API/Master。

## 受保护范围

`src/core/*`、`src/stores/*`、source/identity/profile/discovery业务逻辑与依赖清单不得改变。原播放器、缓存/外源限制与个人数据边界不动。只允许UI调用已有repeat/share方法；不增加后端接口、存储schema或源请求。

运行检查使用现有Node24与共享只读依赖，命令示例（新工作树内）：`node node_modules/vitest/vitest.mjs run`、`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`、`node node_modules/vite/bin/vite.js build --outDir ../artifacts/visual-refresh-20261117/candidate-dist`。测试过一次后只因新变化/失败追加必要验证，不重复旧45项真实曲库验收。
