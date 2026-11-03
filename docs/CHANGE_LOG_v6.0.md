# CubBadge v6.0 更新紀錄

日期：2026-09-30

## 1. 回報／意見傳送狀態更清晰

- 內建本機「問題回報 / 意見回饋」視窗，保留原有 Scout Admin 統一收件格式。
- `/api/proxy` 新增 `submitFeedback` 本機 action，回應必定帶 `deliveryStatus`：
  - `confirmed`：收件系統已確認收到。
  - `unknown`：連線中斷或上游回覆不可確認；前端會提示不要重複提交，需按「確認重送」才會重發。
  - `rejected`：收件系統明確表示未接收。
  - `not_sent`：請求驗證失敗或收件匣設定錯誤，肯定未送出。
- 傳送中會鎖定欄位及送出按鈕；成功後不再自動關閉，讓用戶清楚看到結果。

## 2. 2026 新修訂幼童軍訓練綱要過渡安排

- 在「我的進度」加入「現行綱要 → 新修訂綱要過渡安排」面板。
- 內容按香港童軍總會通告 P022/2026 幼童軍支部整理：
  - 2026-08-15 生效；2026-08-15 或以後宣誓成員必須採用新綱要。
  - 2026-08-15 前宣誓成員的兩年過渡期（2026-08-15 至 2028-08-14）。
  - A–E 個案：會員章／幼童軍獎章／歷奇章／高級歷奇章及金紫荊銜接。
  - 活動徽章新舊並列佩戴安排。
  - 新金紫荊延長年限及學籍證明提示。
- 領袖可為已核實成員加入「過渡等同紀錄」；此紀錄：
  - 不會刪改舊進度；
  - 不會自動勾選任何新綱要細項；
  - 不計入現行清單完成百分比；
  - 只作 P022/2026 過渡核實紀錄。

## 3. 補齊官方活動徽章內容

- 移除 ACT-07 至 ACT-40「請查看官方訓練綱要」佔位文字。
- 為現行 40 個幼童軍活動徽章加入真實目的、摘要及要求內容。
- 補回官方「其他徽章」中的「童軍先修章」。
- 補回 L3「科學與大自然」遺漏選項：
  - 星空
  - 園藝
  - 天氣
  - 自然世界
- 修正金紫荊「歷險挑戰」說明，清楚分開甲部及乙部指定活動徽章。
- 更新英文 overlay，避免英文介面仍顯示舊佔位文字。

## 4. Google Apps Script 後端相容修正

- `handleLoad` 回傳進度備註欄，支援過渡等同紀錄說明。
- `handleSave` 只有在前端明確傳入 `note` 時才覆寫備註，舊前端不會清空既有備註。
- 修正 `handleSaveOtherBadge` 舊版欄位錯位問題：
  - 第 3 欄保留「獎章名稱」；
  - 第 4 欄寫入完成日期；
  - 第 5 欄寫入證書編號；
  - 第 6 欄為備註；
  - 第 7 欄為更新時間。
- 取消其他獎章時支援刪除該列。

## 5. 測試

- 新增 `test/feedback_transition.test.mjs`：覆蓋回報 deliveryStatus、活動徽章資料完整性、P022/2026 過渡資料及 Apps Script 欄位修正。
- 更新 HTML integrity 測試至 v6.0。
- 完整測試：`npm test` 全部通過。

## 6. 首次登入教學補回＋主系統介紹暫時隱藏（2026-10-23，對齊 ScoutBadge PR #42／#43）

- `index.html`「新旅團部署」頁新增**步驟 4「首次登入（預設管理員帳號）」**（中英雙語，鍵 `s_fl_h`／`s_fl_p`）：
  - 首頁揀旅團卡 →「👤 家長/成員」分頁 → YMIS `1111111111`／密碼 `changeme`（`initializeSheets()` 自動建立）；
  - 首次登入強制改密（本系統規則 4-8 位）；
  - 之後喺「審批中心」批申請、喺「用戶管理」開領袖自己帳號。
  - 新增**步驟 5「私隱選擇」**（鍵 `s5h`／`s5p`），對應用戶管理→私隱設定。
- 主系統（scoutsystem-2.0）未開發完成，**暫停對外推廣**：主系統平台卡、部署地圖卡、軌道B 步驟全部以
  `[主系統暫時隱藏 2026-10]` 標記用 HTML 註解隱藏；`setup_portal_card`／`setup_map_card`／`s4h`／`s4p`
  等 i18n 鍵**保留未刪**（Portal／sig 整合程式碼照常運作）。
  - `setup_submit_p` 文案改為只講獨立使用的登記流程；英文 `setup_h2` 移除舊有 "Super-admin hidden" 字樣。
  - 主系統完成後：搜尋 `[主系統暫時隱藏]` 解除註解，並重排部署步驟號。
