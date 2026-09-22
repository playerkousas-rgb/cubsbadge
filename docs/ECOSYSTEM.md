# 旅團生態圈接入 (ECOSYSTEM)

> 規格來源：BUILD.md（建構定案唯一真理）+ EXTERNAL.md（外部系統接入）
> 對應版本：cubsbadge v5.4.0-eco

本文說明 CubBadge 如何接入整個旅團生態圈，以及外部系統如何接入 CubBadge。
兩條公理貫穿全文：

1. **一切身份 = SCOUT_ID + 所在 SHEET**
2. **一切接入 = 交俾邊個 + 登記邊個 registry**

---

## 1. 兩層 registry

### 平台層（本 repo + Vercel）

| 來源 | 內容 | 備註 |
|---|---|---|
| `data/units.json` | 單位基本資料：名稱、支部、sheet 類型、登記途徑 | 公開，**不含 apikey** |
| `data/troops.json` / `troops.json` | backend `/exec` URL | 公開設定，業務請求一律經 `/api/proxy` |
| Vercel env `TROOP_<id>_BACKEND` | 覆蓋 backend URL | 優先於 json |
| Vercel env `TROOP_<id>_APIKEY` | **apikey，只存 server** | 永不回前端、永不入 URL、永不入 QR |

### 旅層（TROOP_OPS Sheet）

旅系統（若有部署）持有一張 `EC_REGISTRY` 表，登記旗下各支部 leaf：

```
unit_id | name | branch | backend | apikey | modules | status | updated_at | updated_by
```

平台以 server-to-server 方式讀取（`TROOP_<id>_OPS_BACKEND` + `_OPS_APIKEY`，
fallback `TROOP_OPS_BACKEND` / `TROOP_OPS_APIKEY`），cache 5 分鐘。
`GET /api/ecosystem?action=flush` 可即時清 cache（需 `EC_FLUSH_KEY`）。

**`ecOpsRegistry` 的回應永不包含 apikey**，`status` 為 `inactive` / `removed` 的單位不會列出。

旅系統未部署時，系統 degrade 成「獨立運作」：只用平台 registry + leaf 本地模組，
所有功能照常，`troop.opsLinked = false`。

### 單位識別正規化

`82`、`0082`、`第82旅`、`82nd` 全部正規化為 `0082`。
三處實作必須一致，任何一處改動都要三處同步：

| 位置 | 檔案 | 函式 |
|---|---|---|
| API | `api/_lib/normid.js` | `normalizeToPadded4` / `normalizeStripped` |
| 前端 | `assets/ec-core.js` | `ECCore.normId` / `sameUnit` / `strippedId` |
| GAS | `apps-script/Code.gs` | `ecNormId` / `ecSameUnit` |

`test/frontend.test.mjs` 與 `test/ecosystem.test.mjs` 各自守住這條一致性。

---

## 2. 模組註冊制

模組定義在 `api/_lib/ecosystem.js` 的 `MODULE_REGISTRY`，每個模組登記：

| 欄位 | 意思 |
|---|---|
| `id` | 模組代號 |
| `name` / `name_en` | 中英名稱 |
| `slot` | 入口位置：`main`（本 leaf）/ `ops`（旅系統） |
| `order` | 導航排序 |
| `perm` | 權限：`member` / `scoped` / `leader` |
| `core` | 核心模組，**不可停用** |
| `shareable` | 是否可產生分享連結 |
| `doc` | 說明頁（就是本文件或角色指南） |

導航由註冊表自動生成，最多兩層。

**開關**：旅長可在 `EC_MODULES` 表逐個 unit（或 `scope='*'` 全旅）開關非 core 模組，
cache 5 分鐘。前端 `applyModuleVisibility()` 只是不畫入口；
**server-side 另有 gate**（例如 notice 模組停用時 `/api/notices` 直接回 403 `code:'module_disabled'`），
所以收埋入口不是安全邊界，關掉就是真的關掉。

預設：`progress / overview / requests / logs / forms / help / info / users` 為 core；
`notice` 預設開啟但可停用；旅系統模組 `calendar / album / items / finance` 預設關閉。

---

## 3. 個人化訂閱（★ BUILD §4 重中之重）

### 資料流

```
通告圖書館 scout-circulars
  每日 scrape → cache.json + enrich.json（GitHub Raw CDN，公開）
        │
        ├─ 讀取（公開 cache，唔需要任何 key）
        │     ↓
        │  /api/notices ── 用戶揀嘅 支部 × 項目 ──→ 命中清單 → 通告頁
        │
        └─ 推送
           /api/subscriptions → 圖書館 /api/push-subscriptions
              (endpoint_hash / client_token_hash / branch_ids / topic_ids)
                       ↓
           GitHub Actions 06:00 notify.py → pywebpush VAPID → 用戶部機
```

