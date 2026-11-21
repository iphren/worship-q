# Worship Q — 教会服务器部署

教会服务器（`apps/server`）为教会的电脑提供内容同步、异地备份、全教会的默认设置、手机遥控，以及给教会管理员使用的网页管理后台。没有它，电脑照样可以使用；是否连接由你决定。

它是一个 Node 进程，带一个 SQLite 数据库，以及一个存放背景文件和备份的文件夹，全部位于数据目录下（容器中是 `/data`）。

**没有教会服务器时**，电脑已经可以通过免费的 Worship Q 公共服务器使用手机遥控、无需密钥的圣经译本、幻灯片、PDF 和照片，以及供两部手机收听的现场音频；公共服务器不保留任何内容，视频则由电脑自己保存。无需连接：公共服务器不能作为教会服务器加入。运行自己的服务器，可以获得公共服务器无法提供的功能：多台电脑同步投影并共享诗歌、流程表和媒体，教会资源库，异地备份，浏览器远程画面，需要密钥的圣经译本（NIV、NKJV、NLT、ESV），现场音频录制，投影记录，以及管理后台。之后加入的电脑会带上它在没有教会服务器时制作的幻灯片和视频。

> **现场音频会被录制。** 除非管理员在管理后台的“设置”中关闭 **录制现场音频**，否则每个工作区的现场音频广播都会录制在这个服务器上。请告知教会。见 [聚会记录](#聚会记录)。

## 用 Docker 运行

在服务器上的仓库根目录中，把设置一次性保存到 `apps/server/.env`，放在 `compose.yaml` 旁边。Docker Compose 每次启动容器时都会读取它们：

```sh
cat > apps/server/.env <<'END'
WORSHIP_Q_NAME=Our Church
WORSHIP_Q_PORT=8080
END
```

然后启动：

```sh
docker compose -f apps/server/compose.yaml up -d --build
```

没有这个文件时，每次创建容器，这两项都会回到默认值。可以用`docker compose -f apps/server/compose.yaml config | grep -E "WORSHIP_Q_NAME|published"`检查 Compose 会使用什么。`.env` 文件被 Git 忽略，也不会打包进镜像，所以拉取更新时永远不会动到它。

容器监听 `127.0.0.1:8080`，或 `WORSHIP_Q_PORT` 指定的端口。请让反向代理指向它。前面应当有 TLS：手机和电脑必须通过 HTTPS 访问它。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `WORSHIP_Q_NAME` | `Worship Q` | 由 `/api/v1/info` 和 `/` 显示；只是一个名称 |
| `WORSHIP_Q_PORT` | `8080` | 反向代理转发到的 `127.0.0.1` 上的端口 |
| `WORSHIP_Q_DATA` | `/data` | 数据库、背景文件、备份和实时状态快照 |
| `PORT` | `8080` | 容器内的端口 |
| `WORSHIP_Q_REMOTE_DIR` | `/app/remote` | 构建好的手机页面，在 `/remote/` 提供 |
| `WORSHIP_Q_OUTPUT_DIR` | `/app/output` | 构建好的浏览器远程画面页面，在 `/output/` 提供 |
| `WORSHIP_Q_ADMIN_DIR` | `/app/admin` | 构建好的管理后台，在 `/admin/` 提供 |
| `WORSHIP_Q_PUBLIC_URL` | — | 这个服务器的公开地址，`https://worship.example.org`；登录需要它，配对链接也会用到 |
| `WORSHIP_Q_OIDC_ISSUER` | — | 教会的 OpenID Connect 提供方；见 **管理员登录** |
| `WORSHIP_Q_OIDC_CLIENT_ID` | — | 在提供方注册的应用 |
| `WORSHIP_Q_OIDC_CLIENT_SECRET` | — | 它的密钥，提供方要求时填写（Microsoft 和 Google 都要求） |
| `WORSHIP_Q_ADMINS` | — | 启动时设为管理员的电子邮件地址，用逗号分隔 |
| `WORSHIP_Q_RETENTION_DAYS` | `90` | 已删除的诗歌或背景的文件保留多久，之后由每日清理删除 |
| `WORSHIP_Q_MAX_IMAGE_MB` | `25` | 电脑可上传的最大图片，单位 MB |
| `WORSHIP_Q_MAX_DECK_MB` | `200` | 电脑可上传的最大幻灯片或 PDF，单位 MB |
| `WORSHIP_Q_MAX_VIDEO_MB` | `200` | 电脑可上传的最大视频，单位 MB；服务器从不压缩视频 |
| `WORSHIP_Q_YOUVERSION_KEY` | — | 教会的 YouVersion Platform 应用密钥；见 **经文** |
| `WORSHIP_Q_API_BIBLE_KEY` | — | 教会的 API.Bible 密钥 |
| `WORSHIP_Q_ESV_KEY` | — | 教会的 ESV API 密钥 |
| `WORSHIP_Q_STUN` | `stun:stun.l.google.com:19302` | 现场音频用的 STUN 服务器，用逗号分隔；留空表示不用。见 **现场音频** |
| `WORSHIP_Q_TURN_URL` | — | 现场音频中继的地址，`turn:worship.example.org:3478`；与下面的密钥一起使用 |
| `WORSHIP_Q_TURN_SECRET` | — | 与中继共享的密钥；从不发送给任何设备 |
| `WORSHIP_Q_TURN_LISTEN_IP` | — | 中继在主机上的地址（仅用于 `--profile turn`） |
| `WORSHIP_Q_TURN_EXTERNAL_IP` | — | 主机的公网地址，在服务商的 NAT 之后则写 `public/private` |

请像备份其他服务器数据一样备份 `worship-q-data` 卷。其中有教会的诗歌（作为同步的记录）、背景文件，以及每个工作区最近 30 份电脑备份。

## 反向代理和 CloudFront

服务器从头到尾需要：

- `/api/v1/coordinator`、`/api/v1/remote` 和 `/api/v1/output` 上的 WebSocket。
- 原样传递 `Authorization`、`x-worship-q-protocol` 和 `x-worship-q-admin` 请求头，并且 `/auth/*`和 `/api/v1/admin/*` 的 Cookie 双向传递。
- 不缓存 `/api/*` 或 `/auth/*`。
- 用 `PUT` 和 `POST` 上传大文件（视频），请求体上限至少与上面最大的媒体上限一样大（默认 200 MB）。nginx 默认只允许 1 MB；没有下面的设置，每个更大的上传都会以 413 错误失败，电脑会报告为代理拒绝了文件：

  ```nginx
  client_max_body_size 200m;  # at least WORSHIP_Q_MAX_VIDEO_MB and WORSHIP_Q_MAX_DECK_MB
  ```

  在 nginx 默认的请求缓冲下，nginx 收到文件时电脑的上传进度条就到了 100%，然后 nginx 再把文件交给服务器；这段短暂的等待会显示为处理中。为 `/api/v1/` 设置 `proxy_request_buffering off;` 可以避免，但并非必需。

如果代理前面有 CloudFront，用一个行为（behavior）处理所有请求：

- **Allowed HTTP methods：** GET、HEAD、OPTIONS、PUT、POST、PATCH、DELETE。
- **Cache policy：** `CachingDisabled`。
- **Origin request policy：** `AllViewerExceptHostHeader`。如果你的代理按公开主机名路由，请用 `AllViewer`。
- **Viewer protocol policy：** Redirect HTTP to HTTPS。

CloudFront 不需要额外设置就能传递 WebSocket。它会关闭空闲连接，所以服务器每 25 秒发一次 ping。

部署后，从外部检查一次整条路径（替换地址）：

```sh
curl https://worship.example.org/api/v1/info
# {"name":"Our Church","protocolVersion":7,"minProtocolVersion":2,"decks":true,"outputs":true,
#  ...,"media":{"images":true,"videos":true,"limits":{"image":26214400,"deck":209715200,"video":209715200}}}
```

连接一台电脑后，如果它的“设置 → 教会连接”显示“已是最新”，说明设备令牌已正确传递。“无法同步：… 401”表示 `Authorization` 请求头在途中被去掉了。

## 管理员登录

管理员用教会的 Microsoft 365 或 Google Workspace 账号登录后，在 `https://<server>/admin/` 使用管理后台。登录只证明对方是谁：只有电子邮件地址在服务器的管理员列表上的人才能进入。

> Microsoft Entra ID 登录已在实际使用中。Google Workspace 的步骤依照 Google 的文档编写，还没有在真实的 Workspace 上运行过；需要确认的内容见 `docs/spikes/oidc.md`。

**Microsoft Entra ID：** 在租户中，**App registrations → New registration**；平台选 **Web**；重定向 URI 填 `https://<server>/auth/callback`。创建一个客户端密钥。在 **Token configuration** 下，为 ID 令牌添加可选声明 `email`。颁发者必须指明教会的租户：服务器拒绝 `common`、`organizations`和 `consumers`，因为它们会让任何 Microsoft 租户都能登录。然后在 `apps/server/.env` 中：

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
WORSHIP_Q_OIDC_CLIENT_ID=<application (client) id>
WORSHIP_Q_OIDC_CLIENT_SECRET=<secret value>
WORSHIP_Q_ADMINS=pat@example.org
```

**Google Workspace：** 在 Google Cloud 中，**APIs & Services → Credentials → Create OAuth client ID**；类型选 **Web application**；已授权的重定向 URI 填 `https://<server>/auth/callback`。把同意屏幕设为 **Internal**，这样只有这个 Workspace 的用户才能登录。然后：

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://accounts.google.com
WORSHIP_Q_OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
WORSHIP_Q_OIDC_CLIENT_SECRET=<client secret>
WORSHIP_Q_ADMINS=pat@example.org
```

`WORSHIP_Q_ADMINS` 指定第一位管理员；服务器启动时会添加它从未见过的地址，但从不删除。在后台中被移除的管理员，即使仍列在这里也保持移除状态；在命令行上用 `admin add` 可以把他们加回来。管理员在后台中互相添加和移除，最后一位管理员不能在那里被移除。没有设置登录变量时，服务器照常运行，管理后台会说明尚未设置登录，管理工作改用下面的命令行。

会话在八小时内没有请求就会过期。退出登录会立即结束会话。

## 管理

管理员在管理后台中可以：

- **工作区：** 创建和重命名工作区；查看哪些工作区管理教会资源库、哪些正在投影；在列出转换会带来哪些变化的页面之后，打开 **管理教会资源库**；打开或关闭工作区的连接码，或更换它。
- **设备：** 批准请求加入的电脑（见 **连接电脑**），为它们命名，查看每台设备上次在线的时间和是否已连接，以及撤销设备，撤销会立即断开它。
- **教会资源库：** 查看教会的诗歌和背景、哪些工作区的流程表在使用、删除某一项，以及恢复已删除的项。
- **管理员**、**教会默认设置** 和 **存储空间**（服务器使用了多少空间，按文件类型和按工作区，以及剩余的可用空间）。
- **实时：** 工作区的页面显示服务器最后了解到的投影状态：谁在主控、流程表、屏幕上的内容，以及哪些设备在跟随。这里只能查看；投影仍由操作电脑控制。

同样的操作也可以在容器中用命令完成；当登录不可用或最后一位管理员不在了，这仍是进入的途径：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js <command>
```

| 命令 | 作用 |
| --- | --- |
| `admin add <email>` | 把一个电子邮件地址设为管理员 |
| `admin list` | 列出管理员 |
| `admin remove <email>` | 移除一位管理员；最后一位不能移除 |
| `workspace create <name>` | 创建工作区并显示它的连接码 |
| `workspace list` | 列出工作区 |
| `workspace code <id>` | 更换工作区的连接码；已注册的设备继续有效 |
| `workspace library <id> <types>\|all\|none [--yes]` | 工作区在教会资源库中管理哪些类型：`songs`、`backgrounds`、`slides`、`websites`，用逗号分隔；没有 `--yes` 时只显示会有什么变化 |
| `workspace library-take <id> <types> [--yes]` | 把教会资源库中这些类型的项目收归工作区自己的资源库；没有 `--yes` 时只列出它们 |
| `device list [workspace-id]` | 列出已注册的电脑 |
| `device revoke <device-id>` | 断开一台电脑；它必须重新注册 |
| `settings show` | 显示教会默认设置 |
| `settings set <key> <json>` | 设定一项教会默认值，例如 `settings set linesPerPiece 2` |
| `settings unset <key>` | 删除一项教会默认值 |

教会默认设置：`linesPerPiece`（1–8）、`wrapLongLines`（true/false）、`slideshowFontFamily` 和`subtitleFontFamily`（加引号的字体名称，例如 `'"Noto Sans SC"'`）。在“设置”中自行设定了值的工作区会保留它；“使用教会默认”会改回教会的值。

连接码让任何电脑都能加入工作区。在服务器有管理员之前，所有工作区的连接码都有效；之后，只有管理员打开了连接码的工作区才有效，新电脑通常改为经批准加入（见 **连接电脑**）。只把连接码交给可以为这个工作区准备内容的人；如果外泄，请用 `workspace code` 更换。

## 教会资源库

教会资源库中的诗歌、背景、幻灯片和网站，每个工作区都能看到。一个工作区可以各自管理其中的类型（`workspace library <id> songs,backgrounds`，或 `all`）；对它管理的类型，它可以直接添加、编辑和移除教会的项目。对其他类型，以及在其他每个工作区中：

- 新的诗歌和背景留在那个工作区；
- 编辑教会的诗歌会让工作区有自己的版本，只在那里替换教会的版本，之后教会的修改不会影响它；
- 移除教会的诗歌或背景只会在那个工作区中隐藏它。

教会移除一首诗歌时，工作区自己的版本会作为那个工作区的诗歌保留下来。

编辑过教会诗歌的工作区会有它的 **两个版本**，两者都保持最新：教会的最新版本和它自己的。它的电脑会显示两者，并有一个切换，选择工作区投影时使用哪一个；这个选择按诗歌、按工作区设定，并像编辑一样同步到工作区的其他电脑。**删除我们的版本** 会永久回到教会的诗歌。电脑在教会的诗歌上显示 **教会** 标记，在两个版本都有的诗歌上显示**2 个版本**；对它管理的类型，工作区两者都不显示，因为那些本来就是教会的。

无论由管理它的工作区还是在管理后台中，从教会资源库删除诗歌或背景都可以恢复：管理后台会列出已删除的项目，**还原** 会把它带回每个工作区；为某首诗歌做过自有版本的工作区会再次看到两个版本，并继续使用自己的。经过 `WORSHIP_Q_RETENTION_DAYS`（默认 90 天）后，每日清理会删除已删除项目的文件；项目仍以已删除、文件已删除的状态列出，不能再恢复。工作区自己删除的背景和幻灯片也会这样清理；工作区只是隐藏的教会项目不算删除，文件会保留。

打开某个类型时，会先显示将发生什么，没有 `--yes` 就不会改变任何东西。给出的列表就是工作区之后管理的全部类型：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds --yes
```

工作区中已打开类型的项目会成为教会的。它对教会项目的自有版本会为每个工作区替换那些项目，包括没有自有版本的工作区。它隐藏的这些类型的教会项目会重新出现。它们的文件会移到教会的文件夹。关闭某个类型时，教会资源库保持原样。

如果要改为把某些类型的教会项目交给一个工作区，先为它关闭这些类型，再收归它们：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites --yes
```

这些类型中每个现存的教会项目都会成为这个工作区自己的，连同它的历史和文件。其他每个工作区会看到它从教会资源库中被删除；做过自有版本的工作区会把那个版本保留为自己的。教会这边被删除的项目不能恢复。

## 媒体：幻灯片、PDF、图片和视频

在已连接的电脑上使用 **资源库 → 媒体 → 添加媒体**，或把文件拖到流程表上，就会把幻灯片、PDF、图片或视频发送到服务器。每种类型有自己的大小上限（见上表）；电脑会在发送前拒绝超过上限的文件，服务器在接收时也会再以 413 拒绝。

- **图片**（JPEG、PNG、WebP、GIF）会在服务器上缩小到 1920 × 1080 以内（从不放大），转正方向，保存为 JPEG，并为手机另存一个小图。这使用服务器自带的 `sharp` 库：不需要另外安装，没有 LibreOffice 图片也能用。HEIC 照片会被拒绝；Mac 会在发送前把它们转成 JPEG，Windows 电脑则会要求提供 JPEG。
- **视频**（MP4、M4V、MOV、WebM）按上传时的样子保存；服务器从不转换它们。H.264 编码的 MP4 在每台电脑上都能播放。每台电脑都会提前下载今天和之后流程表中的视频，所以聚会中不会在线播放任何内容。
- 幻灯片、PDF 和图片的 **原始文件** 保存在它们的图片旁边，供 **下载原始文件** 和 **重新转换** 使用；管理后台的“存储空间”页面会计入它们。

### 幻灯片

PowerPoint（.pptx、.ppt、.ppsx）、Keynote、OpenDocument（.odp）或 PDF 文件会被发送到服务器。服务器用 LibreOffice 排版幻灯片，再用 Ghostscript 把每一张画成图片，两者都已包含在 Docker 镜像中。带点击动画的幻灯片每次点击会成为一张图片；隐藏的幻灯片会被略过。幻灯片会保存为一项用于逐张显示这些图片的内容，其他电脑同步时会取得这些图片，所以断网后也能投影。

转换 100 张幻灯片大约需要 10–20 秒；一次只转换一份。没有 LibreOffice 或 Ghostscript 时（如果它们在别处，用 `WORSHIP_Q_SOFFICE`、`WORSHIP_Q_GHOSTSCRIPT` 指向它们），服务器照常启动，按钮会说明无法转换幻灯片。要在命令行上试转一个文件：

```sh
docker compose -f apps/server/compose.yaml exec worship-q \
  node dist/cli.js deck convert /data/some-deck.pptx /data/deck-test
```

只有服务器上有幻灯片所用的字体时，文字才会保持原来的位置。镜像中包含中文字体（Noto CJK，行高设为与制作幻灯片常用的字体相同）、与 Calibri、Cambria、Arial 和 Times New Roman 等宽的字体，以及构建时能下载到的 Microsoft 免费核心字体，例如 Trebuchet MS。

## 经文

电脑和手机通过这个服务器显示经文，服务器用教会自己的密钥调用圣经提供方。密钥只留在服务器上：从不写入日志，从不发送给电脑或手机，管理后台只显示每个密钥是否已设置。

| 提供方 | 变量 | 从哪里取得密钥 | 提供的译本 |
| --- | --- | --- | --- |
| YouVersion Platform | `WORSHIP_Q_YOUVERSION_KEY` | 在 developers.youversion.com 注册一个应用；在门户中接受每个出版方的许可（NIV 和当代译本是 Biblica，NASB 是 Lockman），否则那些译本会返回 403 | NIVUK、当代译本（CCB、CCBT）、中文标准译本（CSBS、CSBT）、BSB |
| API.Bible | `WORSHIP_Q_API_BIBLE_KEY` | api.bible；Starter 方案整个教会每月可调用 5,000 次 | NKJV、NLT、KJV，以及作为后备的 NIVUK 和开放版当代译本 |
| ESV API | `WORSHIP_Q_ESV_KEY` | api.esv.org | ESV |
| Free Use Bible API | — | 不需要密钥 | 新标点和合本（CUNP-S、CUNP-T）、KJV、BSB，以及作为后备的当代译本和中文标准译本 |

这些密钥属于教会，由教会为自己的使用注册，这是每个提供方条款的要求（见经文调研 §4）。把它们和其他设置一起写进 `.env`，然后重启服务器；日志会说明哪些密钥已设置，检查完成后还会说明哪些译本可用、通过哪个提供方。

在管理后台中 **选择提供的译本**：**教会默认设置 → 圣经译本** 列出 Worship Q 认识的每个译本，说明在已设置的密钥下是否有提供方能提供它，并把勾选的译本提供给每个工作区。在勾选任何译本之前，电脑会显示教会没有提供圣经。**工作区的默认值** 从中最多选择两个，在工作区自行选择之前，会并排显示在它的每台电脑和手机上。

服务器在启动时和每天检查每个译本一次，某个提供方失败时会改用下一个提供同一版本的提供方，并把每个译本的目录保存在数据文件夹的 `bible/` 中（每个约 7 KB）。经文正文最多在内存中保留十分钟，从不写入磁盘。按照 API.Bible 的条款，服务器会在后台把它的使用令牌报告给 API.Bible。

## 连接电脑

1. 在电脑上：**设置 → 教会连接**，输入服务器地址（`worship.example.org`）和这台电脑的名称，然后选择 **下一步**。
2. 服务器有管理员时，电脑会显示一个八位代码和一个二维码，然后等待。管理员打开管理后台（或扫描二维码，登录后会在那里打开这个请求），核对代码和电脑的名称，选择工作区，选择这台电脑是否可以把它自己的诗歌和流程表合并进去（没有默认选项），然后批准。请求的有效期是十五分钟。如果还没有管理员，电脑会改为要求输入连接码：在管理后台中或用 `workspace create` 创建工作区，然后输入显示的连接码。管理员也可以暂时打开工作区的连接码，电脑上会出现 **我有连接码**。
3. 工作区的第一台电脑会上传它的诗歌、流程表和设置。之后加入的电脑可以选择 **两者都保留**，把它的诗歌合并到工作区；或 **使用教会的副本**，替换它自己的内容。如果批准配对的管理员不允许合并，它只能选择 **使用教会的副本**，即使工作区还没有内容也不会带入任何东西，工作区就从空白开始。如果这会让电脑完全没有诗歌，管理后台会发出提醒。无论哪种情况，都会先在应用的数据文件夹中 `backups/` 下保存一份备份。

之后，内容每分钟同步一次，每次编辑后几秒钟同步，另一台电脑有修改时也会立即同步。应用打开期间，每 12 小时会发送一次异地备份，也可以按 **立即备份**。

## 整个场地的投影实时同步

工作区的每台电脑同步显示同一套投影内容。最先连接的操作电脑作为 **主控端**（coordinator）主控投影；其他电脑跟随它，在自己的投影屏幕和字幕上显示同一张幻灯片，它们的开始、切换幻灯片、隐藏内容和清屏，以及对进行中流程表的编辑，都经由它进行。**设置 → 教会连接** 下的 **接管投影控制** 会把这个角色移到另一台电脑，不改变任何屏幕。

主控端把实时状态同步到服务器，服务器会一直保存它，直到实时状态过期（最后一台操作电脑离开四小时后）。如果主控投影的电脑出了故障，其他电脑会显示 **主控投影的电脑没有响应。** 和 **在这里继续**，从同一张幻灯片继续。出故障的电脑恢复后会改为跟随。

同一网络上的电脑也会直接连接主控端，使用主控端自己生成的证书，通过 TLS 连接；证书指纹经由服务器传给其他电脑，所以没有工作区凭据的设备既不能读取也不能发送任何内容。通过 mDNS 在 47311 端口上发现。场地的互联网中断时，电脑仍会通过网络保持投影同步；既找不到服务器也找不到主控端的电脑会独立控制投影，其他电脑会跟随它。更新后第一次启动时，会请求一次允许应用访问局域网（macOS），或在专用网络上通过防火墙（Windows）。设置中会显示每台电脑的连接方式：**在局域网上** 或 **通过教会服务器连接**。

设为 **仅观看模式**（设置）的电脑会在屏幕上同步显示投影画面，但不会主动开始或接管投影；重新打开时仍是观看端。适用于只需跟随的投影电脑。

## 手机遥控

每台操作电脑在侧边栏底部的手机图标下显示它自己的二维码和链接；两者每隔几分钟更换一次。扫描或打开它的手机会请求控制权，并显示一个四位数代码。操作员会在横幅中看到同样的代码，然后批准。批准属于工作区：之后这部手机在工作区的每台电脑上都保持已批准，即使批准它的电脑关闭了也是如此，直到有人选择 **断开** 或 **全部断开**（后者也会让所有浏览器远程画面链接失效）。

手机可以切换幻灯片、跳到进行中流程表的任何一张幻灯片，以及隐藏内容。用 **编辑**，还可以搜索资源库，在进行中的流程表上添加、移除诗歌或调整顺序；每位操作员都会在横幅中看到每一次修改，主控端还有 **撤销**。只批准你信得过、可以掌管聚会流程的人。手机不能编辑诗歌、打开另一个日期的流程表或修改设置。手机通过服务器连接；邀请中也会写明主控端在场地网络上的地址，但手机浏览器只有在接受主控端的证书后才能使用它。

## 浏览器远程画面

**设置 → 浏览器远程画面** 会创建链接，通过服务器在任何浏览器中显示投影或字幕，例如在没有安装 Worship Q 的直播笔记本上作为 OBS 的“浏览器”来源。每个链接带有自己的密钥：页面不在浏览器存储中保存任何东西，不设置 Cookie，也不要求登录，所以全新的浏览器第一次打开链接就能显示远程画面，并且在日期变更、重启和交接之后一直有效，直到链接被撤销。浏览器有工作区的字体时页面会使用它，否则使用系统字体，已连接设备的列表会说明用的是哪一种。任何拥有链接的人都能看到投影上的内容。

在运行 Worship Q 的电脑上，OBS 和浏览器也可以在没有互联网的情况下，通过 `http://localhost:47310/slideshow`显示投影，字幕则在 `http://localhost:47310/overlay/subtitle`。

## 已连接的设备

**设置 → 已连接的设备** 列出正在同步投影的每台电脑、手机和浏览器远程画面、它们的角色和连接方式，手机和远程画面旁边有 **断开**，还有 **全部断开**。

## 现场音频

工作区的一台电脑可以把调音台的声音广播给工作区的其他电脑、已批准的手机和已登录的管理员，他们按下 **收听** 即可。音频直接在设备之间传送，从不经过这个服务器：服务器只传递建立每个连接所需的消息。广播会另外录制：在教会录制期间，广播的电脑会把它自己的录音上传到这个服务器（见 [聚会记录](#聚会记录)）。

大多数教会什么都不用设置。场地网络上的设备通过各自的地址互相找到。在家收听的人通过公共 STUN 服务器连接到广播端，`GET /api/v1/ice` 会把它交给已注册的设备（默认 `stun:stun.l.google.com:19302`；可以用 `WORSHIP_Q_STUN` 替换，或设为空表示不用）。

有些网络（通常是移动网络）不允许直接连接。对这些网络，可以在服务器旁边运行可选的中继 coturn。它是一个 Compose profile，默认关闭：

1. 选一个很长的随机密钥，加到 `apps/server/.env` 中：

   ```sh
   WORSHIP_Q_TURN_SECRET=<a long random secret>
   WORSHIP_Q_TURN_URL=turn:worship.example.org:3478
   WORSHIP_Q_TURN_LISTEN_IP=<this host's own address, as `ip addr` shows it>
   WORSHIP_Q_TURN_EXTERNAL_IP=<the public address>   # or public/private behind NAT
   ```

2. 在主机的防火墙和托管服务商的防火墙中，向互联网开放 **UDP 3478** 和 **UDP 49160–49180**。这些不经过反向代理或 CloudFront；中继在服务器自己的地址上应答。每个经中继的收听者使用 21 个中继端口中的一个。
3. 与服务器一起启动它：`docker compose -f apps/server/compose.yaml --profile turn up -d`。
4. 检查：`/api/v1/info` 显示 `"audioRelay":true`。在场地之外，用中继的地址和以设备令牌从 `GET /api/v1/ice`取得的凭据运行 Trickle ICE 页面（webrtc.github.io/samples）；出现 `relay` 候选就说明它可以用。

每台设备在每次建立新连接前都会向服务器请求凭据；凭据有效十分钟，由从不离开服务器的密钥生成。无法连接的收听者会被告知教会是否提供中继。不提供基于 TCP 或 TLS 的 TURN。

## 聚会记录

服务器保存三种聚会记录，它们都不会改变协议版本。

**现场音频录音。** 工作区广播现场音频时，广播的电脑会录制它自己的输入，并以五秒为一段上传，所以录音会随着聚会进行在服务器上逐渐增长。任何工作区都不需要做什么。那台电脑“设置”中 **广播现场音频** 下方的文字会说明广播正在被录制；屏幕上其他地方都不会显示。同一个输入的每一次连续使用就是一段录音：拔下音频接口再插回去会产生两段。只在场地网络上进行的聚会会保存在广播的电脑上，最多 500 MB（约 17 小时），连上服务器后再上传。

- **关闭录制。** 管理后台的 **设置 → 录制现场音频** 默认开启，是教会唯一的开关，一次作用于所有工作区。关闭期间，不会录制任何新内容，正在进行的录音也会停止。
- **保存位置。** `/data/recordings/<workspace>/<id>.webm`（Windows 录制的 WebM，Opus 编码）或 `.m4a`（Mac 录制的 MP4，AAC 编码），即电脑录制时的格式；服务器从不转码。每广播一小时约 29 MB。
- **保留多久。** `WORSHIP_Q_RECORDING_DAYS`，默认 90 天，由与已删除文件相同的每日清理删除；`0` 表示一直保留到被删除。“存储空间”页面把它们单独计为一类。
- **收听。** 管理后台中每个工作区的页面都有 **记录**：选一天来播放、下载或删除当天的录音。

**投影记录。** 主控端会记录显示过的每一项，以及它开始和结束的时间，并上传；显示不到一秒的不会保留。每条记录写明当时屏幕上那首诗歌的修订版本，所以即使诗歌之后被编辑或删除，也能看到当时唱了什么。投影记录永久保存：一次聚会只有几百行小记录。它在 **记录** 下与录音一起列出，也可以通过本地 API 完整读取。

**本地 API。** 第二个监听器在容器内的 8081 端口上，向这台机器上的其他服务提供只读的 API，内容包括流程表、投影记录和录音；见 [本地 API](../local-api.md)。Compose 只在 `127.0.0.1:8081` 上发布它（`WORSHIP_Q_LOCAL_API_PORT`可以改变主机端口；把 `WORSHIP_Q_LOCAL_PORT` 设为空会关闭它）。

- **它没有密钥。** 任何能连到这个端口的东西都能读取它提供的全部内容。绝不要让反向代理指向它，也绝不要在`127.0.0.1` 以外的地址上发布它。不用 Compose 运行服务器的教会也必须这样做。
- 在服务器本机上检查：`curl -s localhost:8081/local/v1` 会返回 API 的版本；从另一台机器发出同样的请求则不会有回应。

## 更新服务器

在一周的前几天，在服务器上运行 `scripts/update-server.sh`。它会拉取最新的提交，重新构建并重启容器；服务器启动时会自行迁移数据库。电脑在发布后六小时内会自行更新，并在操作员重新启动应用时安装更新。

当某个版本提高了协议版本时，请先更新服务器。服务器会继续接受较旧的电脑，它们仍可正常投影和同步，每项新功能只提供给认识它的电脑。发布说明会写明某个版本是否需要先更新服务器，或需要先设置什么。

## 已知限制

- 两台电脑在同步之前编辑了同一首诗歌或同一天的流程表时，后来的编辑生效。较早的诗歌版本保存在诗歌的历史中。
- 在一台电脑上删除背景会在那个工作区中隐藏它。从教会资源库删除的背景或诗歌会在保留期内保留文件，之后文件会被删除。
- 管理员登录已在 nginx 后面配合 Microsoft Entra ID 实际使用，但还没有在 Google Workspace 上或经过 CloudFront 试过；见 `docs/spikes/oidc.md`。
- 工作区隐藏的教会诗歌不能在那个工作区中取消隐藏；教会资源库修改这首诗歌也不会让它重新出现。
- 手机浏览器通常会拒绝主控端的自签名证书，所以手机要通过服务器连接，场地需要有互联网；电脑则不需要。
