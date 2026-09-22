# CHANGE LOG v5.8 — 超管真正隱藏：`SUPER_KEY` 只存在 **Vercel 功能變數**（GS 完全冇）

> ⚠️ 更正 v5.7 寫錯嘅一件事：
> v5.7 寫「超管密碼 = 功能變數 `SUPER_KEY`（**GS Script Property**）」，仲教人「GS 編輯器 → ⚙ 專案設定 → 指令碼屬性」去睇／改。
> **呢個係錯嘅** —— 指令碼屬性，旅團（任何有 Apps Script 編輯權嘅人）都睇得到，等於冇隱藏過。
>
> v5.8 定版：**超管密碼只存在 APP ADMIN 嘅 Vercel 功能變數**；
> leaf GS 只有帳號名 `sheep`，**冇密碼、冇雜湊、冇 Script Property、冇 fallback、連讀都唔會讀**。

## 1. 新契約（一句講完）

```
前端「登入」→ /api/proxy {action:'login', login_id:'sheep', password}
   → Vercel 見到超管帳號，就地比對環境變數 SUPER_KEY（timing-safe，密碼唔會離開 Vercel）
   → 用該旅團 apikey（TROOP_<id>_APIKEY）簽一張 ≤10 分鐘 sig
   → POST 去 leaf GS：{action:'superLogin', payload, sig}   ← 冇密碼、冇 apikey
   → leaf GS 用自己 getApiKey() 驗簽（HMAC-SHA256）→ 發超管 token（虛擬帳號，不寫 Users 表）
```

- **密碼永遠唔會到 leaf**：旅團開 Google Sheet、Apps Script、專案設定、指令碼屬性、執行紀錄，都睇唔到超管密碼。
- **leaf 亦冇得改密碼**：超管「改密碼」一律去 Vercel（Settings → Environment Variables → `SUPER_KEY`）改完 Redeploy。
- **未設定 `SUPER_KEY`** = 超管入口完全關閉（同一句通用訊息，唔會有任何後備密碼）。
- 失敗（帳號錯／密碼錯／未設定／未登記旅團）一律由 Vercel 層處理，唔會成為「呢個帳號存在」嘅 oracle。

## 2. `apps-script/Code.gs`（v5.8.0-leaf）

### 2.1 刪除（唔再存在）
- `getSuperAdminPassword()` / `SUPER_ADMIN_PASSWORD` / `superPasswordMatches()`
- `SUPER_KEY_PROP` 嘅**讀取**與**寫入**（`getSuperKey()`、`setSuperKey()` 已無作用）
- 任何「用密碼登入超管」嘅路徑（`handleLogin` 收到超管帳號唔會比對密碼）

### 2.2 新增／保留
| 項目 | 行為 |
|---|---|
| `handleSuperLoginSig(body)` | 新增：驗 `action=superLogin` 嘅 `payload`+`sig`（HMAC = 本單位 `API_KEY`）→ 發超管 token；`sub` 必須係超管、`role` 必須 `super_admin`、`childId` 必須係本單位、`exp` ≤30 分鐘 |
| `superKeyConfigured()` | 保留但**永遠回 `false`**（leaf 冇、亦唔應該有） |
| `setSuperKey()` | 保留但**只回 `false`**（唔會寫任何嘢） |
| `purgeLegacySuperKeyProperty()` | 新增：清走舊部署（v5.5–v5.7）遺留喺指令碼屬性嘅 `SUPER_KEY` |
| `initializeSheets()` | 自動叫 `purgeLegacySuperKeyProperty()`；回傳加 `superKeyHeldBy:'vercel-env'`、`appAdminSigLogin:true`、`legacySuperKeyPurged` |
| `handleLogin()` | 本地收到超管帳號 → 回「找不到此帳號」（同「唔存在帳號」一模一樣，唔會洩露隱藏帳戶） |
| `handleChangePassword()` | 超管分支：回 `code:'SUPER_KEY_AT_APP_ADMIN'`，指返去 Vercel 改；**永不寫入、永不回顯** |
| `doPost` | 新 action `superLogin`（放喺本地入口開關之前處理；`ALLOW_LOCAL_LOGIN=false` 時照用） |
| `doGet ?action=health` | 加 `superKeyHeldBy:'vercel-env'`、`appAdminSigLogin:true`（`superKeyConfigured` 永遠 false） |
| `ecStatus` | `backendVersion` → `cub-5.8.0-leaf` |

### 2.3 唔變（向下兼容）
- 普通帳號登入／進度／審批／活動履歷／用戶管理：**完全無改**
- 超管帳號仍然係 `getUser()` 嘅虛擬帳號：唔寫入 Users 表、唔喺用戶管理／成員名單／操作紀錄出現（非超管）
- 超管保護不變：唔可以停用／重設密碼／改角色／被申請／被批量開戶佔用

## 3. Vercel 端（`api/`）

