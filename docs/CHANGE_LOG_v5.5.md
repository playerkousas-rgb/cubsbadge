# CHANGE LOG v5.5 — 功能變數契約（4樣）+ 後端GS 對應

> 更正之前 agent 寫錯嘅設定契約。全部設定「指向功能變數」，唔再指向 JSON、唔再寫死。

## 契約：Vercel 環境變數 4 樣

| 功能變數 | 後端GS 對應 |
|---------|------------|
| `SUPER_KEY` | Script Property `SUPER_KEY` = 超管 sheep 密碼（兩邊同一隻值） |
| `TROOP_<id>_BACKEND` | GS 部署 URL（/exec） |
| `TROOP_<id>_APIKEY` | Script Property `API_KEY` |
| `TROOP_<id>_NAME` | Script Property `TROOP_NAME` |

## 改動

### 之前 agent 寫錯咗、已更正
- ❌ 「URL 不用功能變數，放 troops.json 公開就得」→ ✅ URL = `TROOP_<id>_BACKEND` 功能變數
- ❌「管理員改 TROOPS JSON + 加 1 個功能變數」→ ✅ 管理員加功能變數 4 樣（SUPER_KEY + 每旅團 3 個），唔使改 JSON
- ❌ 超管帳密碼寫死 0728／雜湊 property → ✅ 指向 `SUPER_KEY` 功能變數
- ❌ 名稱放 JSON → ✅ `TROOP_<id>_NAME` 功能變數

### Vercel 端（api/）
- `registry.js` v3.0：淨係讀功能變數（`TROOP_*_BACKEND/_APIKEY/_NAME` + `SUPER_KEY`）；移除 JSON 讀取、移除內置 URL；新增 `getSuperKey()` / `verifySuperKey()`（timing-safe）
- `register.js`：要 `SUPER_KEY`（`x-super-key` header 或 body `superKey`）先入到管理註冊；未設 → 503、錯 → 403；轉發埋俾後端管理 GS 驗證（對應）
- `health.js`：新增 `envContract`（4 樣 boolean，永不回值）
- `troops.js`：移除內置 0082 URL fallback；空 registry 回 `_hint` 提示設定 4 樣
- `ecosystem.js`：NAME 優先取功能變數；回應加 `envNames`（功能變數名對應表）+ `superKeyConfigured`
- 前端 `index.html`：旅團清單淨係來自 `/api/troops`（唔再讀 data/troops.json／內置 fallback）；SETUP 指南更新為 4 樣流程

### 後端GS（apps-script/Code.gs）
- 新增 `SUPER_KEY` / `TROOP_ID` / `TROOP_NAME` Script Properties + `ensureSuperKey()` / `setSuperKey()` / `showSuperKey()` / `setTroopId()` / `setTroopName()` / `getScriptUrl()`
- 新增 `vercelEnvLines()` / `showVercelEnv()`：一次過顯示 4 樣對應值 copy 落 Vercel
- 超管 sheep 密碼指向 `SUPER_KEY`（有設定就只認 SUPER_KEY；未設先兼容舊 0728／自訂密碼）
- 超管「改密碼」= `setSuperKey(新密碼)`（回應提示同步 Vercel 功能變數）
- `initializeSheets()`：自動生成 `API_KEY` + `SUPER_KEY`，問旅團編號／名稱，彈窗顯示 4 樣對應值
- `showApiKey()`：顯示 4 樣對應值
- 後端版本 `cub-5.5.0-leaf`

### 文件
- `VERCEL_ENV_SETUP.md` v8.0：重寫為功能變數契約（4 樣）+ 後端GS 對應表
- `APP_ADMIN_WORKFLOW.md`：管理流程改為加功能變數（唔使改 JSON）
- `docs/ECOSYSTEM.md` / `docs/PROXY_MIGRATION.md`：環境變數表補齊 4 樣
- `troops.json` / `data/troops.json`：deprecated stub（程式唔再讀取）

### 測試
- 新增 6 個契約測試：NAME 指向功能變數、無 env 無旅團、SUPER_KEY 驗證、register 503/403＋轉發對應、health envContract 不洩值
- 全部通過：api 23、ecosystem 41、e2e 69

COPYRIGHT 2026 Scout System