- `docs/LEADER_GUIDE.md` 新增「首次登入（預設管理員帳號）」章節及「主系統整合暫停對外推廣」告示。
- 部署步驟：1 下載 → 2 部署 → 3 提交登記 → 4 首次登入 → 5 私隱選擇。


## 7. 初始化及 API Key 顯示不再提供自動取得的部署網址（2026-10-24，GS 2026.10.24）

- 按使用者最終決定：可以只顯示 API Key，但不能顯示未能確認的 URL；不增加要求用戶貼網址／設定 BACKEND 的步驟。
- `initializeSheets()` 彈窗現在只提供現有 API Key，不要求輸入旅團編號；執行回傳值亦移除 `scriptUrl`，避免出現第三條不實部署網址。
- `showApiKey()`、`showVercelEnv()`、`vercelEnvLines()` 及旅系統選單統一不提供 BACKEND 值。
- 選單改稱「🔑 顯示 API KEY（交 ADMIN）」。移除自動驗證 BACKEND 的選單；相容舊已開啟選單的函式只顯示說明，不回網址或發請求。
- 移除以 `getUrl()` 自動快取 `WEBAPP_URL`、`selfUrl` 自我回報及 56／74 字元分類部署等不可靠方案。舊快取不再讀取，但不擅自刪除既有設定。
- 官方部署網址仍由 Google 部署視窗提供；不改既有 APP ADMIN 登記契約、API Key、登入／簽名協定或業務資料。
- 中英文部署說明、前端最新 GS 通知／下載參數及相關文件同步更新。
- 新增 `test/credential-display.test.mjs`（12 項）：覆蓋三個不同自動 URL、舊快取、初始化彈窗及回傳值、所有顯示入口、舊選單相容、禁止新增貼網址步驟、新安裝無旅團編號也可生成 Key、資料及 API Key 保全。


## 8. 系統介紹及簡化旅團登記（2026-10-24）

- 首頁新增「🌿 系統介紹」分頁；與「新旅團部署」提供雙向入口。
- 加入既有「支部進度追蹤系統」圖的無損 WebP 副本（`assets/system-introduction-zh-hant.webp`，不改原圖），支援手機閱讀、放大及下載；圖片外的說明支援中英切換。
- 公開說明不披露保留帳號，並清楚保留 API 登入／權限驗證尚待補強的安全邊界；沒有更改驗證行為。
- 按使用者更正，刪除初始化的旅團編號輸入提示，不新增編號設定選單。API Key 顯示改為獨立的 `API Key = ...`，不依賴 `TROOP_<id>` 命名或顯示「未設定」。
- 旅團編號及名稱只需在原有 ADMIN FORM 填寫；登記 API 契約、現有 Script Properties、API Key 與業務資料不變。
- 加入新安裝無旅團編號、選單取 Key、介紹分頁／交叉連結／語言切換及部署圖檔完整性回歸測試。


## 9. 後端網址格式相容及診斷邊界（2026-10-24）

- registry 及接入申請轉送支援把合法 Workspace `/a/<domain>/macros/s/<id>/exec` 轉成相同部署 ID 的公開路徑格式；不代表已找到或核實使用者選定的部署，亦不能改變 Google 的存取設定。
- 僅接受 HTTPS GAS `/exec`，不藉正規化移除或接受 query、fragment、帳密或自訂連接埠。
- health 只公開是否使用 Workspace 路徑的 boolean，不回傳 API Key 或部署 URL；非 JSON 提示不再直接斷定是錯誤／舊部署。
- API 回歸測試涵蓋格式相容、拒絕不合法網址及公開回應不洩漏連線憑證。


## 10. 舊 HTML 反覆出現：入口快取及前端版本防護（2026-10-24，frontend 2026.10.24.1）