### 新增 `api/super-login.js`
- 只認超管帳號（`sheep` / `sheep@cubbadge.local`，server-side 常數，唔回傳）
- 用 `verifySuperKey()`（timing-safe）比對 `process.env.SUPER_KEY`
- 用 `signSig(TROOP_<id>_APIKEY, …)` 簽 ≤10 分鐘 sig，轉發 `action=superLogin`（**唔帶密碼、唔帶 apikey**）
- 回應只白名單 `{success, token, user, force_change_password, via}`；值永不出現喺 response／log
- 輕量失敗限流（同一 instance 15 分鐘 20 次）+ 未設定 `SUPER_KEY` / 未登記旅團 / 未有 `APIKEY` 各有明確狀態碼

### 修改 `api/proxy.js`
- 見到 `action='login'` + 超管帳號 → 就地轉入 `handleSuperLogin()`（**密碼唔會轉發去 leaf GS**）
- 其他帳號流程零改動（照舊落 `action=login` 去 GS）

### 修改 `api/health.js`（文字）
- 診斷步驟 / 提示補上「超管登入由 Vercel 驗證；GS 永不持有 `SUPER_KEY`」

## 4. 前端 `index.html`
- 部署步驟版本號 → **v5.8**；文案加「GS 完全冇超管密碼，超管登入一律經 APP（Vercel）驗證」
- `isSystemAccount()` 唔再硬寫超管帳號名（只按 `role==='super_admin'` 判斷）
- 領袖教學第 7 節改為「維護帳戶（隱藏，v5.8）」：只講契約，唔再提 backdoor／Code.gs 密碼

## 5. 文件
- `VERCEL_ENV_SETUP.md` → **v10.0**（超管密碼只喺 Vercel；`SUPER_KEY` 同時係管理 API key）
- `APP_ADMIN_WORKFLOW.md` → **v10.0**
- `docs/LEADER_GUIDE.md` / `docs/ECOSYSTEM.md` / `docs/PROXY_MIGRATION.md`：超管描述改為「leaf 永不持有密碼，只認 APP ADMIN 層 sig」
- `docs/CHANGE_LOG_v5.7.md`：加註「v5.7 嘅 Script Property 講法已經被 v5.8 取代」

## 6. 測試（`npm test`）

### api（新增 6 項）
- `super-login`：未設定 `SUPER_KEY` → 唔通且唔回值
- `super-login`：非超管帳號完全唔行呢條路（唔會變成第二個登入口）
- `super-login`：密碼錯 → 通用失敗；正確 → 用旅團 apikey 簽 sig 轉發（轉發內容冇密碼、冇 apikey；sig 驗得過）
- `super-login`：未登記旅團 / 未設 `APIKEY` → 明確拒絕
- `proxy`：超管登入由 Vercel 處理，密碼永唔會轉發去 leaf GS
- `proxy`：普通帳號登入完全唔受影響（照舊直落 GS）

### ecosystem（新增 12 項）
- Code.gs 靜態掃描：冇密碼／雜湊／`SUPER_KEY` property 讀寫
- `superKeyConfigured()` 永遠 false（就算舊 property 仲喺度）
- 本地密碼登入超管一律唔通，而且回應同「唔存在帳號」一致
- `action=superLogin` 正確路徑（真 token 可通過 `validateToken`）
- 防線：錯 key／改 role／改 sub／過期／跨單位 sig 一律拒絕
- 端到端：Vercel `/api/super-login` → sig → 真 GS code → 真 token（錯密碼唔會打 leaf）
- `initializeSheets()` 只生成 API KEY + 清走遺留 property
- 超管操作紀錄對非超管隱藏

結果：`api 29 / ecosystem 53 / e2e 72` 全綠。

## 7. 部署次序（APP ADMIN）

1. Vercel → Settings → Environment Variables：確認 **`SUPER_KEY`** + 每旅團 `TROOP_<id>_BACKEND` / `_APIKEY` / `_NAME`（3 個環境都要勾）→ **Redeploy**
2. 叫旅團覆蓋最新 `Code.gs`（v5.8）→ 部署「新版本」（**跑一次 `initializeSheets()`**，會清走舊遺留嘅 `SUPER_KEY` property）
3. 用超管 `sheep` 登入一次，確認：入到、`/api/health` 嘅 `envContract.SUPER_KEY` 係 `true`、普通領袖帳號見唔到超管

## 8. 已知取捨（老實講）

- leaf 驗簽嘅鑰匙係「該旅團 apikey」，而旅團自己知呢個 key。所以旅團技術上可以自己簽一張超管 sig，**喺自己嘅 leaf** 取得 super_admin 角色 —— 但佢哋本來就有該 Google Sheet 嘅完全控制權，冇額外權力；而**超管密碼本身永遠唔會外洩**，亦唔可以用嚟登入其他旅團或 APP 層管理 API（`/api/register` 要真 `SUPER_KEY`）。
- 要完全避免連呢點：Vercel 層可以另加 `SUPER_ADMIN_SIG_ONLY` 白名單（只准特定旅團用超管登入）—— 未有需要前唔加，保持簡單。

版本：`cub-5.8.0-leaf`

COPYRIGHT 2026 Scout System
