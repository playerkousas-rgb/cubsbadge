# 接入口 (ECOSYSTEM)

> 規格來源：BUILD.md（建構定案唯一真理）
> 對應後端版本字串（`EC_BACKEND_VERSION`）：`cub-leaf`

## 本系統喺生態圈嘅位置

**本系統 = 幼童軍進度追蹤,係生態圈最下游嘅 leaf。**

```
        旅系統 / 地域系統（上游）
                 │
                 │  簽一張短效 sig 飛落嚟
                 ↓
    ┌────────────────────────┐
    │  幼童軍進度追蹤（本系統）  │  ← 一張 SHEET + 一支 /exec = 一個 leaf
    │  progress / overview /  │
    │  requests / logs /      │
    │  forms / help / info /  │
    │  users                  │
    └────────────────────────┘
```

本文只講一件事:**點樣接入本系統**。

### 本系統刻意唔做嘅嘢

呢啲唔關 leaf 事,唔好加返落嚟:

- ❌ 唔會主動打去上游攞 registry —— 要接入係上游打落嚟;
- ❌ 唔會做旅層 registry（各支部登記）—— 嗰個係旅系統嘅嘢;
- ❌ 唔會做跨支部模組開關 —— 本 leaf 有咩功能自己話事;
- ❌ 唔會做通告圖書館、推送訂閱 —— 嗰啲係上游／外部系統嘅嘢;
- ❌ 唔會代其他 leaf 決定任何嘢。

`test/ecosystem.test.mjs` 有一條測試專門守住呢點:
`api/_lib/ecosystem.js` 入面唔准出現任何 `fetch(`。

### BUILD.md §4 豁免條款

進度追蹤**保留自己嗰套 UI,豁免統一**。所以本系統唔跟旅系統嗰套
「頂欄＋導航＋卡片」模版,亦唔會由 registry 生成導航。
`?action=modules` 只係向上游**申報**「我有咩功能」,唔係用嚟畫自己個導航。

---

## 1. 單位識別

`82`、`0082`、`第82旅`、`82nd` 全部正規化為 `0082`。
兩處實作必須一致,任何一處改動都要兩處同步:

| 位置 | 檔案 | 函式 |
|---|---|---|
| API | `api/_lib/normid.js` | `normalizeToPadded4` / `normalizeStripped` |
| GAS | `apps-script/Code.gs` | `ecNormId` / `ecSameUnit` |

公理一:**一切身份 = SCOUT_ID + 所在 SHEET**。

---

## 2. 接入方式:上層 sig 登入（BUILD.md §2）

上游用**本單位嘅 apikey** 簽一張短效飛,本 leaf 驗簽就放行。
咁樣上游毋須知道 leaf 任何密碼,leaf 亦毋須信任上游嘅網絡位置。

### 簽名

```
payload = { childId, sub, role, children, target, exp, jti }
canonical = normId(childId) | sub(小寫) | role | children(排序,逗號分隔) | target | exp | jti
sig = base64url( HMAC-SHA256(本單位 apikey, canonical) )
```

`api/_lib/sig.js` 嘅 `canonical()` 同 Code.gs 嘅 `ecCanonical()`
已驗證逐字相同、HMAC 結果相同（`test/ecosystem.test.mjs` 有守）。

### 呼叫

```http
POST /api/ecosystem
{ "action": "sigLogin", "unit": "0082", "payload": {...}, "sig": "..." }
```

### 驗證規則

| 規則 | 行為 |
|---|---|
| `exp` 已過 | 401,寫 ACCESS_LOG `FAIL/sig_expired` |
| `exp` 超過 30 分鐘（`EC_SIG_MAX_TTL=1800`,容差 60 秒） | 401 |
| 簽名唔啱（timing-safe 比較） | 401,寫 ACCESS_LOG `FAIL/bad_sig` |
| `childId` 同請求單位唔夾 | 401 |
| `target` 唔係本 leaf 有嘅模組 | 403 |
| 本單位未設 apikey | 503（唔會靜靜放行） |
| 本 leaf 搵唔到 `sub` 呢個帳號 | 401,寫 ACCESS_LOG `FAIL/no_such_account` |

`sub` 可以係 YMIS（10 位數字或 `L` 開頭）或 email。
成功就用 `createToken(user.ymis)` 換一個本 leaf 嘅 token。

**回應永不含 apikey**,只回 scope。之後所有業務請求照行 `/api/proxy`。

---

## 3. 自我描述端點

```http
GET /api/ecosystem?action=registry&unit=0082
```

回:本 leaf 係邊個單位、有咩模組、點搵到我、點接入我(`upstream` 欄)。
**永不含 apikey。**

```http
GET /api/ecosystem?action=modules&unit=0082   # 我有咩模組
GET /api/ecosystem?action=stats               # cache 狀態（診斷）
GET /api/ecosystem?action=flush               # 清 cache（需 EC_FLUSH_KEY）
```

GAS 端亦有對應嘅 `ecStatus` / `ecGetModules`（免 token,唔含敏感資料）。

---

## 4. apikey 紅線（BUILD.md §1 + §10 施工次序 1）

**apikey 只存 server,永不回前端、永不入 URL、永不入 QR。**

`/api/proxy` 係唯一業務出口,佢會:

1. 丟棄前端送嚟嘅 `apikey` / `apiKey` / `api_key` / `backend` / `scriptUrl`;
2. 由 registry 注入正確嘅 key;
3. 敏感 action 遇上「key 未設定」→ 直接 `503 apikey_not_configured`,唔打上游。