- 使用者確認直接輸入 `https://cubsbadge.vercel.app/` 會先見橙色舊版、F5 後變黃；兩張圖的版本、綱要、選單及旅團列表亦不同，不是同一份 HTML 的轉色。
- 獨立讀取線上站點為 v6.0；目前尚未在使用者的瀏覽器／快取環境復現，不能判定是哪一個快取層。撤回 v5.8.1 文件「F5 一次就永不再發生」的保證。
- `/` 及 `/index.html` 對瀏覽器及 CDN 設 `no-store`；移除自有 assets 一週快取／stale-while-revalidate，改成重驗；JS 引用附前端 build 版本。
- 新增只回傳前端 app/build 的同源 `frontend-version` API，以及啟動／bfcache 恢復／返回分頁時的版本核對。版本不同時以帶版本參數的 URL 最多自動更新一次，保留原 query／hash；離線、逾時、錯誤回應不阻塞網站。
- 有未儲存進度、正在傳送、編輯視窗或輸入焦點時不自動更新。不刪除 localStorage／IndexedDB／CacheStorage、不登出、不清除待同步資料。
- 舊版 HTML 若根本沒有新檢查程式，不能被新 JS 隔空修復；須先取得新版 HTML，現有防護才會生效。具體診斷與驗收限制見 `FRONTEND_CACHE_DIAGNOSIS.md`。

## 11. 修正已有 Sheet 被要求重新初始化（2026-10-24）

- 本版 `initializeRequired` 改為 false，版本判定亦真正尊重此旗標；已有正常 Sheet 不因初始化標記較舊／缺失而顯示必須 RUN SCRIPT。
- GS 版本已為 `2026.10.24` 的旅團，只需部署本次網站修正；沒有更改 GS 本體或任何 Sheet／API Key。
- 舊 GS 仍須換程式及部署；新建 Sheet 首次使用仍須初始化。公告、指南及同系交接要求同步更正，不把版本核對說成已完成初始化／資料結構驗證。

## 12. 修復停用帳戶重新啟用及成員角色更新（2026-10-25，frontend 2026.10.25.1；GS 2026.10.25）

- 用戶管理載入清單時明確請求包含已停用帳戶；它們會出現在「顯示已停用」區域，領袖可直接按「重新啟用」。
- 修正帳戶角色下拉選單的請求格式：`apiRequest` 需要完整 action object，但舊程式把 action 當字串傳入，導致更新請求沒有 `action`／session token；現可正常更新成員為幼童軍領袖（團長／副團長）等可管理角色。
- 新增獨立「小隊職務」選單，不混用帳戶角色。正式 `squad_role` 儲存值為 `member`（隊員）、`sixer`（隊長）、`vice_captain`（副隊長）；副隊長不使用 `branch_leader` 或 `seconder`。後端驗證正式值，前端可更新 Users 帳號成員及無帳號純成員；舊資料中的中文隊職名稱讀取時映射顯示，不會因讀取而改寫 Sheet。
- 純成員首次設定非預設職務時，只在「成員名單」最右新增 `squad_role` 欄；既有欄位及資料不搬動、不覆寫。其餘用戶資料、API Key、進度及活動紀錄均不遷移或重設。
- 停用帳戶查詢亦適用於上游簽名路徑；隱藏停用帳戶時會避免它因仍留在成員名單而被誤列成純成員。
- Apps Script 原有重新啟用、帳戶角色權限及旅長唯一鎖不變。GS 2026.10.25 須更換並重新部署，已有正常 Sheet 毋須執行 `initializeSheets()`；新建 Sheet 首次使用仍須初始化。
- 新增回歸測試，覆蓋包含停用帳戶的查詢、帳戶角色 payload、正式小隊職務值／拒絕非正式別名、純成員最右新增欄與原資料保全，以及前端職務選單與請求。

## 13. 領袖登入「忘記密碼」（2026-11-02，frontend 2026.11.02.1；GS 2026.11.02）

**問題**：領袖用 Email 登入，但登入頁無任何自助重設入口；忘記密碼只能靠團長／管理員喺「用戶管理」人手重設。

**做法**（前端 `index.html`、proxy `api/proxy.js`、後端 `apps-script/Code.gs` 三層）：

