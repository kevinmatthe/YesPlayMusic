# 独立部署 YesPlayMusic

Vercel 构建 Vite 页面，并用 Node.js 24 函数处理同源 `/music-api/v1/*`。Neon、Supabase 或其他托管 Postgres 负责持久化。可通过 Vercel Marketplace 关联已有资源。重新部署会使用同一个连接字符串连接原库，库的生命周期独立于代码。函数的 `/tmp` 只是临时文件系统。浏览器不接触数据库或源端凭据。

当前静态基线是 PR #5 合并提交 `4d8229d49b73f67df820c4b8d95a4ffffabfa284`。两个旧 Preview 都把 `/music-api/v1/auth/options`、`/me`、`/catalog/options`、`/search` 回退到同一个 HTML。旧构建既没有函数也没有持久存储接线。新路由先把 API 转到本仓 Node 函数，其余页面深链走 Vite。前端依然用同源 Cookie 与相对路径，Vercel 无需设置 `VITE_*` API 地址或开放 CORS。

## 关联 Preview 数据库

1. 在已有 Vercel 项目中选一个做验证。项目 Root Directory 为仓库根、Framework 为 Vite、Node.js 为 24.x，构建 `npm run build`、输出 `dist`。使用 Git Preview 分支。保留当前正式分支、域名和付费设置。
2. 选择已有托管 Postgres，准备**从空库创建**的独立测试库或分支。避免从有个人数据的生产分支克隆。运行时可用 provider 的 pooled URI，迁移可用直连 URI。Supabase transaction pooler 可用于运行时，使用新连接执行迁移时优先直连或 session pooler。普通远端连接使用系统信任的证书和 `sslmode=verify-full`。
3. 用具备 DDL 权限的迁移角色，在专用测试 Postgres 执行一次下方命令。命令从环境读取 URI，适合用本机忽略的 `.env.local` 注入。不要把 `MUSIC_MIGRATION_DATABASE_URL` 放到 Vercel。
4. 在选中的 Vercel 项目增加 **Preview** 环境变量 `MUSIC_PREVIEW_DATABASE_URL`，选择候选 Git 分支作为作用范围，值用上一步同一测试库的运行时连接字符串。项目需向函数提供系统环境变量 `VERCEL_ENV`。保存后重新部署该 Preview。
5. 打开 Preview 的 `/music-api/v1/health`，应返回 JSON `status: "ok"`、`database: "ready"`、`scope: "preview"`。然后用专用测试访客验证搜索、播放、书签式恢复码、歌单和队列。若要验收代码重部署，先记录测试歌单及队列，再用原 Preview 分支地址或恢复码读回。部署特有域名不同，浏览器不会跨域携带 Cookie。

```sh
# 在 .env.local 安全填入 MUSIC_MIGRATION_DATABASE_URL 后运行
MUSIC_DATABASE_SCOPE=preview npm run db:migrate
```

迁移在一个事务中执行，使用与既有音乐表相同的事务锁，创建缺失的表、索引及部署环境标记。可安全重跑同一范围。若环境标记已绑定其他范围，事务退出。运行时先验证标记再访问业务表。Preview 只读专属变量，完全忽略 `MUSIC_DATABASE_URL` 及 Marketplace 可能自动注入的通用 `DATABASE_URL`。Production 使用 `MUSIC_DATABASE_URL` 和另一个已用 `MUSIC_DATABASE_SCOPE=production` 迁移的数据库。Preview、生产与本机的数据库分别准备。冷启动、部署、恢复服务都不执行迁移。

运行角色需有 schema 的 USAGE、`music_deployment_scope` 的 SELECT 及音乐业务表的 SELECT/INSERT/UPDATE/DELETE；不需要 DDL 或库所有者权限。使用最小权限角色时由数据库管理员在迁移后按表授权。表和 JSON 契约承接既有 Postgres 实现。独立版采用访客会话和恢复码，服务端仅保留高熵会话及恢复码的哈希。当前无独立飞书应用配置，由 `auth/options` 明确关闭飞书入口。旧身份、家庭数据和凭据不会随部署导入。应用可导入用户主动导出的歌单与喜欢 JSON。

## 音源与可选变量

