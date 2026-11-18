# Worship Q — 教會伺服器部署

教會伺服器（`apps/server`）為教會的電腦提供內容同步、異地備份、全教會的預設設定、手機遙控，以及給教會管理員使用的網頁管理後台。沒有它，電腦照樣可以使用；是否連線由你決定。

它是一個 Node 程序，帶一個 SQLite 資料庫，以及一個存放背景檔案和備份的資料夾，全部位於資料目錄下（容器中是 `/data`）。

**沒有教會伺服器時**，電腦已經可以透過免費的 Worship Q 公共伺服器使用手機遙控、不需金鑰的聖經譯本、投影片、PDF 和照片，以及供兩支手機收聽的現場音訊；公共伺服器不保留任何內容，影片則由電腦自己保存。不需要連線：公共伺服器不能作為教會伺服器加入。執行自己的伺服器，可以獲得公共伺服器無法提供的功能：多台電腦同步投影並共享詩歌、流程表和媒體，教會資源庫，異地備份，瀏覽器遠端畫面，需要金鑰的聖經譯本（NIV、NKJV、NLT、ESV），現場音訊錄製，投影記錄，以及管理後台。之後加入的電腦會帶上它在沒有教會伺服器時製作的投影片和影片。

> **現場音訊會被錄製。** 除非管理員在管理後台的「設定」中關閉 **錄製現場音訊**，否則每個工作區的現場音訊廣播都會錄製在這個伺服器上。請告知教會。見 [聚會記錄](#聚會記錄)。

## 用 Docker 執行

在伺服器上的倉庫根目錄中，把設定一次性儲存到 `apps/server/.env`，放在 `compose.yaml` 旁邊。Docker Compose 每次啟動容器時都會讀取它們：

```sh
cat > apps/server/.env <<'END'
WORSHIP_Q_NAME=Our Church
WORSHIP_Q_PORT=8080
END
```

然後啟動：

```sh
docker compose -f apps/server/compose.yaml up -d --build
```

沒有這個檔案時，每次建立容器，這兩項都會回到預設值。可以用`docker compose -f apps/server/compose.yaml config | grep -E "WORSHIP_Q_NAME|published"`檢查 Compose 會使用什麼。`.env` 檔案被 Git 忽略，也不會打包進映象，所以拉取更新時永遠不會動到它。

容器監聽 `127.0.0.1:8080`，或 `WORSHIP_Q_PORT` 指定的埠。請讓反向代理指向它。前面應當有 TLS：手機和電腦必須透過 HTTPS 存取它。

| 變數 | 預設值 | 含義 |
| --- | --- | --- |
| `WORSHIP_Q_NAME` | `Worship Q` | 由 `/api/v1/info` 和 `/` 顯示；只是一個名稱 |
| `WORSHIP_Q_PORT` | `8080` | 反向代理轉發到的 `127.0.0.1` 上的埠 |
| `WORSHIP_Q_DATA` | `/data` | 資料庫、背景檔案、備份和即時狀態快照 |
| `PORT` | `8080` | 容器內的埠 |
| `WORSHIP_Q_REMOTE_DIR` | `/app/remote` | 構建好的手機頁面，在 `/remote/` 提供 |
| `WORSHIP_Q_OUTPUT_DIR` | `/app/output` | 構建好的瀏覽器遠端畫面頁面，在 `/output/` 提供 |
| `WORSHIP_Q_ADMIN_DIR` | `/app/admin` | 構建好的管理後台，在 `/admin/` 提供 |
| `WORSHIP_Q_PUBLIC_URL` | — | 這個伺服器的公開地址，`https://worship.example.org`；登入需要它，配對連結也會用到 |
| `WORSHIP_Q_OIDC_ISSUER` | — | 教會的 OpenID Connect 提供方；見 **管理員登入** |
| `WORSHIP_Q_OIDC_CLIENT_ID` | — | 在提供方註冊的應用程式 |
| `WORSHIP_Q_OIDC_CLIENT_SECRET` | — | 它的金鑰，提供方要求時填寫（Microsoft 和 Google 都要求） |
| `WORSHIP_Q_ADMINS` | — | 啟動時設為管理員的電子郵件地址，用逗號分隔 |
| `WORSHIP_Q_RETENTION_DAYS` | `90` | 已刪除的詩歌或背景的檔案保留多久，之後由每日清理刪除 |
| `WORSHIP_Q_MAX_IMAGE_MB` | `25` | 電腦可上傳的最大圖片，單位 MB |
| `WORSHIP_Q_MAX_DECK_MB` | `200` | 電腦可上傳的最大投影片或 PDF，單位 MB |
| `WORSHIP_Q_MAX_VIDEO_MB` | `200` | 電腦可上傳的最大影片，單位 MB；伺服器從不壓縮影片 |
| `WORSHIP_Q_YOUVERSION_KEY` | — | 教會的 YouVersion Platform 應用程式金鑰；見 **經文** |
| `WORSHIP_Q_API_BIBLE_KEY` | — | 教會的 API.Bible 金鑰 |
| `WORSHIP_Q_ESV_KEY` | — | 教會的 ESV API 金鑰 |
| `WORSHIP_Q_STUN` | `stun:stun.l.google.com:19302` | 現場音訊用的 STUN 伺服器，用逗號分隔；留空表示不用。見 **現場音訊** |
| `WORSHIP_Q_TURN_URL` | — | 現場音訊中繼的地址，`turn:worship.example.org:3478`；與下面的金鑰一起使用 |
| `WORSHIP_Q_TURN_SECRET` | — | 與中繼共享的金鑰；從不傳送給任何裝置 |
| `WORSHIP_Q_TURN_LISTEN_IP` | — | 中繼在主機上的地址（僅用於 `--profile turn`） |
| `WORSHIP_Q_TURN_EXTERNAL_IP` | — | 主機的公網地址，在服務商的 NAT 之後則寫 `public/private` |

請像備份其他伺服器資料一樣備份 `worship-q-data` 卷。其中有教會的詩歌（作為同步的記錄）、背景檔案，以及每個工作區最近 30 份電腦備份。

## 反向代理和 CloudFront

伺服器從頭到尾需要：

- `/api/v1/coordinator`、`/api/v1/remote` 和 `/api/v1/output` 上的 WebSocket。
- 原樣傳遞 `Authorization`、`x-worship-q-protocol` 和 `x-worship-q-admin` 請求頭，並且 `/auth/*`和 `/api/v1/admin/*` 的 Cookie 雙向傳遞。
- 不快取 `/api/*` 或 `/auth/*`。
- 用 `PUT` 和 `POST` 上傳大檔案（影片），請求體上限至少與上面最大的媒體上限一樣大（預設 200 MB）。nginx 預設只允許 1 MB；沒有下面的設定，每個更大的上傳都會以 413 錯誤失敗，電腦會報告為代理拒絕了檔案：

  ```nginx
  client_max_body_size 200m;  # at least WORSHIP_Q_MAX_VIDEO_MB and WORSHIP_Q_MAX_DECK_MB
  ```

  在 nginx 預設的請求緩衝下，nginx 收到檔案時電腦的上傳進度條就到了 100%，然後 nginx 再把檔案交給伺服器；這段短暫的等待會顯示為處理中。為 `/api/v1/` 設定 `proxy_request_buffering off;` 可以避免，但並非必需。

如果代理前面有 CloudFront，用一個行為（behavior）處理所有請求：

- **Allowed HTTP methods：** GET、HEAD、OPTIONS、PUT、POST、PATCH、DELETE。
- **Cache policy：** `CachingDisabled`。
- **Origin request policy：** `AllViewerExceptHostHeader`。如果你的代理按公開主機名路由，請用 `AllViewer`。
- **Viewer protocol policy：** Redirect HTTP to HTTPS。

CloudFront 不需要額外設定就能傳遞 WebSocket。它會關閉空閒連線，所以伺服器每 25 秒發一次 ping。

部署後，從外部檢查一次整條路徑（替換地址）：

```sh
curl https://worship.example.org/api/v1/info
# {"name":"Our Church","protocolVersion":7,"minProtocolVersion":2,"decks":true,"outputs":true,
#  ...,"media":{"images":true,"videos":true,"limits":{"image":26214400,"deck":209715200,"video":209715200}}}
```

連線一台電腦後，如果它的「設定 → 教會連線」顯示「已是最新」，說明裝置令牌已正確傳遞。「無法同步：… 401」表示 `Authorization` 請求頭在途中被去掉了。

## 管理員登入

管理員用教會的 Microsoft 365 或 Google Workspace 帳號登入後，在 `https://<server>/admin/` 使用管理後台。登入只證明對方是誰：只有電子郵件地址在伺服器的管理員列表上的人才能進入。

> Microsoft Entra ID 登入已在實際使用中。Google Workspace 的步驟依照 Google 的文件編寫，還沒有在真實的 Workspace 上執行過；需要確認的內容見 `docs/spikes/oidc.md`。

**Microsoft Entra ID：** 在租戶中，**App registrations → New registration**；平台選 **Web**；重定向 URI 填 `https://<server>/auth/callback`。建立一個客戶端金鑰。在 **Token configuration** 下，為 ID 令牌新增可選宣告 `email`。頒發者必須指明教會的租戶：伺服器拒絕 `common`、`organizations`和 `consumers`，因為它們會讓任何 Microsoft 租戶都能登入。然後在 `apps/server/.env` 中：

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
WORSHIP_Q_OIDC_CLIENT_ID=<application (client) id>
WORSHIP_Q_OIDC_CLIENT_SECRET=<secret value>
WORSHIP_Q_ADMINS=pat@example.org
```

**Google Workspace：** 在 Google Cloud 中，**APIs & Services → Credentials → Create OAuth client ID**；類型選 **Web application**；已授權的重定向 URI 填 `https://<server>/auth/callback`。把同意螢幕設為 **Internal**，這樣只有這個 Workspace 的使用者才能登入。然後：

```sh
WORSHIP_Q_PUBLIC_URL=https://worship.example.org
WORSHIP_Q_OIDC_ISSUER=https://accounts.google.com
WORSHIP_Q_OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
WORSHIP_Q_OIDC_CLIENT_SECRET=<client secret>
WORSHIP_Q_ADMINS=pat@example.org
```

`WORSHIP_Q_ADMINS` 指定第一位管理員；伺服器啟動時會新增它從未見過的地址，但從不刪除。在後台中被移除的管理員，即使仍列在這裡也保持移除狀態；在命令列上用 `admin add` 可以把他們加回來。管理員在後台中互相新增和移除，最後一位管理員不能在那裡被移除。沒有設定登入變數時，伺服器照常執行，管理後台會說明尚未設定登入，管理工作改用下面的命令列。

會話在八小時內沒有請求就會過期。登出會立即結束會話。

## 管理

管理員在管理後台中可以：

- **工作區：** 建立和重新命名工作區；檢視哪些工作區管理教會資源庫、哪些正在投影；在列出轉換會帶來哪些變化的頁面之後，開啟 **管理教會資源庫**；開啟或關閉工作區的連線碼，或更換它。
- **裝置：** 批准請求加入的電腦（見 **連線電腦**），為它們命名，檢視每台裝置上次線上的時間和是否已連線，以及撤銷裝置，撤銷會立即斷開它。
- **教會資源庫：** 檢視教會的詩歌和背景、哪些工作區的流程表在使用、刪除某一項，以及恢復已刪除的項。
- **管理員**、**教會預設設定** 和 **儲存空間**（伺服器使用了多少空間，按檔案類型和按工作區，以及剩餘的可用空間）。
- **即時：** 工作區的頁面顯示伺服器最後瞭解到的投影狀態：誰在主控、流程表、螢幕上的內容，以及哪些裝置在跟隨。這裡只能檢視；投影仍由操作電腦控制。

同樣的操作也可以在容器中用命令完成；當登入不可用或最後一位管理員不在了，這仍是進入的途徑：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js <command>
```

| 命令 | 作用 |
| --- | --- |
| `admin add <email>` | 把一個電子郵件地址設為管理員 |
| `admin list` | 列出管理員 |
| `admin remove <email>` | 移除一位管理員；最後一位不能移除 |
| `workspace create <name>` | 建立工作區並顯示它的連線碼 |
| `workspace list` | 列出工作區 |
| `workspace code <id>` | 更換工作區的連線碼；已註冊的裝置繼續有效 |
| `workspace library <id> <types>\|all\|none [--yes]` | 工作區在教會資源庫中管理哪些類型：`songs`、`backgrounds`、`slides`、`websites`，用逗號分隔；沒有 `--yes` 時只顯示會有什麼變化 |
| `workspace library-take <id> <types> [--yes]` | 把教會資源庫中這些類型的項目收歸工作區自己的資源庫；沒有 `--yes` 時只列出它們 |
| `device list [workspace-id]` | 列出已註冊的電腦 |
| `device revoke <device-id>` | 斷開一台電腦；它必須重新註冊 |
| `settings show` | 顯示教會預設設定 |
| `settings set <key> <json>` | 設定一項教會預設值，例如 `settings set linesPerPiece 2` |
| `settings unset <key>` | 刪除一項教會預設值 |

教會預設設定：`linesPerPiece`（1–8）、`wrapLongLines`（true/false）、`slideshowFontFamily` 和`subtitleFontFamily`（加引號的字型名稱，例如 `'"Noto Sans SC"'`）。在「設定」中自行設定了值的工作區會保留它；「使用教會預設」會改回教會的值。

連線碼讓任何電腦都能加入工作區。在伺服器有管理員之前，所有工作區的連線碼都有效；之後，只有管理員打開了連線碼的工作區才有效，新電腦通常改為經批准加入（見 **連線電腦**）。只把連線碼交給可以為這個工作區準備內容的人；如果外洩，請用 `workspace code` 更換。

## 教會資源庫

教會資源庫中的詩歌、背景、投影片和網站，每個工作區都能看到。一個工作區可以各自管理其中的類型（`workspace library <id> songs,backgrounds`，或 `all`）；對它管理的類型，它可以直接新增、編輯和移除教會的項目。對其他類型，以及在其他每個工作區中：

- 新的詩歌和背景留在那個工作區；
- 編輯教會的詩歌會讓工作區有自己的版本，只在那裡替換教會的版本，之後教會的修改不會影響它；
- 移除教會的詩歌或背景只會在那個工作區中隱藏它。

教會移除一首詩歌時，工作區自己的版本會作為那個工作區的詩歌保留下來。

編輯過教會詩歌的工作區會有它的 **兩個版本**，兩者都保持最新：教會的最新版本和它自己的。它的電腦會顯示兩者，並有一個切換，選擇工作區投影時使用哪一個；這個選擇按詩歌、按工作區設定，並像編輯一樣同步到工作區的其他電腦。**刪除我們的版本** 會永久回到教會的詩歌。電腦在教會的詩歌上顯示 **教會** 標記，在兩個版本都有的詩歌上顯示**2 個版本**；對它管理的類型，工作區兩者都不顯示，因為那些本來就是教會的。

無論由管理它的工作區還是在管理後台中，從教會資源庫刪除詩歌或背景都可以恢復：管理後台會列出已刪除的項目，**還原** 會把它帶回每個工作區；為某首詩歌做過自有版本的工作區會再次看到兩個版本，並繼續使用自己的。經過 `WORSHIP_Q_RETENTION_DAYS`（預設 90 天）後，每日清理會刪除已刪除項目的檔案；項目仍以已刪除、檔案已刪除的狀態列出，不能再恢復。工作區自己刪除的背景和投影片也會這樣清理；工作區只是隱藏的教會項目不算刪除，檔案會保留。

開啟某個類型時，會先顯示將發生什麼，沒有 `--yes` 就不會改變任何東西。給出的列表就是工作區之後管理的全部類型：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library <id> songs,backgrounds --yes
```

工作區中已開啟類型的項目會成為教會的。它對教會項目的自有版本會為每個工作區替換那些項目，包括沒有自有版本的工作區。它隱藏的這些類型的教會項目會重新出現。它們的檔案會移到教會的資料夾。關閉某個類型時，教會資源庫保持原樣。

如果要改為把某些類型的教會項目交給一個工作區，先為它關閉這些類型，再收歸它們：

```sh
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites
docker compose -f apps/server/compose.yaml exec worship-q node dist/cli.js workspace library-take <id> slides,websites --yes
```

這些類型中每個現存的教會項目都會成為這個工作區自己的，連同它的歷史和檔案。其他每個工作區會看到它從教會資源庫中被刪除；做過自有版本的工作區會把那個版本保留為自己的。教會這邊被刪除的項目不能恢復。

## 媒體：投影片、PDF、圖片和影片

在已連線的電腦上使用 **資源庫 → 媒體 → 新增媒體**，或把檔案拖到流程表上，就會把投影片、PDF、圖片或影片傳送到伺服器。每種類型有自己的大小上限（見上表）；電腦會在傳送前拒絕超過上限的檔案，伺服器在接收時也會再以 413 拒絕。

- **圖片**（JPEG、PNG、WebP、GIF）會在伺服器上縮小到 1920 × 1080 以內（從不放大），轉正方向，儲存為 JPEG，併為手機另存一個小圖。這使用伺服器內建的 `sharp` 庫：不需要另外安裝，沒有 LibreOffice 圖片也能用。HEIC 照片會被拒絕；Mac 會在傳送前把它們轉成 JPEG，Windows 電腦則會要求提供 JPEG。
- **影片**（MP4、M4V、MOV、WebM）按上傳時的樣子儲存；伺服器從不轉換它們。H.264 編碼的 MP4 在每台電腦上都能播放。每台電腦都會提前下載今天和之後流程表中的影片，所以聚會中不會線上播放任何內容。
- 投影片、PDF 和圖片的 **原始檔案** 儲存在它們的圖片旁邊，供 **下載原始檔案** 和 **重新轉換** 使用；管理後台的「儲存空間」頁面會計入它們。

### 投影片

PowerPoint（.pptx、.ppt、.ppsx）、Keynote、OpenDocument（.odp）或 PDF 檔案會被髮送到伺服器。伺服器用 LibreOffice 排版投影片，再用 Ghostscript 把每一張畫成圖片，兩者都已包含在 Docker 映象中。帶點選動畫的投影片每次點選會成為一張圖片；隱藏的投影片會被略過。投影片會儲存為一個用於逐張顯示這些圖片的內容項目，其他電腦同步時會取得這些圖片，所以斷網後也能投影。

轉換 100 張投影片大約需要 10–20 秒；一次只轉換一份。沒有 LibreOffice 或 Ghostscript 時（如果它們在別處，用 `WORSHIP_Q_SOFFICE`、`WORSHIP_Q_GHOSTSCRIPT` 指向它們），伺服器照常啟動，按鈕會說明無法轉換投影片。要在命令列上試轉一個檔案：

```sh
docker compose -f apps/server/compose.yaml exec worship-q \
  node dist/cli.js deck convert /data/some-deck.pptx /data/deck-test
```

只有伺服器上有投影片所用的字型時，文字才會保持原來的位置。映象中包含中文字型（Noto CJK，行高設為與製作投影片常用的字型相同）、與 Calibri、Cambria、Arial 和 Times New Roman 等寬的字型，以及構建時能下載到的 Microsoft 免費核心字型，例如 Trebuchet MS。

## 經文

電腦和手機透過這個伺服器顯示經文，伺服器用教會自己的金鑰呼叫聖經提供方。金鑰只留在伺服器上：從不寫入日誌，從不傳送給電腦或手機，管理後台只顯示每個金鑰是否已設定。

| 提供方 | 變數 | 從哪裡取得金鑰 | 提供的譯本 |
| --- | --- | --- | --- |
| YouVersion Platform | `WORSHIP_Q_YOUVERSION_KEY` | 在 developers.youversion.com 註冊一個應用程式；在門戶中接受每個出版方的許可（NIV 和當代譯本是 Biblica，NASB 是 Lockman），否則那些譯本會返回 403 | NIVUK、當代譯本（CCB、CCBT）、中文標準譯本（CSBS、CSBT）、BSB |
| API.Bible | `WORSHIP_Q_API_BIBLE_KEY` | api.bible；Starter 方案整個教會每月可呼叫 5,000 次 | NKJV、NLT、KJV，以及作為後備的 NIVUK 和開放版當代譯本 |
| ESV API | `WORSHIP_Q_ESV_KEY` | api.esv.org | ESV |
| Free Use Bible API | — | 不需要金鑰 | 新標點和合本（CUNP-S、CUNP-T）、KJV、BSB，以及作為後備的當代譯本和中文標準譯本 |

這些金鑰屬於教會，由教會為自己的使用註冊，這是每個提供方條款的要求（見經文調研 §4）。把它們和其他設定一起寫進 `.env`，然後重啟伺服器；日誌會說明哪些金鑰已設定，檢查完成後還會說明哪些譯本可用、透過哪個提供方。

在管理後台中 **選擇提供的譯本**：**教會預設設定 → 聖經譯本** 列出 Worship Q 認識的每個譯本，說明在已設定的金鑰下是否有提供方能提供它，並把勾選的譯本提供給每個工作區。在勾選任何譯本之前，電腦會顯示教會沒有提供聖經。**工作區的預設值** 從中最多選擇兩個，在工作區自行選擇之前，會並排顯示在它的每台電腦和手機上。

伺服器在啟動時和每天檢查每個譯本一次，某個提供方失敗時會改用下一個提供同一版本的提供方，並把每個譯本的目錄儲存在資料資料夾的 `bible/` 中（每個約 7 KB）。經文正文最多在記憶體中保留十分鐘，從不寫入磁碟。按照 API.Bible 的條款，伺服器會在後台把它的使用令牌報告給 API.Bible。

## 連線電腦

1. 在電腦上：**設定 → 教會連線**，輸入伺服器位址（`worship.example.org`）和這台電腦的名稱，然後選擇 **下一步**。
2. 伺服器有管理員時，電腦會顯示一個八位代碼和一個 QR 碼，然後等待。管理員開啟管理後台（或掃描 QR 碼，登入後會在那裡開啟這個請求），核對代碼和電腦的名稱，選擇工作區，選擇這台電腦是否可以把它自己的詩歌和流程表合併進去（沒有預設選項），然後批准。請求的有效期是十五分鐘。如果還沒有管理員，電腦會改為要求輸入連線碼：在管理後台中或用 `workspace create` 建立工作區，然後輸入顯示的連線碼。管理員也可以暫時開啟工作區的連線碼，電腦上會出現 **我有連線碼**。
3. 工作區的第一台電腦會上傳它的詩歌、流程表和設定。之後加入的電腦可以選擇 **兩者都保留**，把它的詩歌合併到工作區；或 **使用教會的副本**，替換它自己的內容。如果批准配對的管理員不允許合併，它只能選擇 **使用教會的副本**，即使工作區還沒有內容也不會帶入任何東西，工作區就從空白開始。如果這會讓電腦完全沒有詩歌，管理後台會發出提醒。無論哪種情況，都會先在應用程式的資料夾中 `backups/` 下儲存一份備份。

之後，內容每分鐘同步一次，每次編輯後幾秒鐘同步，另一台電腦有修改時也會立即同步。應用程式開啟期間，每 12 小時會發送一次異地備份，也可以按 **立即備份**。

## 整個場地的投影即時同步

工作區的每台電腦同步顯示同一套投影內容。最先連線的操作電腦作為 **主控端**（coordinator）主控投影；其他電腦跟隨它，在自己的投影螢幕和字幕上顯示同一張投影片，它們的開始、切換投影片、隱藏內容和清除畫面，以及對進行中流程表的編輯，都經由它進行。**設定 → 教會連線** 下的 **接管投影控制** 會把這個角色移到另一台電腦，不改變任何螢幕。

主控端把即時狀態同步到伺服器，伺服器會一直儲存它，直到即時狀態過期（最後一台操作電腦離開四小時後）。如果主控投影的電腦出了故障，其他電腦會顯示 **主控投影的電腦沒有回應。** 和 **在這裡繼續**，從同一張投影片繼續。出故障的電腦恢復後會改為跟隨。

同一網路上的電腦也會直接連線主控端，使用主控端自己生成的證書，透過 TLS 連線；證書指紋經由伺服器傳給其他電腦，所以沒有工作區憑證的裝置既不能讀取也不能傳送任何內容。透過 mDNS 在 47311 埠上發現。場地的網際網路中斷時，電腦仍會透過網路保持投影同步；既找不到伺服器也找不到主控端的電腦會獨立控制投影，其他電腦會跟隨它。更新後第一次啟動時，會請求一次允許應用程式存取區域網路（macOS），或在專用網路上透過防火牆（Windows）。設定中會顯示每台電腦的連線方式：**在區域網路上** 或 **透過教會伺服器連線**。

設為 **僅觀看模式**（設定）的電腦會在螢幕上同步顯示投影畫面，但不會主動開始或接管投影；重新開啟時仍是觀看端。適用於只需跟隨的投影電腦。

## 手機遙控

每台操作電腦在側邊欄底部的手機圖示下顯示它自己的 QR 碼和連結；兩者每隔幾分鐘更換一次。掃描或開啟它的手機會請求控制權，並顯示一個四位數代碼。操作員會在橫幅中看到同樣的代碼，然後批准。批准屬於工作區：之後這部手機在工作區的每台電腦上都保持已批准，即使批准它的電腦關閉了也是如此，直到有人選擇 **斷開** 或 **全部斷開**（後者也會讓所有瀏覽器遠端畫面連結失效）。

手機可以切換投影片、跳到進行中流程表的任何一張投影片，以及隱藏內容。用 **編輯**，還可以搜尋資源庫，在進行中的流程表上新增、移除詩歌或調整順序；每位操作員都會在橫幅中看到每一次修改，主控端還有 **撤銷**。只批准你信得過、可以掌管聚會流程的人。手機不能編輯詩歌、開啟另一個日期的流程表或修改設定。手機透過伺服器連線；邀請中也會寫明主控端在場地網路上的地址，但手機瀏覽器只有在接受主控端的證書後才能使用它。

## 瀏覽器遠端畫面

**設定 → 瀏覽器遠端畫面** 會建立連結，透過伺服器在任何瀏覽器中顯示投影或字幕，例如在沒有安裝 Worship Q 的直播筆記本上作為 OBS 的「瀏覽器」來源。每個連結帶有自己的金鑰：頁面不在瀏覽器儲存中儲存任何東西，不設定 Cookie，也不要求登入，所以全新的瀏覽器第一次開啟連結就能顯示遠端畫面，並且在日期變更、重啟和交接之後一直有效，直到連結被撤銷。瀏覽器有工作區的字型時頁面會使用它，否則使用系統字型，已連線裝置的列表會說明用的是哪一種。任何擁有連結的人都能看到投影上的內容。

在執行 Worship Q 的電腦上，OBS 和瀏覽器也可以在沒有網際網路的情況下，透過 `http://127.0.0.1:47310/slideshow`顯示投影，字幕則在 `http://127.0.0.1:47310/overlay/subtitle`。

## 已連線的裝置

**設定 → 已連線的裝置** 列出正在同步投影的每台電腦、手機和瀏覽器遠端畫面、它們的角色和連線方式，手機和遠端畫面旁邊有 **斷開**，還有 **全部斷開**。

## 現場音訊

工作區的一台電腦可以把調音台的聲音廣播給工作區的其他電腦、已批准的手機和已登入的管理員，他們按下 **收聽** 即可。音訊直接在裝置之間傳送，從不經過這個伺服器：伺服器只傳遞建立每個連線所需的訊息。廣播會另外錄製：在教會錄製期間，廣播的電腦會把它自己的錄音上傳到這個伺服器（見 [聚會記錄](#聚會記錄)）。

大多數教會什麼都不用設定。場地網路上的裝置透過各自的地址互相找到。在家收聽的人透過公共 STUN 伺服器連線到廣播端，`GET /api/v1/ice` 會把它交給已註冊的裝置（預設 `stun:stun.l.google.com:19302`；可以用 `WORSHIP_Q_STUN` 替換，或設為空表示不用）。

有些網路（通常是行動網路）不允許直接連線。對這些網路，可以在伺服器旁邊執行可選的中繼 coturn。它是一個 Compose profile，預設關閉：

1. 選一個很長的隨機金鑰，加到 `apps/server/.env` 中：

   ```sh
   WORSHIP_Q_TURN_SECRET=<a long random secret>
   WORSHIP_Q_TURN_URL=turn:worship.example.org:3478
   WORSHIP_Q_TURN_LISTEN_IP=<this host's own address, as `ip addr` shows it>
   WORSHIP_Q_TURN_EXTERNAL_IP=<the public address>   # or public/private behind NAT
   ```

2. 在主機的防火牆和託管服務商的防火牆中，向網際網路開放 **UDP 3478** 和 **UDP 49160–49180**。這些不經過反向代理或 CloudFront；中繼在伺服器自己的地址上應答。每個經中繼的收聽者使用 21 箇中繼埠中的一個。
3. 與伺服器一起啟動它：`docker compose -f apps/server/compose.yaml --profile turn up -d`。
4. 檢查：`/api/v1/info` 顯示 `"audioRelay":true`。在場地之外，用中繼的地址和以裝置令牌從 `GET /api/v1/ice`取得的憑證執行 Trickle ICE 頁面（webrtc.github.io/samples）；出現 `relay` 候選就說明它可以用。

每台裝置在每次建立新連線前都會向伺服器請求憑證；憑證有效十分鐘，由從不離開伺服器的金鑰生成。無法連線的收聽者會被告知教會是否提供中繼。不提供基於 TCP 或 TLS 的 TURN。

## 聚會記錄

伺服器儲存三種聚會記錄，它們都不會改變協議版本。

**現場音訊錄音。** 工作區廣播現場音訊時，廣播的電腦會錄製它自己的輸入，並以五秒為一段上傳，所以錄音會隨著聚會進行在伺服器上逐漸增長。任何工作區都不需要做什麼。那台電腦「設定」中 **廣播現場音訊** 下方的文字會說明廣播正在被錄製；螢幕上其他地方都不會顯示。同一個輸入的每一次連續使用就是一段錄音：拔下音訊介面再插回去會產生兩段。只在場地網路上進行的聚會會儲存在廣播的電腦上，最多 500 MB（約 17 小時），連上伺服器後再上傳。

- **關閉錄製。** 管理後台的 **設定 → 錄製現場音訊** 預設開啟，是教會唯一的開關，一次作用於所有工作區。關閉期間，不會錄製任何新內容，正在進行的錄音也會停止。
- **儲存位置。** `/data/recordings/<workspace>/<id>.webm`（Windows 錄製的 WebM，Opus 編碼）或 `.m4a`（Mac 錄製的 MP4，AAC 編碼），即電腦錄製時的格式；伺服器從不轉碼。每廣播一小時約 29 MB。
- **保留多久。** `WORSHIP_Q_RECORDING_DAYS`，預設 90 天，由與已刪除檔案相同的每日清理刪除；`0` 表示一直保留到被刪除。「儲存空間」頁面把它們單獨計為一類。
- **收聽。** 管理後台中每個工作區的頁面都有 **記錄**：選一天來播放、下載或刪除當天的錄音。

**投影紀錄。** 主控端會記錄顯示過的每一項，以及它開始和結束的時間，並上傳；顯示不到一秒的不會保留。每條記錄寫明當時螢幕上那首詩歌的修訂版本，所以即使詩歌之後被編輯或刪除，也能看到當時唱了什麼。投影紀錄永久儲存：一次聚會只有幾百行小記錄。它在 **記錄** 下與錄音一起列出，也可以透過本地 API 完整讀取。

**本地 API。** 第二個監聽器在容器內的 8081 埠上，向這台機器上的其他服務提供唯讀的 API，內容包括流程表、投影紀錄和錄音；見 [本地 API](../local-api.md)。Compose 只在 `127.0.0.1:8081` 上釋出它（`WORSHIP_Q_LOCAL_API_PORT`可以改變主機埠；把 `WORSHIP_Q_LOCAL_PORT` 設為空會關閉它）。

- **它沒有金鑰。** 任何能連到這個埠的東西都能讀取它提供的全部內容。絕不要讓反向代理指向它，也絕不要在`127.0.0.1` 以外的地址上釋出它。不用 Compose 執行伺服器的教會也必須這樣做。
- 在伺服器本機上檢查：`curl -s localhost:8081/local/v1` 會返回 API 的版本；從另一台機器發出同樣的請求則不會有回應。

## 更新伺服器

在一週的前幾天，在伺服器上執行 `scripts/update-server.sh`。它會拉取最新的提交，重新構建並重啟容器；伺服器啟動時會自行遷移資料庫。電腦在釋出後六小時內會自行更新，並在操作員重新啟動應用程式時安裝更新。

當某個版本提高了協議版本時，請先更新伺服器。伺服器會繼續接受較舊的電腦，它們仍可正常投影和同步，每項新功能只提供給認識它的電腦。釋出說明會寫明某個版本是否需要先更新伺服器，或需要先設定什麼。

## 已知限制

- 兩台電腦在同步之前編輯了同一首詩歌或同一天的流程表時，後來的編輯生效。較早的詩歌版本儲存在詩歌的歷史中。
- 在一台電腦上刪除背景會在那個工作區中隱藏它。從教會資源庫刪除的背景或詩歌會在保留期內保留檔案，之後檔案會被刪除。
- 管理員登入已在 nginx 後面配合 Microsoft Entra ID 實際使用，但還沒有在 Google Workspace 上或經過 CloudFront 試過；見 `docs/spikes/oidc.md`。
- 工作區隱藏的教會詩歌不能在那個工作區中取消隱藏；教會資源庫修改這首詩歌也不會讓它重新出現。
- 手機瀏覽器通常會拒絕主控端的自簽名證書，所以手機要透過伺服器連線，場地需要有網際網路；電腦則不需要。
