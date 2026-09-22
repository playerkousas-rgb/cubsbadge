# 旅系統升級清單（AGENT 執行版）＋現況

> 本檔 = 呢輪升級嘅**版號／規格唯一記錄**（程式碼內唔寫版號註解）。
> 後端版本字串：`cub-leaf`

## 原文清單（照抄，唔改字）

進度追蹤旅系統升級版 — 跟住改。舊進度已完成，現升級旅系統。照做就得。

變數 ABCD（唔入 SHEET）
A = SUPER_KEY（超管隱藏，與旅無關）
B = TROOP_(id)_BACKEND（部署後抄 URL）
C = TROOP_(id)_NAME（交 ADMIN 時填）
D = TROOP_(id)_APIKEY（生成後交 ADMIN 轉登記）
B/D 由 GS 生成，C 自填，A 隱藏。四個唔寫入 SHEET，經收件匣交 ADMIN。

上下游接入
部署 GS，抄 B 的 URL，生成 D 填 C，連 B/D 經收件匣交 ADMIN
每團補一張支部 SHEET，與現有進度 SHEET 成對
上游控下游寫：掣在上游（旅控團、團控進度），旗 ALLOW_LOCAL_LOGIN 寫在下游 ScriptProperties，閂後只收 sig
開戶：閂口後新戶在上游揀團開戶，經 sig 落下游寫

吐 JSON（搬舊數）
舊進度有數，新支部空 → 在舊進度按「匯出 JSON（含 hash）」
在新支部按「匯入」，逐個 upsertUser 直插 hash（保留舊密碼）
匯完可閂下游直接入口

唔做
不在 SHEET 寫 ABCD
不改 A
不設回調

清理
GS 內 // vX.X 註解全拆，版號只留本 MD

## 現況：逐條核對（本倉 = 下游 leaf；支部 SHEET／旅前端屬旅系統，唔喺本倉）

| 清單項 | 現況 | 證據 |
|---|---|---|
| A 超管隱藏、與旅無關 | ✅ | `SUPER_KEY` 只喺 Vercel env；leaf 零讀寫（`superKeyConfigured()` 永遠 false） |
| B/D 由 GS 生成 | ✅ | `initializeSheets()` 生成 D（`API_KEY` Script Property）；B = 部署 `/exec` URL，由 `ScriptURL`／`showVercelEnv()` 顯示 |
| C 自填 | ✅ | `setTroopId()` / `showVercelEnv()`（`TROOP_NAME` Script Property） |
| ABCD 唔寫入 SHEET | ✅ 12 張表全部儲存格零命中 | 測試「SHEET 驗收：全表零 APIKEY／BACKEND／sheep／URL 儲存格」 |
| ABCD 唔入前端 | ✅（今次補齊） | 今次之前 `/api/troops` 會回 `backend` URL、`/api/health` 會回 `fullBackend` → 已改為只回 `connected:true` / `backendConfigured:true`；測試「B/D 唔入前端：/api/troops 同 /api/health 回應零部署 URL、零 apikey」 |
| 經收件匣交 ADMIN | ✅ | 前端表單（旅團編號／部署 URL／API Key）→ `POST /api/register`（**body**，唔落 URL）→ 後端管理 GS；`SUPER_KEY` 驗證 |
| 每團補一張支部 SHEET | — 旅系統 | 你已答：屬旅系統，本倉唔建（v5.6 定案一致：leaf 只需被登記） |
| 上游控下游寫、掣在上游 | ✅ | 本倉**冇**加掣（你已答維持）；旗由上游經 sig 寫 |
| `ALLOW_LOCAL_LOGIN` 寫在下游 ScriptProperties | ✅ 預設 true | `getAllowLocalLogin()`；`initializeSheets()` 未設就寫 `'true'`；`showDownstreamAccess()` 可查 |
| `setDownstreamAccess` 只收上游 sig | ✅ | `handleSetDownstreamAccess()`：`isSigRequest()` 唔過 → `NEED_SIG`；成功寫旗 + 審計 `via=sig` |
| 閂後只收 sig、本地 403 | ✅（今次補齊） | GS 側 `DOWNSTREAM_CLOSED` 閘（login／apply／本地寫入）；**`api/proxy.js` 今次把 `DOWNSTREAM_CLOSED` 轉 HTTP 403**（之前一律 200） |
| 開戶：閂口後上游揀團開、經 sig 落下游寫 | ✅ leaf 側 | 上游 sig 可過閘（`ecSigLogin` / `isSigRequest`）；「揀團開戶」UI 屬旅系統 |
| 吐 JSON：舊進度「匯出（含 hash）」 | ✅ | `handleExportAll({includeHash:true})`（需領袖 token／apikey／sig） |
| 新支部「匯入」→ `upsertUser` 直插 hash（保留舊密碼） | ✅ | `handleImportAll()` / `handleUpsertUser()`；匯入後舊密碼照用（測試覆蓋） |
| 匯完可閂下游直接入口 | ✅ | 同一支旗 `ALLOW_LOCAL_LOGIN=false` |
| 不在 SHEET 寫 ABCD / 不改 A / 不設回調 | ✅ | 全倉掃描 `onEdit|newTrigger|callback|postMessage` 零命中；A 冇被讀寫 |
| 清理 `// vX.X` 註解 | ✅ | `apps-script/Code.gs`、`api/**`、`index.html` 零註解版號；版號只留 MD |