- 登入頁「👨‍💼 領袖」分頁新增「🔑 忘記密碼？」連結（家長／成員用 YMIS 登入，唔顯示），中英對照兩步 modal：①輸入登記電郵 ②輸入電郵收到嘅 8 位重設碼 + 自訂新密碼（4-8 位）。
- 後端新增兩個公開 action：`requestPasswordReset`（寄一次性重設碼）／`confirmPasswordReset`（驗碼改密）。授權完全來自「寄到 Users 表登記電郵嘅重設碼」，**唔讀** request 自帶嘅 token／apikey／指定 YMIS／角色；proxy 亦主動剷走呢啲身份欄位。兩個 action 唔列入 `SENSITIVE_ACTIONS`，避免未設 `TROOP_*_APIKEY`、一直靠 token 運作嘅旅團用唔到。
- 只受理「啟用中＋領袖或以上角色＋已登記電郵＋已設密碼」嘅普通帳戶；保留帳號、`super_admin`、停用帳號、家長／成員帳號一律唔寄信。所有請求（包括帳戶唔存在）回應完全一致，唔可用嚟探測帳號。
- 重設碼只存 SHA-256 雜湊、15 分鐘到期、最多 5 次嘗試、一次性；新申請作廢舊碼；成功／過期／帳戶中途被停用降級即作廢其餘碼；成功後該用戶所有舊 session token 即刻失效，並寫一條唔含密碼／重設碼嘅中性操作紀錄。
- 新增「密碼重設」工作表：新建 Sheet 由 `initializeSheets()` 建立；**已有正常 Sheet 毋須重跑初始化**，第一次有人撳「忘記密碼」時由 `getPasswordResetSheet()` 即用即補，只加表、唔郁任何現有資料。24 小時前嘅紀錄自動清走；同一電郵 30 分鐘最多 3 次、全團每小時最多 30 次，防止公開入口被用嚟洗版／耗盡發信配額。
- 發信失敗（最常見：換 Code.gs 後未重新授權 Google「傳送電郵」範圍）唔再靜默：後端記全團旗標並回 `delivery:'unavailable'`，前端老實提示聯絡團長／執行 `testPasswordResetMail()`。旗標係全團共通，唔會洩漏邊個電郵係有效帳戶。
- 舊 GS（未換 Code.gs）會回 `Unknown action`，前端顯示明確升級提示，唔會當成「後端斷線」；團長仍可喺「用戶管理」直接重設密碼。

**部署**：GS `2026.11.02` 必須更換 `Code.gs` 並重新部署新版本（沿用原 URL）。換檔後請喺 Apps Script 編輯器執行一次 `testPasswordResetMail()`，容許 Google 嘅「傳送電郵」授權並收一封測試信；呢個函式唔寫任何工作表、唔改任何帳號資料。已有正常 Sheet 毋須 `initializeSheets()`；新建 Sheet 首次使用仍須初始化。完整安全設計見 [docs/PASSWORD_RESET.md](PASSWORD_RESET.md)。

**測試**：`test/password-reset.test.mjs`（12 項，經真正 `doPost` 路由）覆蓋完整重設流程、不洩漏帳號、雜湊入表、錯碼計次／鎖定、過期、限速、舊碼作廢、提權欄位無效、中途停用降級、舊 Sheet 自動補表、發信故障旗標、前端／proxy／版本一致性；`test/api.test.mjs` 新增 2 項 proxy 防線測試。`npm test` 全數通過。

## 14. 密碼重設及初始化安全修補（2026-11-02，GS 2026.11.02.2）
- `resetPassword` 的簽章路由修正參數次序；handler 拒絕重設保留角色，並於成功後清除登入失敗記錄、撤銷目標的舊 session，保留強制改密標記。
- `requestPasswordReset` 無論寄信成功或失敗均回相同中性訊息，前端不再宣稱已寄出。
- `initializeSheets()` 不再清理舊帳戶、session 或改寫歷史標籤；進度表表頭只補空格，不覆蓋已有值。既有資料不刪改。
- 本次不新增表或欄；建議更新 Code.gs 後執行一次 `initializeSheets()`，跨多版本升級必須執行，以補齊缺失表及欄。回滾可部署上一版 Code.gs；回滾後舊 session 不會復原。
- 新密碼改用 PBKDF2-HMAC-SHA256（120,000 次、16-byte salt）；舊 SHA-256 成功登入後升級，搬數接受兩種格式。登入錯誤訊息統一並補鎖定及稽核；改密撤銷其他 session。管理重設和審批等回應不再回傳明文密碼。
- 代理要求敏感寫入附帶登入 token；密碼同步只接受可信節點直連，附帶 token 時不允許 API key 取代角色驗證。直連簽章與 key 搬數保留。
- 沒新增 action 或必需工作表；影響登入、改密、重設、搬數與部署初始化。PBKDF2 在 Google Apps Script 的實際效能及部署授權仍需在測試旅團驗證。

## 15. 搬數授權及資料保全（2026-11-02，GS 2026.11.02.3）
- 使用登入 session 或上游簽章搬數時，`upsertUser`／`importUsers`／`importAll` 在寫入前核對操作者能否管理目標既有及新角色；拒絕時不改動該帳戶。以電郵匹配的帳戶亦受相同檢查。可信的試算表選單及直接 API key 搬數保持可用。
- 匯入變更密碼 hash 後撤銷該帳戶的舊 session 並清除登入鎖定；相同 hash 重複匯入不影響 session。匯入 Drive 檔後保留原檔，不再自動移到垃圾桶。
- 無新增工作表或欄。建議每次更新後執行 `initializeSheets()`；跨多版本升級必須執行。回滾不能使用不支援 PBKDF2 的舊版，否則已升級帳戶無法登入；需使用保留 PBKDF2 支援的相容版本。