- 默认网易匿名搜索、详情、歌词、公开歌单导入和音频解析。网易返回的录音 ID、完整时长及 CDN MP3 前缀会被核对。明确试听返回 `preview`。网络波动、访问策略或授权条件可能使某个录音不可播。
- 酷我目录与取源均直连酷我。UNM 0.28.0 的 `src/provider/select.js` 用于匹配，`src/kwDES.js` 纯 JS 用于酷我查地址。跨源只接受唯一符合标题、艺人、专辑、时长的版次，且须有公开免费播放状态，CDN 片段也必须符合原时长。默认开启，`MUSIC_UNM_KUWO=0` 关闭跨源匹配，仍可使用独立酷我目录。
- 酷我公开详情接口可能对部分 ID 不返回记录。先通过曲库搜索可以登记已确认的元数据，随后可以直接打开这些曲目。若官方接口无公开歌词，已识别的歌曲返回空歌词。
- UNM 的 npm 顶层 `match(id, sources, data?)` 会自行请求候选地址并跟随重定向，匹配结果缺少录音版次证据。独立版调用其已固定版本的匹配/编码组件并自行控制网络和核验。该路径不启动 MITM、代理、常驻进程或外部二进制。`pyncmd` 的上游是第三方公开解析站。YouTube 的 `youtubedl` 路径依赖外部命令且受出口策略影响。它们未纳入候选。
- `MUSIC_LASTFM_API_KEY` 可选，仅服务器。配置后尝试将相关曲目映射到本站目录并标注关系来源。缺少 Key 时仍有普通推荐、搜索与播放。启用后查询相关曲目会向 Last.fm 发送种子标题和艺人。
- `MUSIC_NETEASE_COOKIE` 可选，仅服务器，给需自有账号的私用实例增加同 ID 取源，避免对公开 Preview 配置共享授权。匿名基础功能不需要此变量。未配置凭据时无需填写占位值。
- 播放只由设备的原生 audio 向已校验的 HTTPS CDN 发起。函数仅在解析时读取最多 64 KiB 前缀，不传输整首。设备已保存的完整本机缓存仍可直接重播。冷缓存首播在缓冲足够时即开始，设备缓冲完成后才尝试校验及写入 IndexedDB。过期或媒体失败沿用每次曲目选择最多一次自动恢复。CDN 出口地域、节流、CORS 和版权限制都可能影响成功率。若将来必须引入原生工具，部署在可控的独立云服务作为地址解析 API，仍只返回可由浏览器直读的 HTTPS CDN 链接。

## 本机验证与故障定位

```sh
npm ci
npm test
npm run build
# .env.local 设置 MUSIC_MIGRATION_DATABASE_URL 与 MUSIC_DATABASE_URL，均指向专用本机测试 Postgres
MUSIC_DATABASE_SCOPE=local npm run db:migrate
npm run standalone
```

`npm run standalone` 使用与 Vercel 相同的 handler。运行测试时将 `TEST_MUSIC_DATABASE_URL` 指向专用测试库。`npm run test:standalone` 含真实 Postgres 与双进程验收，Preview 拒绝串库这一项需让测试库启用 TLS，并通过 `NODE_EXTRA_CA_CERTS` 指定可信测试证书。未提供测试库时运行独立的边界测试并跳过 Postgres 用例。已有 `vite dev` 的 `MUSIC_DEV_API` 是旧集成联调入口。

| 现象 | 排查 |
| --- | --- |
| API 返回首页 HTML | 查部署 commit、Vercel 根目录及 rewrite 顺序。 |
| `database_not_configured` | 检查对应 Preview 或 Production 的变量，修改后重新部署。 |
| `database_migration_required` | 在该环境指定的数据库执行已审的迁移命令。 |
| `database_scope_mismatch` | 修正 DSN 或选择正确数据库。已有存在数据的环境标记不能通过重打标签来修。 |
| 数据库配置错误或不可用 | 检查数据库名称、凭据、角色权限、TLS、连接池 URI 和网络可达性，日志只记录错误类别。 |
| 源返回 unavailable | 查返回原因、函数出口地域及设备到 CDN 的网络，必要时换曲或源。 |

## 备份、发布与回退

生产发布前，在目标独立库做 provider 快照或 `pg_dump -Fc`，保存到受控的持久位置。做恢复演练时用新的隔离库。数据库恢复会覆盖目标数据，应指定目标并单独审核。用户级 JSON 导出用于转移歌单、喜欢，完整恢复还需数据库备份。

确认新 Preview 的函数、数据库写读和设备直连后，生产发布沿用独立环境和原 Postgres 连接。代码需要回退时选择 Vercel 的上一已知正常部署。增量表保留，恢复原应用版本不会回滚数据库。旧静态 Preview 没有 API，回退到它会恢复静态可看状态，数据库数据仍在。不要用迁移脚本重新初始化数据库。

资料：[Vercel Node 函数](https://vercel.com/docs/functions/runtimes/node-js)、[Vercel 环境变量](https://vercel.com/docs/environment-variables/manage-across-environments)、[Neon Marketplace](https://vercel.com/marketplace/neon)、[Supabase Marketplace](https://vercel.com/marketplace/supabase)、[UNM 上游](https://github.com/UnblockNeteaseMusic/server)、[node-postgres SSL](https://node-postgres.com/features/ssl)。
