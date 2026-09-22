# CHANGE LOG v5.7 — 設定契約更正（所有功能變數由 APP ADMIN 設定）+ 超管真正隱藏

> 更正 v5.5／v5.6 寫錯嘅兩件事：
> 1. **功能變數唔係由旅團設定** —— 旅團只生成 API KEY，交 3 樣（編號 / 部署 URL / API KEY）；`SUPER_KEY`、`TROOP_<id>_NAME` 同全部 Vercel 功能變數由 **APP ADMIN** 設定。
> 2. **超管帳號唔可以放出來** —— `Code.gs` 之前寫死 `SUPER_ADMIN_PASSWORD = '0728'`，仲有 `showSuperKey()` / `showVercelEnv()` 彈窗顯示超管密碼。全部移除。

## 1. `apps-script/Code.gs`（v5.7.0-leaf）

### 1.1 超管帳號：程式碼只見 `sheep`
- **刪除** `const SUPER_ADMIN_PASSWORD = '0728'`（全檔已無任何寫死密碼／`0728` 字串）
- **刪除** `SUPER_PASS_HASH_PROP` / `getSuperAdminPasswordHash()` / `setSuperAdminPasswordHash()`（舊雜湊後備）
- **刪除** `ensureSuperKey()`（自動生成）同 `showSuperKey()`（顯示密碼）
- 保留：`const SUPER_ADMIN_LOGIN = 'sheep'`（＋由它衍生嘅內部電郵）＝ `Code.gs` 唯一見到嘅超管資料
- 新增（永不回值）：
  - `superKeyConfigured()` — 只回 boolean「有冇設定」

### 1.2 超管密碼 = 功能變數 SUPER_KEY（就係咁簡單）
```js
const SUPER_ADMIN_LOGIN = 'sheep';                       // 帳號名
const SUPER_ADMIN_PASSWORD = getSuperAdminPassword();    // = 功能變數 SUPER_KEY

function getSuperAdminPassword(){ return PropertiesService.getScriptProperties().getProperty('SUPER_KEY') || ''; }
function superPasswordMatches(plain){
  const sk=getSuperAdminPassword();
  if(!sk) return false;                                  // 未設定 = 一律唔通（冇 fallback）
  return ecSafeEqual(String(plain||''), sk);
}
```
（設計原則：用家唔係專業，唔加 hash／salt ／多種模式等複雜嘢，越複雜越唔會有人用。）
- 超管登入失敗 → **同一句通用訊息 `帳號或密碼錯誤`**（唔會透露隱藏帳戶存在／設定狀態），只喺 `Logger.log` 記錄
- 超管「改密碼」→ `setSuperKey(新密碼)`，**只寫入、永不回顯**
- `handleGetAuditLog(viewer)`：非超管睇唔到超管嘅操作紀錄

### 1.3 旅團只交 3 樣（GS 顯示面）
- `initializeSheets()`：
  - **只生成 API KEY**（唔會再生成 SUPER_KEY）
  - 彈窗只顯示「交俾 APP ADMIN 嘅資料（旅團只交呢 3 樣）」＋預設管理員帳號提示
  - 回傳 `{success, apiKey, superKeyConfigured, scriptUrl, troopId, troopName}`（唔再回傳 `superKey` 值）
- `vercelEnvLines()` / `showVercelEnv()` / `showApiKey()`：只顯示 **旅團編號 / 部署 URL / API KEY**，永不顯示超管密碼（只可以提「已設定 / 未設定」）

## 2. 前端 `index.html`
- 移除所有公開提及：`超管隱藏版`、`sheep`、`超管密碼 = SUPER_KEY`、「複製功能變數 4 樣」等字眼
- 部署指南改為：旅團只做 3 樣 → 交 3 樣 → **APP ADMIN 設定全部功能變數**
- 用戶管理角色說明不再列超管；領袖教學第 7 節改為「維護帳戶（隱藏）」
- 錯誤 / 空狀態提示：功能變數一律寫「由 APP ADMIN 設定」

## 3. Vercel 端（`api/`）
- 只改文字／註釋，**行為不變**（`SUPER_KEY` 仍然係 APP ADMIN 設定嘅管理 key）
- `registry.js` / `register.js` / `health.js` / `troops.js` / `_lib/ecosystem.js`：註釋同提示改為「由 APP ADMIN 設定、GS 永不顯示」

## 4. 文件
- `VERCEL_ENV_SETUP.md` → **v9.0**（全部功能變數由 APP ADMIN 設定）
- `APP_ADMIN_WORKFLOW.md` → **v9.0**（旅團只交 3 樣）
- `docs/LEADER_GUIDE.md` / `docs/ECOSYSTEM.md` / `docs/PROXY_MIGRATION.md`：超管描述改為隱藏維護帳戶，冇密碼、冇 0728

## 5. 測試
- `test/ecosystem.test.mjs` 新增 **v5.7 區塊（9 項）**：
  - Code.gs 靜態掃描：只有 `sheep`；冇 `0728`、`SUPER_ADMIN_PASSWORD`、`ensureSuperKey`、`showSuperKey(`、`SUPER_ADMIN_PASSWORD_HASH`
  - `SUPER_KEY` 未設定 → 任何密碼都登入唔到（連舊雜湊 property 都唔通）
  - 設定 `SUPER_KEY` 後 → 只有該值可登入，值永不回傳
  - 前端 payload（load）／`vercelEnvLines()` / `showVercelEnv()` / `showApiKey()` 永不含超管密碼
  - `initializeSheets()` 只生成 API KEY、回傳唔含超管密碼
  - 超管操作紀錄對非超管隱藏
- 結果：`api 23 / ecosystem 50 / e2e 69` 全綠

## 兼容性
- 普通帳號登入、進度、審批、批量開戶等流程**完全無改**
- 舊部署升級：覆蓋 `Code.gs` 後，leaf 上超管入口會**關閉**（直到 APP ADMIN 設定 `SUPER_KEY`）＝ 預期行為（唔會再有 0728 後門）
- Vercel 功能變數契約不變（4 樣，但全部由 APP ADMIN 設定）

版本：`cub-5.7.0-leaf`

COPYRIGHT 2026 Scout System
