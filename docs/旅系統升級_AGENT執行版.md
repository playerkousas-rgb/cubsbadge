# 旅系統升級清單（AGENT 執行版）＋現況

> 本檔 = 呢輪升級嘅**版號／規格唯一記錄**（程式碼內唔寫版號註解）。
> 現況：**下游 leaf（本倉 cubsbadge）** 逐條核對結果如下；上游「旅系統 / TROOP_OPS」項目唔喺本倉。
> 後端版本字串：`cub-leaf`

## 原文清單（照抄，唔改字）

變數 ABCD（勿改名）
A = SUPER_KEY（超管隱藏，勿動）
B = TROOP_(id)_BACKEND
C = TROOP_(id)_NAME
D = TROOP_(id)_APIKEY
id = 旅團代號。B/D 只存 Vercel env / TROOP_OPS server 端，禁入 SHEET 儲存格/前端/URL

🚫 禁止
禁將 SHEEP 改 SHEET
禁 SHEET 寫 B/D URL/KEY
禁加 onEdit / callback / trigger 回調

執行清單（按序）
1. 建表：每團補一張支部 SHEET（A），與現有進度 SHEET（B）成對；旅 SHEET（C）TROOP_OPS 加表：每團一行 | 團ID | B | D |（追加，不改 Vercel env）
2. 後端 Code.gs（下游）：加 ScriptProperties ALLOW_LOCAL_LOGIN（預設 true）；加接口 setDownstreamAccess（只收上游 sig 驗證先可改旗）；doPost 登入/開戶開頭：若 ALLOW_LOCAL_LOGIN==false 且非 sig 則回 403
3. 前端：支部「進度」頁經後端代理讀 B（B模式），支部 SHEET 不直存進度；支部前端加「關閉進度直接入口」掣（僅支部領袖見，調 setDownstreamAccess 寫進度 GS）；旅前端加「關閉團直接入口」掣（僅旅長見，寫團 GS）＋「揀團開戶」選單（讀 TROOP_OPS 行，經 sig 落團寫，AUDIT via=sig）
4. 開戶：閂口後新戶一律上游揀團開，寫入仍在下游
5. 清理：刪 GS 內所有版號註解，版號只留本 MD

驗收
- SHEET 搜 APIKEY/BACKEND/sheep 零儲存格命中，無 onEdit
- 未掛接前兩邊可登入；掛後上游可一鍵閂，下游本地 403 只收 sig，上游揀團開戶成功

## 現況：逐條核對（下游 leaf = 本倉）

| 清單項 | 現況 | 證據 |
|---|---|---|
| A/B/C/D 命名 | ✅ 一致 | `api/_lib/registry.js`：讀 `SUPER_KEY` / `TROOP_<id>_BACKEND` / `_NAME` / `_APIKEY`，冇 JSON、冇寫死 URL |
| 🚫 SHEEP 唔可以變 SHEET 帳號 | ✅ | `isSuperAdminReserved()` 擋註冊；`removeSuperAdminRows()` 每次 `initializeSheets()` 掃走 Users／成員名單殘留列 |
| 🚫 SHEET 禁寫 B/D URL/KEY | ✅ 全部表零命中 | 測試「SHEET 驗收：全表零 APIKEY／BACKEND／sheep／URL 儲存格」 |
| 🚫 禁 onEdit / callback / trigger | ✅ 零命中 | 全倉掃描 `onEdit|newTrigger|callback|postMessage` 冇結果 |
| 1. 建表（支部 SHEET＋TROOP_OPS 加表） | ❌ 未做（本倉） | 本倉 12 張表：Users／Applications／成員名單／Tokens／SystemConfig／進度追蹤／待批完成／其他獎章／服務紀錄／操作紀錄／活動履歷／待批履歷。v5.6 已定：TROOP_OPS 係**旅系統職責**，leaf 只需被登記 |
| 2. ALLOW_LOCAL_LOGIN 預設 true | ✅ | `getAllowLocalLogin()`；`initializeSheets()` 未設就寫 `'true'`；`showDownstreamAccess()` 可查 |
| 2. setDownstreamAccess 只收上游 sig | ✅ | `handleSetDownstreamAccess()`：`isSigRequest()` 唔過 → `NEED_SIG`；成功寫旗 + 審計 `via=sig` |
| 2. 閂口後本地登入/開戶 → 403，只收 sig | ✅（今次補齊） | GS 側已有 `DOWNSTREAM_CLOSED` 閘（login／apply／本地寫入）；**`api/proxy.js` 今次加咗把 `DOWNSTREAM_CLOSED` 轉 HTTP 403**，之前一律回 200 |
| 3. 支部「進度」頁經後端代理讀 B（B模式） | ✅ | 前端只打 `/api/proxy`；`backend` 等參數一律被刪（SSRF 防線），B 由 server 端 env 讀 |
| 3. 支部前端「關閉進度直接入口」掣 | ❌ 未加 | v5.6 當時刻意唔加（「進度前端唔使加掣、唔會誤閂」）；今次清單要求加 → 等指示 |
| 3. 旅前端「關閉團直接入口」掣＋「揀團開戶」選單 | ❌ 唔喺本倉 | 屬旅系統／TROOP_OPS 前端 |
| 4. 閂口後一律上游揀團開、寫入仍在下游 | ✅ leaf 側 | 上游 sig 可過閘（`ecSigLogin`）；「揀團開戶」UI 屬上游 |
| 5. 清走版號註解 | ✅ | `apps-script/Code.gs`、`api/**`、`index.html` 已零 `// vX.X` 註解；版號只留 MD |