咁樣就算前端有舊 code 帶 key,或者有人手砌 request,
都改變唔到用邊條 key、亦指唔到任意上游（SSRF 防線）。

前端方面:`index.html` 冇 `currentApikey` 呢個變數,
`apiRequest` payload 唔帶 apikey,LocalStorage session 快照亦唔存 apikey。

---

## 5. 審計:ACCESS_LOG（BUILD.md §8）

| 表 | 欄位 |
|---|---|
| `EC_ACCESS_LOG` | ts, sub, role, via, event, detail |

`ecInitSheets()` 冪等建立。未建表時 `ecAccessLog()` 靜靜略過 ——
唔會因為審計失敗而阻塞登入。

查閱:`ecAccessLog` action（需旅長／管理員權限，回最後 200 筆）。

---

## 6. 環境變數（功能變數契約；全部由 APP ADMIN 設定）

| 變數 | 用途 | 必需 |
|---|---|---|
| `SUPER_KEY` | APP ADMIN 設定嘅管理 key（= 維護帳戶密碼；**只存在 Vercel 功能變數，leaf GS 冇**）：超管登入時喺 `/api/proxy` 比對，之後送 `action=superLogin` 落 leaf（公開申請 `/api/register` **唔用**此 key，亦不得放入申請 payload 外洩去 Scout Admin Sheet／Email） | 超管登入必需 |
| `SCOUTBADGE_ADMIN_API`（或 `SCOUT_ADMIN_API`／`CUBSBADGE_ADMIN_API`／`ROVERBADGE_ADMIN_API`） | Scout Admin 中央收件匣 `/exec` URL，四名相容、動態讀取＋trim（`api/_lib/scoutAdmin.js`）；`/api/register` 接入申請同 `submitFeedback` 共用 | 否（未設用內建預設） |
| `TROOP_<id>_BACKEND` | 本 leaf `/exec` URL（後端GS 對應：部署 URL） | 是 |
| `TROOP_<id>_APIKEY` | 本 leaf apikey（**只存 server**；後端GS 對應：Script Property `API_KEY`） | 敏感 action + sigLogin 必需 |
| `TROOP_<id>_NAME` | 旅團名稱（後端GS 對應：Script Property `TROOP_NAME`） | 是 |
| `EC_FLUSH_KEY` | cache flush 授權 | 否（未設＝flush 回 503） |

設定全部指向功能變數（唔讀 JSON）；**全部由 APP ADMIN 設定**，旅團只提供編號／部署 URL／API Key。

### `TROOP_<id>_BACKEND` 嘅來源與 GS 顯示原則

**正式部署 URL 只以 Google「部署 → 管理部署」中選定網頁應用程式提供的值為準。**
同一 Script 可以有多個部署，Sheet 選單讀取的 `getUrl()` 並非部署視窗選擇結果。

由 GS **2026.10.24** 起，按使用者決定採用「寧願不顯示 URL，也不提供錯 URL」：

| 位置 | 現在行為 |
|---|---|
| `initializeSheets()` 彈窗 | 顯示初始化結果及 API Key；不提示輸入旅團編號、不顯示部署 URL |
| `initializeSheets()` 回傳物件 | 保留 API Key、旅團及版本狀態，不再有 `scriptUrl` |
| `showApiKey()`／`showVercelEnv()`／`vercelEnvLines()` | 只提供同一隻現有 API Key，不含旅團專屬功能變數命名或 BACKEND 值 |
| Sheet 選單 | 「🔑 顯示 API KEY（交 ADMIN）」；不再提供自動驗證 BACKEND 的選單 |
| `doGet`／`doPost` | 不再從 `getUrl()` 記錄 URL，亦不讀取舊 `WEBAPP_URL` 作顯示 |
| 舊驗證選單相容函式 | 只提示部署視窗才是網址來源，不發連線請求、不回 URL、不聲稱已核實 |

旅團編號直接在 ADMIN FORM 填寫，不是生成 API Key 的前置條件；不新增「設定旅團編號」選單。既有旅團編號／名稱設定保留。
不增加貼網址／設定 BACKEND 的 GS 操作，也不新增 Google 授權。
自我回報的 `selfUrl` 端點及依 ID 長度判斷 HEAD／正式部署的方案已移除。
既有內部登入／簽名協定不在本次改動範圍；不能把本次「停止顯示 URL」理解為已重寫所有部署身分比對。

Vercel `normalizeGasUrl` 仍將 `/a/<domain>/macros/s/<id>/exec` 正規化成
`https://script.google.com/macros/s/<id>/exec`。正規化只處理路徑格式，不能把錯的部署 ID 變成正確部署。
`/api/health?troopId=<id>` 仍提供 `config.backendDomainScoped` 及 `backendLiveCheck.hint`，
它們是連線診斷，不是部署 URL 自動發現機制。`troops.json` 仍已棄用。

詳細調查及舊說法更正見 `BACKEND_URL_DIAGNOSIS.md`。

---

## 7. 測試

```bash
npm test          # 全部
npm run test:api  # /api/* 契約
npm run test:eco  # GAS 接入口
npm run test:e2e  # 帳號／進度流程回歸
npm run dev       # 本機預覽 http://localhost:3000
```

### 紅線測試（改動時千萬不要放寬）

- `/api/*` 回應不得含 apikey;
- `api/_lib/ecosystem.js` 不得出現 `fetch(` —— leaf 唔主動打上游;
- `?action=modules` 不得申報旅系統先有嘅模組;
- proxy 必須丟棄前端自帶嘅 apikey / backend;
- apikey 未設定時敏感 action 必須 503。
