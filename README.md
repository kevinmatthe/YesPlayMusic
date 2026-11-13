# BetaGo Music Web

独立音乐库与网页播放器，按本次已授权的现代前端重写，使用 Vue 3、TypeScript、Vite、Pinia 和原生 HTML Audio。YesPlayMusic 作为功能和交互参考；当前构建目标是网页，不再打包 Electron。部署目标是自有服务器上的独立服务，不以 Vercel 作为交付目标。

网页通过同源 `/music-api/v1` 调用 BetaGo 的独立 Go 音乐模块，个人数据写入自己的 PostgreSQL 数据库。曲库和音源是可替换的适配器：默认匿名，也可显式配置运营者已有的网易云服务端登录态或自有 MinIO 歌曲缓存。网页用户不需要网易云登录、二维码或个人 cookie；服务端音源授权与个人音乐空间的身份完全分开。

## 使用与身份

- 自有歌单增删改、歌曲加入/移除/排序/去重，喜欢、历史与清空。
- 设备队列与位置恢复，全局播放器、逐曲异步歌词、稳定歌曲链接。
- 只读分享与撤销，导入复制到自己的音乐库，版本化 JSON 导入/导出。
- 飞书 H5 在应用已配置且运行环境允许时，使用临时授权码由后端验证身份；普通浏览器和无法授权的环境仍可使用游客会话。客户端 URL 中的 `open_id` 或 `owner_id` 不作为身份凭据。
- 游客身份依赖当前浏览器会话。请保存恢复码，或导出 JSON 后在另一设备导入；这不等同于自动私有跨设备同步。JSON 不应包含会话凭据、cookie 或临时音频 URL。

音源可能返回完整可播、试听或不可用。播放器会明确显示限制、错误和浏览器自动播放拒绝；失效时只对同一首歌进行有限重新解析，不自动改换曲目或绕过权限。H5 锁屏和后台持续播放取决于浏览器与宿主环境，不能保证。

## 开发与验证

需要 Node.js **24.11 或更新的 24.x** 与 npm，版本入口是 `.nvmrc`，依赖锁定在 `package-lock.json`。

```sh
nvm use
npm ci
npm test
npm run build
```

本地开发默认监听 `37835`，将 `/music-api` 代理到 `http://127.0.0.1:37831`。使用其他独立后端时：

```sh
MUSIC_DEV_API=http://127.0.0.1:37834 npm run dev
```

后端 `MUSIC_ORIGIN` 必须与浏览器访问的精确 origin 一致。本机 HTTP 调试需要明确设置 `MUSIC_COOKIE_SECURE=false`；HTTPS 部署保持 `true`。不要将应用密钥、数据库 DSN 或会话值写入前端环境变量。

`npm run build` 先执行 TypeScript 检查，再输出 `dist/`。`npm run preview` 只预览静态构建，不会自动启动音乐 API；完整路径需要同源 API 或反向代理。CI 使用同一套 Node 24、`npm ci`、单元测试和生产构建。

自动化单元测试覆盖播放器竞态、歌词切换、队列并发及有限音源重试，但它们不代表真实曲库、实体手机或飞书权限验收。对应运行记录与截图应在交付工作区单独提供。

飞书身份发现、临时码交换与失败回退已有接口和客户端路径；当前尚无真实飞书 H5 临时码交换的验收证据，仍需应用权限、域名白名单与飞书内实际运行验证。普通浏览器的游客路径不依赖此验证。

## 本地独立部署

配套仓库布局：

```text
betago-music-web/
  frontend/   # 当前仓库
  backend/    # BetaGo-Redefine，含 cmd/music-server
```

后端迁移与配置参见同级 `../backend/deploy/music.env.example`、`../backend/docs/operations/music.md`；完整接口契约在集成工作区的 `music-api-contract.md`。配置使用专属数据库/角色与应用边界，音乐服务单独监听，不能复用共享管理员 Bearer。

可选择让独立 `music-server` 直接提供 `dist/`，设置 `MUSIC_STATIC_DIR` 为该目录的绝对路径；也可使用本目录的 Docker Compose，由 Nginx 同源转发 `/music-api/v1/` 到独立音乐 API。两者不需要重启共享 Bot。

以下命令是运维操作示例，不表示已经上线。先将 `../backend/deploy/music.env.example` 复制为私有的 `music.local.env` 并填写配置。`MUSIC_DATABASE_URL` 指向可达的专用 PostgreSQL；`MUSIC_NETEASE_URL` 指向已验证的曲库适配器；可选服务端音源凭据只在后端私有环境文件中配置，不能放入网页构建。外部 HTTPS 反向代理需将选定域名转发到 `127.0.0.1:37830`，并将 `MUSIC_ORIGIN` 设置为该访问地址。保持环境文件在版本控制之外。

```sh
docker compose --project-name betago-music --env-file music.local.env config --quiet
docker compose --project-name betago-music --env-file music.local.env build
docker compose --project-name betago-music --env-file music.local.env up -d
```

Compose 只公开环回地址 `127.0.0.1:37830`，API 只在其独立网络内监听 `37831`；数据库由部署方提供。Nginx 不记录分享 token 等请求 URL，个人 API 禁止缓存。首次迁移前备份数据库；可由独立迁移角色预先执行 SQL，再设置 `MUSIC_MIGRATE=false`。

仅构建网页镜像：

```sh
docker build -t betago-music-web:local .
```

镜像使用 Node 24 构建和 Nginx 提供静态文件，不包含网易云登录服务、个人 cookie 或桌面客户端。使用独立构建标签保留上一个镜像，避免覆盖唯一可回退版本。

## 运行核验与回退

每次交付应分别记录网页构建版本、后端版本、健康接口、真实匿名音源状态与浏览器播放读数。桌面浏览器截图、移动视口截图、实体手机验证和飞书内实际授权是不同证据；没有实测的项目应明确标注。

回退时只恢复独立音乐服务的上一版镜像/二进制与静态资源，并核验健康、会话、歌单及队列。保留数据库及恢复资料，不删除表、tombstone 或 revision；若数据库结构必须回退，应先验证备份和兼容性，不能直接清空库。共享 Bot、旧播放器入口及其他服务的生命周期不属于此 Compose。

旧卡片的 `?target=<descriptor URL>` 继续作为兼容入口。新链接优先使用稳定的 `source:externalID`；无法确认来源的旧描述符仅在当前播放器内使用，不能伪装成已持久化曲目。卡片字段和线上 Bot 的更新需单独验证，不能以网页代码或构建成功代替生产接入证据。

## 许可证

保留 MIT 许可证及原有 YesPlayMusic 版权声明，见 [LICENSE](LICENSE)。历史素材与署名应按其许可证继续保留。