## 16. 版本公告防止誤降級（2026-11-03，frontend 2026.11.02.4）
- 以數字順序比較 GS 發佈版本；後端比網站新時提示先更新網站，隱藏舊版 GS 下載，不再誤報後端需要降級。無法識別的版本亦不會要求覆蓋後端。
- 只改前端公告，未改 GS、工作表或資料；無須因此重新初始化。需部署新網站後才會生效。

## 17. 修復普通帳戶登入逾時（2026-11-03，GS 2026.11.03.1；frontend 2026.11.03.1）
- 用隨 Code.gs 一併提供的 MIT 授權 @noble/hashes 1.8.0 執行 PBKDF2-HMAC-SHA256，不再在每次迭代呼叫 Apps Script Utilities；仍維持 120,000 次、原有 salt 及 hash 格式，不需修改或重設密碼。
- Node mock 實測與 Node crypto 的 PBKDF2 結果一致；Google Apps Script 真實執行時間仍需測試旅團確認。
- 本版沒有新增表或欄；部署時可安全重跑 `initializeSheets()` 補齊缺漏，保留所有既有資料及 API Key。回滾須保留能驗證 PBKDF2 的相容版本，不能退回只支援舊 hash 的 GS。

## 18. 臨時密碼視窗回歸測試（2026-11-03，frontend 2026.11.03.2）
- 舊前端等待後端回傳明文密碼，與新版後端的保密設計不相容，會顯示空白；新版前端顯示本地輸入值或預設值，並支援複製，不要求後端回傳密碼。
- 為留空、自訂、重新啟用、失敗及複製加入前端回歸測試；關閉視窗時清除顯示及暫存的密碼。

## 19. 初始化閘口及初始化唯一入口（2026-11-03，GS 2026.11.03.2；frontend 2026.11.03.3）

- **單一更新入口**：選單新增「🔧 初始化／更新（執行 initializeSheets）」唯一入口，直達 `initializeSheets()`；保留 `repairSheets` 僅供內部調用，不再分多個「更新」選單造成困惑。`initializeSheets()` 保持冪等只加不改：補建缺少工作表／欄位及預設值，絕不刪改用戶資料或更換 API Key；跨多版本升級必須執行一次。
- **/exec 網域正規化**：GS `canonicalServiceUrl_()` 與 Vercel `canonicalBackendUrl()` 同時兼容兩種 Workspace 網域形式（`/a/macros/<domain>/s/` 與 `/a/<domain>/macros/s/`），統一正規化為公開 `/macros/s/` 形式；`backendHashes()`/`backendMatches()` 比對兩種形式雜湊，避免因 URL 形式不同誤判為未接入。
- **完成幻覺阻斷**：GS 新增 `GS_INIT_REQUIRED=true` 及 `initializedGsVersion` 標記，`getCubGsReleaseStatus()` 回報 `initRequired/gsVersion/initializedGsVersion/gsInitializationCurrent`；`showApiKey()`/`showVercelEnv()`/`menuShowLinkCredentials()` 在未初始化時頂部顯示 `⚠️ 尚未完成初始化／更新` 警告，避免領袖以為「抄到 Key 就完成」。
- **新旅團申請閘口**：`api/register.js` 以匿名 `GET ?action=ecStatus` 探測 `initRequired`，未初始化時回 `422 INIT_REQUIRED` 且不轉發至 Scout Admin；回應不包含 backend URL 或 apikey 值，`action=ecStatus` 無需憑證即可探測初始化狀態。
- GS `2026.11.03.2` 必須更換 Code.gs、部署新版本並執行一次 `initializeSheets()`；已初始化舊旅團更新後亦須重跑一次以寫入新版標記。回滾可部署上一版 GS，但未初始化標記會回到舊版狀態。

**問：領袖更新前用 `showApiKey()` 抄走舊憑證能否繞過閘口？** 不能。舊旅團 `initializeSheets()` 前：① 前端 `api/register` 下一步提交申請前會匿名探測 `ecStatus` 發現 `initRequired=true` 且 `initializedGsVersion !== gsVersion`，直接 422 攔截，不往 Scout Admin 轉發；② 就算領袖自行保管舊 Key，GS 側 `initStatusWarningLines_()` 已在 `showApiKey` 等顯示頂部警告，且 `getCubGsReleaseStatus()` 供前端核對版本狀態；③ 新旅團 Sheet 根本無 Key，必須先初始化才產生。初始化完成前，任何憑證都被視為「暫未可用」。