### 驗收對照

| 驗收 | 結果 |
|---|---|
| SHEET 搜 `APIKEY` / `BACKEND` / `sheep` 零命中 | ✅ 0 命中（lifecycle 行完掃 12 張表全部儲存格） |
| 無 onEdit | ✅ |
| 未掛接前兩邊可登入 | ✅ `ALLOW_LOCAL_LOGIN` 預設 `true` |
| 掛後上游一鍵閂、下游本地 403、只收 sig | ✅（今次補返 HTTP 403） |
| 上游揀團開戶成功 | ⏳ 上游側，唔喺本倉 |

## 今次改動（本倉）

1. **超管寫表一律用中性代號 `APP_ADMIN`**（Sheet 儲存格永不寫 `sheep`）
   - 新增 `SUPER_STORAGE_ID='APP_ADMIN'`；`createToken()`／`writeAudit()` 超管相關寫入全部用佢
   - `isSuperAdminId()` 認得中性代號（新舊 token 一樣解得返超管身份）；`isSuperAdminReserved()` 亦保留 `APP_ADMIN`，外面註冊唔到
   - 新增 `purgeSuperAdminLabels()`：舊部署已經寫落表嘅 `sheep`／`sheep@cubbadge.local` 儲存格改成中性代號（只改值，唔刪紀錄）；`initializeSheets()` 自動跑，回報 `superLabelRowsFixed`
   - 非超管睇審計照舊睇唔到超管紀錄（過濾邏輯現在同時蓋中性代號）
2. **`api/proxy.js`：`DOWNSTREAM_CLOSED` → HTTP 403**（清單第 2 條「回 403」）
3. 測試：新增「SHEET 驗收：全表零 APIKEY／BACKEND／sheep／URL 儲存格」、「超管寫表一律用中性代號 APP_ADMIN…」、「proxy：下游入口關閉 → 回 HTTP 403」；修正一條冇 `await` 令計數唔準嘅舊測試
4. `npm test` → api **29** / ecosystem **55** / e2e **72**，全綠

## 未做／要你決定

1. **支部 SHEET**：清單第 1 條要「每團補一張支部 SHEET，與進度 SHEET 成對」——本倉冇，亦唔知「支部 SHEET」要存咩欄。要唔要喺本倉建？（要嘅話請講欄位）
2. **TROOP_OPS 表寫 B／D**：清單 1 話「旅 SHEET TROOP_OPS 加表：每團一行 ｜團ID｜B｜D｜」，但 🚫 又話「禁 SHEET 寫 B/D URL/KEY」——兩條互相矛盾。本倉現況：B／D 只喺 Vercel env，Sheet 零命中（已達 🚫 要求）。
3. **「關閉進度直接入口」掣**：要加喺本倉前端（僅支部領袖見，叫 `setDownstreamAccess`）嗎？加咗之後支部領袖可以自己閂掉本地登入入口（會影響自己旅團用家）。
4. **旅前端兩個掣＋揀團開戶選單**：要改就要去旅系統／TROOP_OPS 嗰邊；如果佢喺另一個 repo，話我知係邊個。
