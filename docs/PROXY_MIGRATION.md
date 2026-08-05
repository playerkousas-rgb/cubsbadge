# GAS 連線架構修正報告 - v6.0 同源 Proxy

## 背景與風險

原架構前端直接 `fetch(currentBackend)` 各旅團 GAS URL，存在：
- 瀏覽器 CORS / Failed to fetch
- GAS 302 redirect 至 `script.googleusercontent.com` 導致回應失敗
- 資料已寫入 Sheet 但前端收不到成功回應
- 寫入失敗被 `.catch(()=>{})` 靜默隱藏，用戶誤以為已儲存

## 新架構

```
瀏覽器 → 同源 Vercel /api/proxy (或 /api/register) → Registry 查找 GAS → Google Sheet
```

- 前端只提交 `troopId` 識別碼
- Proxy 從可信 Registry（`data/troops.json`, `troops.json`, `TROOP_*_BACKEND` 環境變數）查找 GAS URL
- 不接受前端提交任意 `backendUrl`，防止 SSRF / Open Proxy
- 僅允許 `https://script.google.com/macros/s/.../exec`，拒絕不存在旅團及不受信任 URL
- `redirect: "follow"` 自動處理 GAS 重定向
- 15s timeout, `Cache-Control: no-store`, 正確 HTTP status
- 不在 log 輸出密碼、token、API Key

## 修改檔案清單

### 新增
- `api/_lib/registry.js` - 共用 Registry 載入與 URL 驗證
  - 讀取 `data/troops.json` / `troops.json` / env var `TROOP_XXX_BACKEND` / `TROOP_XXX_APIKEY`
  - 支援 `0082` / `82` / `82` 前導零互轉
  - `isValidGasUrl()` 驗證 HTTPS + `script.google.com` + `/macros/s/.../exec`

- `api/proxy.js` - 同源代理核心
  - 只接受 GET/POST，否則 405
  - troopId 格式驗證 `/^[A-Za-z0-9_-]{1,32}$/`
  - Registry 查找，404 if not found
  - URL 驗證，403 if invalid
  - 禁止轉發欄位：`backend`, `backendUrl`, `gasUrl`, `url` 等
  - `redirect: "follow"`, `AbortController` 15s timeout
  - JSON 與非 JSON 上游錯誤處理
  - 不 log 敏感欄位 (password, token, apikey → [REDACTED])

- `api/register.js` - 旅團註冊申請代理
  - 原本前端 `fetch(SCOUT_ADMIN_API)` 直連 GAS，現改為同源 `/api/register`
  - 同樣驗證 troopId 與 scriptUrl 必須為可信 GAS URL
  - 避免瀏覽器 CORS

### 修改
- `api/troops.js`
  - 重構為使用 `registry.js`，統一 Registry 邏輯
  - 只接受 GET, no-store, 405 for other methods

- `index.html` (約 3000 行)
  - 新增統一前端封裝 `apiRequest(gasData, {method, troopId, timeout, allowFail})`
    - 自動附加 `troopId`
    - 同源 `/api/proxy`，GET 用 query string，POST 用 JSON body
    - `AbortController` timeout 15s
    - 防止重複提交 `_ongoingRequests` Set
    - 成功才顯示「已儲存」，失敗顯示友善錯誤，rollback 機制
  - 移除所有 `fetch(currentBackend, ...)` 直連：
    - `doLogin` → `apiRequest({action:'login'})`
    - `loadAppConfig` → `apiRequest({action:'getConfig'})`
    - `loadItemsAndProgress` GET load → `apiRequest({action:'load'}, {method:'GET'})`
    - `saveChanges` → `apiRequest({action:'save', changes})` + await, 防止重複提交, 成功後才清 pending
    - `submitMemberRequest` → `apiRequest({action:'requestComplete'})`
    - `renderRequestsTab` → `getPendingRequests`, `getApplications`
    - `reviewSingleRequest` → `reviewRequest`
    - `batchApprove` → 逐個 `reviewRequest` await，移除 `.catch(()=>{})` 靜默
    - `toggleOtherBadge` / `handleOtherBadgeToggle` → `saveOtherBadge` + rollback on failure
    - `loadUsers` → `getAllUsers`
    - `toggleAllowMemberViewOthers` → `updateConfig`
    - `savePermissions` / `updateUserRole` / `toggleCanTick` → `updateUserRole`
    - `loadApplications` / `reviewApp` → `getApplications` / `reviewApplication`
    - `bulkAddMembers` / `submitAddMember` → `addUser` / `addMember`
    - `resetMemberPassword` → `resetPassword`
    - `deactivateUser` → `deactivateUser`
    - `loadApprovalHistory` → `getApprovalHistory`
    - `loadAuditHistory` → `getAuditLog`
    - `submitForceChange` → `changePassword`
    - `submitRegistration` → `fetch('/api/register')` 而非直連 `SCOUT_ADMIN_API`
  - 移除 `.catch(()=>{})` 靜默隱藏，全部改為顯示錯誤 + console.warn
  - 保留 DEMO/MOCK 模式：`currentTroopId==='DEMO'` 時不連接真實後端
  - `bulkGuard` 更新為檢查 `isDemoMode()` + `currentTroopId`

## 安全檢查結果

- ✅ Proxy 只連 Registry 已登記 HTTPS GAS /exec
- ✅ 前端不再提交 `backend` URL，`FORBIDDEN_FORWARD_KEYS` 過濾
- ✅ troopId 格式驗證，拒絕 `../`, `<script>`, 等注入
- ✅ 不存在旅團 404
- ✅ 無效 URL 403
- ✅ 不在 log 輸出密碼/token/API Key
- ✅ `Cache-Control: no-store`
- ✅ `redirect: follow` + timeout 15s
- ✅ JSON / 非 JSON 上游錯誤處理，正確 HTTP status
- ✅ 前端 Network 中業務請求只去同源 `/api/proxy`, `/api/troops`, `/api/register`, `data/*.json`
- ✅ 瀏覽器不再直接請求 `script.google.com` (除 placeholder 文本)