本系統**只做訂閱設定前端 + service worker**，推送基建完全沿用圖書館現有鏈，
用圖書館的 VAPID public key，不另起爐灶。

### 命中規則

與圖書館 `notify.py:subscription_matches` 同一套邏輯（JS 版在 `api/notices.js`）：

- `all:new` → 全收，包括未分類通告；
- 否則逐個已訂閱 topic 取其 `branches` 作為 scope，
  `eligible = 用戶branches ∩ 通告branch_tags`（scope 含 `*` 則不篩支部），
  且 `topic.match_topic ∈ 通告topic_tags` → 命中。

即「**支部 AND 項目**」兩邊都要中。跨支部不會漏出：
訂「幼童軍 × 比賽」不會收到深資童軍的比賽通告。

### 私隱

- 訂閱設定（支部、項目、是否推送）**只存用戶 LocalStorage**，不上 server；
- 送去圖書館的只有：瀏覽器 push endpoint、`client_token`、`branch_ids`、`topic_ids`；
- **無 YMIS、無姓名、無電郵**。館方只知「幾多人訂、訂咩」，不知「邊個」；
- `/api/notices` 的回應不含任何身份資料（`test/api.test.mjs` 有守）。

### 圖書館端待辦

`push_common.py:_same_origin()` 目前只比對 `Origin` vs `Host`，外站呼叫必 403。
要讓各單位系統接入，圖書館需要：

1. 把 `require_same_origin` 改為 **origin allowlist**（列出各支部 APP 網址）；
2. `push_subscriptions` 表加 `source` 欄（本系統已送 `source`，見 `EC_PUSH_SOURCE`）。

未改之前，`/api/subscriptions` 會回 `origin_not_allowed` 加上可行動的錯誤訊息。
**本 repo 未向 scout-circulars 提交任何改動。**

---

## 4. 分享：連結 + QR（BUILD §5）

三個概念要分清楚：

| 概念 | 意思 | 要唔要登入 |
|---|---|---|
| 內部分享 | 支部之間逐個揀邊個睇到 | 要 |
| Share 連結 / QR | 收到就直接開嗰一頁 | **唔使** |
| 公開頁門戶 | 單位對外首頁 | 要登入，外人入唔到 |

分享連結格式：

```
https://<origin>/?share=<module>&u=<0082>&id=<itemId>&t=<title>
```

**連結與 QR 永不含 apikey、token、sig。** `test/frontend.test.mjs` 逐個關鍵字守住。

QR 產生器 `assets/ec-qr.js` 為零依賴自建實作（Model 2 / byte mode / EC-L / v1–40 /
自動選 mask + penalty 評分），已逐 bit 對照 reference 實作驗證。
內容超出 v40 容量時回 `null`，前端改為只顯示連結，不會畫一個壞 QR 出來。

---

## 5. 上層 sig 登入（BUILD §2 三點進入之一）

上層系統（旅系統 / 地域系統）可代其下級單位簽發登入憑證，毋須知道 leaf 密碼：

```
payload = { childId, sub, role, children, target, exp }
sig     = HMAC-SHA256(下級apikey, canonical(payload))
```

- `exp` 有效期 15–30 分鐘（`EC_SIG_MAX_TTL = 1800`，容許 60 秒時鐘偏差）；
- 驗簽用 timing-safe 比較（`ecSafeEqual`）；
- `target` 模組若被停用，即使簽名正確亦拒絕；
- 成功／失敗都寫 `EC_ACCESS_LOG`；
- **回應不含 apikey**，只回 scope。

`api/_lib/sig.js` 的 `canonical()` 與 Code.gs 的 `ecCanonical()` 已驗證逐字相同。

`apikey` 未設定時，敏感 action 一律拒絕（`503 code:'apikey_not_configured'`），
不會無聲無息行一個沒有認證的上游。

---

## 6. 外部系統接入（EXTERNAL.md）

### 核心原則：外部系統零特權

外部系統只可以「交嘢入嚟」，**沒有本系統任何權限，改不到任何資料**。
是否收納、幾時公布，一律由本旅團領袖決定。

### 模式 A — 連結

外部系統把內容經 URL 交給本系統。入口：

```
GET /library/import
  ?title & sourceSite & region & date & sourceUrl
  & attachmentUrl & pdf_url & key & deadline & audience & fee
```

（契約由 scout-circulars 的 `buildScoutSystemImportUrl()` 定。）

本系統只會讀參數畫一個預覽，**不會、也不能直接寫入任何 Sheet**。
要入到本單位，必須本地領袖登入後自己按「收入本旅團收件匣」。
未登入就只暫存在本機收件匣（LocalStorage `cub_inbox_<tid>`），登入後再處理。

### 模式 B — 個人化訂閱

見上文第 3 節。

### 模式 C — Stateless 工具登記

