# Vercel 環境變數（功能變數）設定指南 v8.0 — 功能變數契約定版（4樣）

> ⚠️ 更正之前 agent 寫錯嘅嘢：
> 1. ❌ 之前寫「URL 不用功能變數、放 troops.json 公開就得」——**錯**。
> 2. ❌ 之前話管理員「改 TROOPS JSON + 加 1 個功能變數」——**錯**。
> 3. ❌ 超管帳密碼、API KEY、URL、名稱之前指向 JSON／寫死——**已全部更正為指向功能變數**。
>
> ✅ **正確契約：Vercel 功能變數應該有 4 樣，後端 GS 一一對應。**

---

## 功能變數 4 樣（全部指向功能變數，唔再指向 JSON）

| # | 功能變數 | 值來自邊度（後端GS 對應） | 幾多個 |
|---|---------|--------------------------|--------|
| 1 | `SUPER_KEY` | GS Script Property `SUPER_KEY` = **超管 sheep 密碼**（`showSuperKey()` / `showVercelEnv()` 睇） | 全 APP **1 個** |
| 2 | `TROOP_0082_BACKEND` | GS 部署 URL（`/exec` 結尾嗰條） | 每旅團 1 個 |
| 3 | `TROOP_0082_APIKEY` | GS Script Property `API_KEY`（`getApiKey()` 自動生成） | 每旅團 1 個 |
| 4 | `TROOP_0082_NAME` | GS Script Property `TROOP_NAME`（`setTroopName()` / initializeSheets 時設定） | 每旅團 1 個 |

**命名規則：** `TROOP_` + 旅團編號（保留前導 0，0082 就係 `TROOP_0082_*`）+ `_BACKEND` / `_APIKEY` / `_NAME`。
多旅團（例：0082 + 0015）就加 `TROOP_0015_*` 三個；`SUPER_KEY` 仍然全 APP 一個。

**Vercel Dashboard 操作：** Project → Settings → Environment Variables → Add
（4 個都勾 Production, Preview, Development）→ Redeploy。

---

## 後端 GS 對應（Code.gs v5.5）

Vercel 功能變數 ↔ GS Script Properties 一一對應（**兩邊同一隻值**）：

| Vercel 功能變數 | GS 對應 | 點樣攞值 |
|----------------|---------|----------|
| `SUPER_KEY` | Script Property `SUPER_KEY`（= 超管 sheep 密碼） | `ensureSuperKey()` 自動生成 `sk_`+24hex；`showSuperKey()` 再睇 |
| `TROOP_0082_BACKEND` | 部署 URL | 部署為網頁應用程式後 `/exec` 結尾嗰條；`showVercelEnv()` 顯示 |
| `TROOP_0082_APIKEY` | Script Property `API_KEY` | `getApiKey()` 自動生成 `sc_`+24hex；`showApiKey()` 再睇 |
| `TROOP_0082_NAME` | Script Property `TROOP_NAME` | `setTroopName('第 82 旅')` 設定；`getTroopName()` 睇 |

**超管帳（sheep）密碼 = `SUPER_KEY`（指向功能變數）：**
- 有設定 `SUPER_KEY` → 登入只認 `SUPER_KEY`（唔再係寫死 0728）
- 超管用「改密碼」→ 新密碼會寫入 Script Property `SUPER_KEY`，**記得同步更新 Vercel 功能變數 `SUPER_KEY`**
- 舊部署未設 `SUPER_KEY` → 維持舊 0728／自訂密碼向下兼容；跑一次 `initializeSheets()` 或 `ensureSuperKey()` 即切換
- 超管仍然係後端隱藏帳戶：Users 表／用戶管理／成員名單永遠見唔到 sheep

**GS 新增／更新咗嘅函數：**
```javascript
ensureSuperKey() / getSuperKey() / setSuperKey(v) / showSuperKey()
getTroopId() / setTroopId('0082')        // 令 showVercelEnv() 顯示精確變數名 TROOP_0082_*
getTroopName() / setTroopName('第 82 旅')
vercelEnvLines() / showVercelEnv()       // 一次過顯示 4 樣 copy 落 Vercel
```

---

## 設定流程

**旅團負責人做：**
1. 建新 Google Sheet → Apps Script → 貼 `apps-script/Code.gs` → 儲存
2. 執行 `initializeSheets` → 授權
   - 自動生成 `API_KEY` + `SUPER_KEY`
   - 會問旅團編號／名稱（存 `TROOP_ID` / `TROOP_NAME`）
   - 彈窗顯示 4 樣功能變數對應值
3. 部署為網頁應用程式（執行身分：我；存取：任何人）→ 攞 `/exec` URL
4. 跑 `showVercelEnv()` 一次過睇晒 4 樣（隨時再睇：`showSuperKey()` / `showApiKey()`）

