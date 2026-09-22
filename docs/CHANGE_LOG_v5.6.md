# CHANGE LOG v5.6 — 下游配套（上游控下游寫 + JSON 含 hash 搬遷）

> 在 v5.5 功能變數契約（4樣）之上，補齊 `BUILD.md §1+§2` 對下游（進度 leaf）要做嘅部分。  
> 未有上游時多餘、有上游時直接可用；全部新增無改動既有 action，完全向下兼容，單用時 `ALLOW_LOCAL_LOGIN` 保持 `true` 唔會誤閂。

## 對應升級版 3 件事中「下游要做」嘅部分

| 升級版 | 本倉（下游進度 leaf） |
|---|---|
| **§1-A 後端 `Code.gs`** `setDownstreamAccess` + `ALLOW_LOCAL_LOGIN` | ✅ 已補 |
| **§1-B 前端** 進度前端唔使加「關入口」掣 | ✅ 本來已符合（無掣） |
| **§1-C Registry** `TROOP_OPS` 每團一行 | 旅系統職責，本 leaf 只需被登記 |
| **§2 JSON 吐出** `exportAll（含hash）→ upsertUser 直插` | ✅ 已補 |

## 新增（apps-script/Code.gs v5.6.0-leaf）

### 1. 入口開關（上游控、下游寫）
- 新增 `ALLOW_LOCAL_LOGIN` Script Property，預設 `true`（`initializeSheets()` 未設置時自動寫 `true`）
- `getAllowLocalLogin()` / `setAllowLocalLogin()` / `showDownstreamAccess()` / `getDownstreamAccess()` / `setDownstreamAccess()`
- `setDownstreamAccess({allowLocal})` **只接受上游 `sig` 驗證**（HMAC 下游 `API_KEY`，`ecCanonical` 同 `ecSigLogin` 同一套），成功寫 `ALLOW_LOCAL_LOGIN` 並記 `ACCESS_LOG` + `AUDIT_LOG`（`via=sig`）
- `doPost` 開頭閘門：當 `ALLOW_LOCAL_LOGIN=false` 時
  - `login` / `apply` 只放行 `sig` 或 `SUPER sheep`，否則 `403 DOWNSTREAM_CLOSED`
  - `exportAll` / `importAll` / `setPw` / `verifyPw` 等 server-to-server 放行（由各 handler 內再驗 `apikey/sig/領袖 token`）
  - 其他本地裸請求（`addMember/addUser/bulkAddUsers/save`）需 `sig/serverKey/token`，否則 `403`
- 單用時保持開啟，下游前端無此掣故唔會誤觸；`doGet health` / `getLoginMode` / `ecStatus` 均回傳 `allowLocalLogin`
- `isDownstreamSigValid()` / `isSigRequest()`（與 `ecSigLogin` 同 HMAC、30min TTL、timing-safe）

### 2. JSON 吐出批量開戶（保留密碼）
- `exportAll({includeHash})`
  - `includeHash=false`（預設）：剝走 `password_hash`，導出成員名單亦合併
  - `includeHash=true`：含 `password_hash`（SHA256 hex）+ `hash_algo`，供後掛上游時直插；**含 hash 時必須 apikey/sig/領袖 token**，否則拒絕（下游已關閉時即使不含 hash 亦需驗權）
  - 回傳 `{meta:{unit,exportedAt,version,sha256,transferId,includeHash,count}, data:[...], bundle:{meta,data}}`，`sha256` 為 `JSON.stringify(data)` 的 SHA256
- `importAll({bundle})` / `upsertUser({user})`
  - 接受 `{bundle:{meta,data}}` 或扁平 `{meta,data}`；必須 `apikey/sig/領袖 token`
  - `transferId` 冪等（`TRANSFER_IDS` ScriptProperty 記最近 200 個，重複回 `DUPLICATE_TRANSFER`）
  - `sha256` 驗證（不符回 `BAD_SHA256`）
  - 逐個 `upsertUserWithHash` **直插 hash**（不經 `1234+mustChangePw`），`撞號阻擋`（YMIS/Email 已存在即記 `failed`，不覆蓋）
  - 成功直插後記 `ACCESS_LOG` + `AUDIT_LOG`，舊密碼照用，唔使 `1234`
- `upsertUserWithHash()` 內部：全表唯一性檢查、`ensureUserHeaders`、`force_change_password=false`、同步補 `成員名單`

### 3. 密碼同步（分開 leaf 時支部改密同步落進度）
- `setPw({ymis, password_hash})`：需 `apikey/sig`，`password_hash` 須為 64 hex，直接覆蓋 `Users.password_hash` 並清 `force_change_password`，記審計
- `verifyPw({ymis, password/password_hash})`：需 `apikey/sig`，返回 `{match:true/false}`；**限流 5 次/小時/ymis**（`VERIFY_PW_<ymis>` ScriptProperty 記時間戳，超限回 `RATE_LIMIT`）

## 自測（對應升級版 §5 Checklist）

- [x] 單用進度時無「關入口」掣，唔會誤閂（`getAllowLocalLogin()` 預設 true）
- [x] 團掛進度後，進度本地登入 403，只接受旅/團 `sig`（`doPost login` 閘門 + `ecSigLogin` 放行；`setDownstreamAccess` 需 sig）
- [x] 旅掛團後，團本地入口可被旅一鍵閂（同一套 `ALLOW_LOCAL_LOGIN` 機制；`handleSetDownstreamAccess` + `handleGetDownstreamAccess`）
- [x] JSON 含 hash 匯入後舊密碼照用，唔使 `1234`（`exportAll includeHash=true → importAll 直插`，登入驗證通過）
- [x] 跨團兼幫未經目標團批，加唔到 `branch_access`（旅系統職責，本 leaf 不處理；`branch_access` 仍由旅系統 `TROOP_OPS` 控制）
- [x] `TROOP_OPS` 追加行後 `flush` 即生效，ENV 無被改（平台層 `ecosystem.js` 5分鐘 cache + `flush` endpoint 已有）

## 兼容性

- 無改動既有 `login/apply/bulkAddUsers` 等流程；`npm test` 23+41+69 全綠
- 未有上游時：`exportAll` 不含 hash 可無 token 匯出（備份）；含 hash 需領袖 token；`setDownstreamAccess` 無 sig 時拒絕

版本：`EC_BACKEND_VERSION='cub-5.6.0-leaf'`

COPYRIGHT 2026 Scout System
