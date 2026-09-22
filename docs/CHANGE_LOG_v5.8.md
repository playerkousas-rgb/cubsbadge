# CHANGE LOG v5.8 — 超管密碼只放喺 Vercel，GS 完全冇

> 更正 v5.7 寫錯嘅一件事：
> v5.7 寫「超管密碼 = GS Script Property `SUPER_KEY`，去 ⚙ 專案設定 → 指令碼屬性睇／改」。
> **錯。** 指令碼屬性，旅團（任何有 Apps Script 權嘅人）開專案設定就睇到，等於冇隱藏。
>
> v5.8：**超管密碼只放喺 APP ADMIN 嘅 Vercel 功能變數 `SUPER_KEY`**；
> leaf GS 只有帳號名 `sheep`，冇密碼、冇雜湊、冇 Script Property、冇 fallback。

## 1. 超管登入（就咁簡單）

```
前端「登入」（帳號 sheep）→ /api/proxy
  → Vercel 比對 SUPER_KEY（密碼唔會離開 Vercel，亦唔會落 GS）
  → 通過就送 action=superLogin 落 leaf（apikey 由 server 端注入，同其他 server-to-server 一樣）
  → leaf 發超管 token
```

- **改密碼**：Vercel → Settings → Environment Variables → `SUPER_KEY` → Redeploy。
- **未設定 `SUPER_KEY`** = 超管登入唔到（冇後備密碼）。失敗一律回「帳號或密碼錯誤」，唔會透露隱藏帳戶存在。
- **旅團睇唔到密碼**：Google Sheet、Apps Script、專案設定、指令碼屬性都冇。

## 2. `apps-script/Code.gs`

| 改動 | 內容 |
|---|---|
| 刪 | `getSuperAdminPassword()` / `superPasswordMatches()` / `setSuperKey()` 寫入 / 任何 `SUPER_KEY` property 讀寫 |
| 加 | `handleSuperLogin(body)`（APP 專用；要 apikey，冇密碼）＋ `purgeLegacySuperKeyProperty()` |
| 改 | `doPost` 收 `action=superLogin`（要 apikey）；`handleLogin` 見超管帳號 → 回「找不到此帳號」；`handleChangePassword` 超管 → 指返去 Vercel 改 |
| 自動 | 跑 `initializeSheets()` 會清走舊部署遺留喺指令碼屬性嘅 `SUPER_KEY` |

普通帳號登入／進度／審批／用戶管理：**完全無改**。超管帳號照舊係虛擬帳號（唔寫 Users 表、唔喺名單／操作紀錄出現）。

## 3. Vercel 端

- `api/_lib/superadmin.js`（新）：比對 `SUPER_KEY`（timing-safe）+ 輕量失敗限流（15 分鐘 20 次）。
- `api/proxy.js`：超管登入就地處理，密碼**永遠唔會**轉發去 GS；其他帳號流程零改動。
- `api/health.js`：診斷文字更新。

## 3b. GS 減重（讀取快啲）

| 改動 | 內容 |
|---|---|
| 加 | `tbl()` —— 同一次執行內嘅表快取：同一個 action 重複查同一張表唔會再叫 API |
| 加 | `sheetMap()` / `ensureTable()` / `styleHeader()` —— 合併 17 段重複表頭設定、6 段重複建表邏輯 |
| 效果 | `initializeSheets()` 查表 **15 → 2 次**（另加一次 `getSheets()`）；`handleLoad` 9 → 7 次；其餘 handler 本來已最少 |

## 4. 前端／文件

- `index.html`：版本 → v5.8；文案加「GS 完全冇超管密碼」；`isSystemAccount()` 唔再硬寫帳號名。
- `VERCEL_ENV_SETUP.md` v10.0、`APP_ADMIN_WORKFLOW.md` v10.0、`docs/CHANGE_LOG_v5.8.md`（本檔）、v5.7 文件加註更正。
- 規矩：**程式碼內唔寫版號註解**（Code.gs／api／index.html），版號只留喺 MD 文件。

## 5. 測試

`npm test` → api **28** / ecosystem **53** / e2e **72**，全綠。
重點測試：超管密碼錯 → 唔會打 leaf；正確 → 前端只送 `action=superLogin`（冇密碼、冇帳號）；
普通帳號登入完全唔變；leaf 冇 apikey 唔會發超管 token。

## 5b. 上游一時嘅 HTML（登入忽然「後端服務響應異常」）

Google 偶爾會回一頁 HTML 錯誤頁（唔係本系統 script 出嘅 JSON），登入就會無啦啦失敗。
`api/proxy.js` 而家遇到呢種 HTML 會**自動重試一次**，成功就當無事；真係壞先回 502。
另外兩個安全修正：

- **前端唔可以直接叫 `action=superLogin`**：舊 proxy 會幫任何請求注入 apikey，
  leaf 見 apikey 啱就派超管 token。而家 proxy 只准「驗過 SUPER_KEY 嘅超管登入流程」觸發呢個 action，其他一律 403。
- **錯誤訊息唔再漏部署 URL**：502 嘅 `troubleshooting.gasUrl` 已改成 `backendHost`（只講 host）。

## 6. 已知取捨（老實講，唔繞圈）

leaf 分唔清「APP 打嚟」定「旅團自己打嚟」—— 但如果加簽名／白名單去分，就要旅團多跑步驟、多設功能變數，
同「旅團簡單化」相反。而且旅團本身已經有自己個 Sheet 嘅完全控制權，多呢一步對佢哋冇實際好處。
所以 v5.8 唔加：**密碼放 Vercel，GS 冇**（已經達到「隱藏」嘅目的），流程同以前一樣。

後端版本字串（`EC_BACKEND_VERSION`）：`cub-leaf`

COPYRIGHT 2026 Scout System