**旅團提交俾 APP ADMIN（4 樣）：**
```
旅團編號：0082
SUPER_KEY：sk_xxxxxxxx          ← 超管 sheep 密碼（兩邊同一隻值）
TROOP_0082_BACKEND：https://script.google.com/macros/s/.../exec
TROOP_0082_APIKEY：sc_xxxxxxxx
TROOP_0082_NAME：第 82 旅
```

**管理員做（全部係 Vercel 功能變數，1 分鐘）：**
1. 全 APP 一次：加 `SUPER_KEY`（同旅團 GS 嘅超管密碼同一隻值）
2. 每旅團加 3 個：`TROOP_0082_BACKEND` / `TROOP_0082_APIKEY` / `TROOP_0082_NAME`
3. Redeploy → 首頁 `troopGrid` 即刻見到該旅團

---

## 點解唔再用 JSON？

- 之前 URL／名稱放 `troops.json`、超管密碼寫死 0728 —— 全部「唔指向功能變數」，已更正
- `data/troops.json` / `troops.json` **已棄用**（deprecated stub），程式唔再讀取
- 前端亦唔再讀 JSON／內置 URL fallback：旅團清單淨係來自 `/api/troops`（= 功能變數）
- registry（`api/_lib/registry.js`）淨係讀功能變數；無功能變數 = 無旅團（`/api/troops` 回 `_hint` 提示）

---

## SUPER_KEY 嘅用途（Vercel 端）

- = GS 隱藏超管 sheep 嘅密碼（**兩邊同一隻值**）
- 保護 APP 管理 API：`/api/register`（旅團註冊）必須帶 `x-super-key` header（或 body `superKey`）
  - `SUPER_KEY` 未設定 → 503（管理 API 停用，唔會變成公開註冊口）
  - 驗證失敗 → 403
  - 驗證通過 → 轉發註冊俾後端管理 GS（連埋 `superKey`，後端GS 對應驗證）
- `/api/health` 只回 `SUPER_KEY` 有冇設定（boolean），**永不回值**

---

## 紅線（唔好放寬）

- `apikey` / `SUPER_KEY` **值**永不回前端、永不入 URL、永不入 QR（`/api/*` 回應只可以有 boolean「有冇設定」）
- proxy 一律丟棄前端自帶嘅 `apikey` / `backend`（SSRF 防線），由 registry（= 功能變數）注入
- 功能變數值唔入 GitHub（Vercel Dashboard 設定就得）

---

## 檢查清單

- [x] Vercel 功能變數 4 樣：`SUPER_KEY`、`TROOP_<id>_BACKEND`、`TROOP_<id>_APIKEY`、`TROOP_<id>_NAME`
- [x] registry 淨係讀功能變數（唔讀 JSON、無內置 URL）
- [x] 超管 sheep 密碼指向 `SUPER_KEY`（GS Script Property ↔ Vercel 功能變數，兩邊同一隻值）
- [x] GS `initializeSheets` 自動生成 `API_KEY` + `SUPER_KEY`；`showVercelEnv()` 顯示 4 樣對應值
- [x] `/api/register` 要 `SUPER_KEY` 並轉發後端 GS 驗證
- [x] `troops.json` / `data/troops.json` 已棄用（stub），前端唔再讀取
- [x] `/api/health` 有 `envContract`（4 樣 boolean）方便檢查

---

## 常見問答

**Q: 超管帳嘅密碼點解要指向功能變數？**
A: 之前寫死 0728／雜湊 property，唔係「指向功能變數」。而家超管密碼 = `SUPER_KEY`：GS Script Property 同 Vercel 功能變數兩邊同一隻值，管理員改密碼就兩邊同步。

**Q: API KEY 同 URL 呢？**
A: 一樣——全部指向功能變數：`TROOP_0082_APIKEY`、`TROOP_0082_BACKEND`。之前指向 `troops.json` 嘅做法已移除。

**Q: 點解仲有 troops.json 檔？**
A: 只係 deprecated stub 提醒大家唔好再用；程式一行都唔讀。可以無視。

**Q: 幾個旅團點算？**
A: 每旅團 3 個功能變數（`TROOP_XXXX_BACKEND` / `_APIKEY` / `_NAME`）；`SUPER_KEY` 全 APP 一個（各旅團 GS 嘅超管密碼設成同一隻 `SUPER_KEY`，APP ADMIN 一 key 管晒）。

**Q: 點睇返啲值？**
A: GS 編輯器跑 `showVercelEnv()`（4 樣一次過）、`showSuperKey()`（淨係 SUPER_KEY）、`showApiKey()`（4 樣一樣顯示）。

---

COPYRIGHT 2026 Scout System - Vercel Env v8.0 功能變數契約（4樣）+ 後端GS 對應