### 驗收對照

| 驗收 | 結果 |
|---|---|
| SHEET 搜 `APIKEY` / `BACKEND` / `sheep` 零命中 | ✅ 0 命中（lifecycle 行完掃 12 張表全部儲存格） |
| 無 onEdit | ✅ |
| 未掛接前兩邊可登入 | ✅ `ALLOW_LOCAL_LOGIN` 預設 `true` |
| 掛後上游一鍵閂、下游本地 403、只收 sig | ✅（今次補返 HTTP 403） |
| 上游揀團開戶成功 | ⏳ 上游側 |

## 今次改動（本倉）

1. **SHEET 零 `sheep`**：超管寫表一律用中性代號 `APP_ADMIN`
   - 新增 `SUPER_STORAGE_ID='APP_ADMIN'`；`createToken()`／`writeAudit()` 超管相關寫入全部用佢
   - `isSuperAdminId()` 認得中性代號（新舊 token 一樣解得返超管身份）；`isSuperAdminReserved()` 保留 `APP_ADMIN`，外面註冊唔到
   - 新增 `purgeSuperAdminLabels()`：舊部署已經寫落表嘅 `sheep` / `sheep@cubbadge.local` 儲存格改成中性代號（只改值，唔刪紀錄）；`initializeSheets()` 自動跑，回報 `superLabelRowsFixed`
   - 非超管睇審計照舊睇唔到超管紀錄（過濾邏輯現在同時蓋中性代號）
2. **B/D 唔入前端**：`/api/troops` 由回 `backend:<URL>` 改為 `connected:true`；`/api/health` 由回 `fullBackend`/`backendPreview` 改為 `backendHost` + `backendConfigured`（只講有冇設定）；前端改用 `troopConnected` 旗（`currentBackend` 全清，session 唔再儲 URL）
3. **`api/proxy.js`：`DOWNSTREAM_CLOSED` → HTTP 403**
4. **`api/health.js`**：修返過時文案（唔再寫 `payload, sig`，改為講 `action=superLogin` + apikey 由 server 端注入）
5. 測試：+2 生態圈檢查（全表零 APIKEY／BACKEND／sheep／URL；中性代號寫表）＋2 api 檢查（403 映射；B/D 唔入前端）；修正一條冇 `await` 令計數唔準嘅舊測試
6. `npm test` → api **30** / ecosystem **55** / e2e **72**，全綠

## 仲要你決定／交去旅系統

1. 旅前端兩個掣（關閉團直接入口）＋「揀團開戶」選單 → 你已答：喺另一個 repo
2. 每團一張「支部 SHEET」→ 你已答：屬旅系統
3. 上游側未做：TROOP_OPS 每團一行登記（只登記 `團ID` + 名稱，唔寫 B/D）、揀團開戶 UI、旅長「關入口」掣