外部工具（集會助手、進團指南等）在 registry 登記後，可出現在導航，
但一樣沒有任何寫入權限。

### 已指定的外部系統

| 系統 | 模式 |
|---|---|
| 童軍小工具站（集會助手／進團指南／通告圖書館／優異旅團系統） | A + 訂閱來源 |
| AYP 獎勵計劃 | A 起步，深度同步待對方有 API |
| 專科徽章系統 | A 起步，深度同步待對方有 API |

---

## 7. API 一覽

| Endpoint | 用途 |
|---|---|
| `GET /api/ecosystem?action=registry&unit=` | 單位接入狀態：平台 registry + 旅 registry + 已啟用模組 + 導航 |
| `GET /api/ecosystem?action=modules&unit=` | 模組開關 |
| `GET /api/ecosystem?action=share&unit=&module=` | 可分享目標 |
| `GET /api/ecosystem?action=flush` | 清 registry cache（需 `EC_FLUSH_KEY`）|
| `GET /api/ecosystem?action=stats` | 接入統計 |
| `POST /api/ecosystem {action:'sigLogin'}` | 上層 sig 登入 |
| `GET /api/subscriptions?action=config` | VAPID public key + 訂閱字典 |
| `POST /api/subscriptions {action:'upsert'\|'sync'\|'delete'}` | 訂閱同步 |
| `POST /api/notices {unit, branches, topics}` | 命中通告清單 |
| `POST\|GET /api/proxy` | **唯一業務出口**，server 端注入 apikey |

`/api/proxy` 會丟棄前端送來的 `apikey` / `apiKey` / `api_key` / `backend` / `scriptUrl`，
再由 registry 注入。就算前端有舊 code 帶 key，或有人手砌 request，都改變不到用哪條 key，
亦不能指向任意上游（SSRF 防線）。

---

## 8. GAS 端（`apps-script/Code.gs` EC_ECOSYSTEM 區段）

三張表，`ecInitSheets()` 冪等建立：

| 表 | 欄位 |
|---|---|
| `EC_REGISTRY` | unit_id, name, branch, backend, apikey, modules, status, updated_at, updated_by |
| `EC_MODULES` | module, enabled, scope, note, updated_at, updated_by |
| `EC_ACCESS_LOG` | ts, sub, role, via, event, detail |

`ecRoute(action, body, user, ymis)` 支援的 action 與所需權限：

| action | 最低權限 |
|---|---|
| `ecStatus` / `ecGetModules` | 免 token |
| `opsRegistry` | 須 `body.apikey === getApiKey()` |
| `ecSigLogin` | 免 token（自帶簽名） |
| `ecSetModule` / `ecRegisterBranch` / `ecUnregisterBranch` / `ecAccessLog` | 60（group_leader） |
| `ecInitSheets` | 80（admin） |

`ecRoute` 對非 EC action 回 `null`，交還原有流程處理。

---

## 9. 環境變數

| 變數 | 用途 | 必需 |
|---|---|---|
| `TROOP_<id>_BACKEND` | leaf `/exec` URL | 是 |
| `TROOP_<id>_APIKEY` | leaf apikey（**只存 server**） | 敏感 action 必需 |
| `TROOP_<id>_OPS_BACKEND` / `_OPS_APIKEY` | 旅系統 registry（fallback `TROOP_OPS_*`） | 否（未設＝獨立運作） |
| `EC_FLUSH_KEY` | registry cache flush 授權 | 否（未設＝flush 回 503） |
| `EC_PUSH_SOURCE` | 送去圖書館的 `source` 標記 | 否 |
| `CIRCULAR_LIBRARY_URL` | 通告圖書館站點 | 否（有預設） |
| `CIRCULAR_CACHE_URL` / `_ENRICH_URL` / `_CATALOG_URL` | 圖書館公開 cache | 否（有預設） |

---

## 10. 測試

```bash
npm test          # 全部（206 項）
npm run test:api  # /api/* 契約
npm run test:eco  # GAS EC 區段
npm run test:ui   # 前端接入層 + §1 紅線
npm run test:e2e  # 原有帳號／進度流程回歸
npm run dev       # 本機預覽 http://localhost:3000
```

`npm run dev` 會自動啟用 fixture 模式（`test/fixtures/`），
用離線的通告樣本 + 假通告圖書館行完整條訂閱鏈路，不需要外網。
設 `EC_FIXTURES=0` 可打真正的通告圖書館。

### 紅線測試（改動時千萬不要放寬）

- `index.html` 不得出現 `currentApikey`，`apiRequest` payload 不得帶 `apikey`；
- LocalStorage session 快照不得寫 `apikey`；
- 分享連結／QR 不得含 `apikey` / `token` / `sig`；
- `/api/*` 回應不得含 apikey；
- 訂閱請求不得含 YMIS／姓名／電郵。