## 測試結果

### 單元測試 (Node)
- `test_proxy.js`:
  - missing troopId → 400 ✓
  - invalid format `<script>` → 400 ✓
  - non-existent troop `0000` → 404 ✓
  - valid troop `0082` load → 200 success ✓
  - valid troop `0099` load → 200 success ✓
  - login success/fail → 正確處理 ✓
  - SSRF 嘗試提交 `backend` 參數被忽略 → 200 且不轉向惡意 URL ✓
  - 多旅團隔離：0082 儲存僅影響 0082，不影響 0099 ✓

### 整合測試 (full_test.js)
- 本地 Mock GAS 2 旅團 + App Server 模擬 Vercel
- `/api/troops` 返回 2 旅團 ✓
- `/api/proxy?troopId=0082&action=load` 僅返回 0082 成員 ✓
- `/api/proxy?troopId=0099` 僅返回 0099 成員 ✓
- 保存到 0082 後重載，0082 有新數據，0099 無交叉 ✓
- 錯誤旅團 ID 被拒絕 404 ✓
- SSRF 參數被過濾 ✓
- `index.html` 中 `fetch(currentBackend` 數量 = 0 ✓

### 前端邏輯檢查
- `grep fetch(currentBackend` → 0
- `grep script.google.com` → 僅 placeholder 與驗證邏輯，無直接 fetch
- `grep .catch` → 僅 clipboard 複製，非靜默
- 所有寫入操作使用 `await apiRequest`，成功後才 toast「已儲存」，失敗顯示錯誤並 rollback (其他獎章) 或保留 pending 重試 (批量進度)

## 多旅團驗證

- 測試兩個不同旅團 0082 / 0099：
  - 旅團 A 請求只進入 A 的 Mock GAS (log 確認)
  - 旅團 B 請求只進入 B
  - 切換旅團後 `progressFlat`, `members`, `token` 按 `LS.cacheProgress(troopId)` 隔離，不串用
  - 修改 request 嘗試指向 Registry 外 URL 被拒絕 (403 / backend 參數被過濾)

## GAS 是否需要修改及重新部署？

- **不需要**。保留現有 `doGet`/`doPost`, Sheet 結構, GAS 部署 URL, API Key, 帳戶及 token, request schema。
- Proxy 轉發的 payload 與原本前端直連時完全一致 (JSON.stringify)，僅改變傳輸路徑。
- 若未來想進一步強化：可考慮在 GAS 端增加 origin 檢查或 API Key 必填，但現階段不需重新部署。
- 唯一例外：若要啟用本地 Mock 測試，需在 `TROOP_xxx_BACKEND` 使用 localhost，這僅在非 production 環境允許，production 仍僅允許 `script.google.com`。

## Vercel 是否需要新增環境變數？

- 不需要新增。沿用現有：
  - `TROOP_0082_BACKEND`, `TROOP_0082_APIKEY` 等 (或 `TROOP_82_*` 去零變體)
  - 可選 `SCOUT_ADMIN_API` 用於 `/api/register` 轉發目標，預設已 hardcode 為現有 admin GAS，無 env 時仍可用。
- 若新增旅團，按原流程：管理員在 `data/troops.json` 增加條目 + Vercel 環境變數 `TROOP_XXXX_APIKEY` (可選) + redeploy。

## 部署及合併步驟

1. 確認分支 `arena/019fd190-cubsbadge` 已包含：
   - `api/_lib/registry.js`
   - `api/proxy.js`
   - `api/register.js`
   - `api/troops.js` (重構)
   - `index.html` (全部 fetch 改經 proxy)
   - `docs/PROXY_MIGRATION.md` (本文件)

2. 本地測試：
   ```bash
   node /tmp/test_proxy.js
   node /tmp/full_test.js
   ```

3. Push 到遠端分支：
   ```bash
   git push origin arena/019fd190-cubsbadge
   ```

4. Vercel 會自動部署此分支 (或 PR preview)。檢查：
   - 首頁旅團選擇正常
   - 登入 0082 / 錯誤密碼顯示友善錯誤
   - 讀取資料經 `/api/proxy?troopId=...&action=load`
   - 新增/修改/儲存 → Network 僅見 `/api/proxy`，無 `script.google.com`
   - 重新整理後剛儲存資料仍存在
   - 錯誤旅團 ID (`/api/proxy?troopId=EVIL`) 404
   - 後端失敗時前端不顯示假成功 (拔掉網絡或 mock 失敗時)

5. 合併到 `main` 後，Vercel production 部署，旅團管理員無需重新部署 GAS。

## 參考 DGA 方案差異

- 參考了 DGA 同源 Proxy 概念 (redirect follow, no-store, server-side lookup)
- **未**照搬 DGA 固定 GAS URL：本 App 為多旅團，Proxy 根據 `troopId` 查 Registry，支援無限旅團擴展
- DGA 單一後端 vs 本方案多後端 + SSRF 防護 + 前導零兼容

## 待改進

- 可考慮在前端 `apiRequest` 增加更細緻的 optimistic UI rollback for `saveChanges` (目前保留 pending 重試)
- 可考慮在 `vercel.json` 增加 `api/proxy` 的 `maxDuration` 設定
- 可考慮為 `api/register` 增加 rate limiting

---
更新時間：2026-08-05
分支：arena/019fd190-cubsbadge
