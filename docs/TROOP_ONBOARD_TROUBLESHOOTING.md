# 新旅團接入排錯（2026-11-11）

> 對應回報：新旅團（0042）已登記功能變數，測試連線時出現
> 1. 「⚠️ 暫時未能核對 GS 版本。請不要當作已經更新；稍後按『重新檢查』。」
> 2. 超管登入後測試連通時：「`Unregistered or invalid troop ID: 0042` … 可用旅團: 0042, 0082, 0110 … 若你看到『找不到82的SHEET』…」

兩者其實是**同一個根因的兩個表現**，而且舊訊息會把 0042 的用戶誤導去檢查 0082。

## 1. 根因

| 位置 | 舊行為 | 問題 |
|---|---|---|
| `api/_lib/registry.js` | 功能變數值原樣使用 | Vercel 貼值常連引號／空白／換行一起貼；`new URL()` 失敗 → 旅團被當「未登記」 |
| `api/troops.js` | 「有 backend 值」＝ `connected:true` | 與 `/api/proxy` 的嚴格 `isValidGasUrl` 不一致 → **卡片見到 0042，一按就話未登記** |
| `api/proxy.js` | 所有 404 都用同一句「請檢查是否 0082 / 82」＋「找不到82的SHEET」提示 | 完全沒有講「你的 0042 有填，只是值不合格」，也沒有講是哪一部分不合格 |
| `index.html` | `status==='error'` 只顯示「稍後按重新檢查」 | 真正原因（後端未接通 / 404）被吞掉，用戶只能不斷重試 |

## 2. 修正內容

1. **值清洗（`cleanEnvValue`）**：去掉包裹引號、角括號、反引號、NBSP／全形空格／零寬字元、前後空白；多行貼上時取第一段非空行。只清「明顯不屬於值的包裹字元」，不猜測、不改寫 URL。
2. **明確診斷（`diagnoseGasUrl`）**：回問題代碼，永不回值本身。
   `EMPTY` / `EMPTY_AFTER_CLEAN` / `NOT_A_URL` / `NOT_HTTPS` / `WRONG_HOST` / `HAS_QUERY_OR_HASH` / `HAS_CREDENTIALS_OR_PORT` / `DEV_URL` / `NOT_EXEC_PATH` / `SHORT_DEPLOY_ID`。
3. **`/api/proxy` 404 分三種**：
   - `TROOP_NOT_CONFIGURED`：完全沒填（`envVarPresent:false`）
   - `BACKEND_INVALID`：有填但值不合格（附 `problemCode` 及具體說明）
   - 訊息一律用**請求者自己的編號**（0042），不再叫 0042 的用戶去檢查 0082；`initializeSheets` 只留在真正相關的提示。
4. **`/api/troops` 一致性**：`connected` 與 proxy 用同一條 `isValidGasUrl`；「有填但無效」改為放在 `misconfigured`，帶 `connected:false` + `problemCode`／`problem`（不洩漏 URL），唔會靜靜消失。
5. **`/api/health`**：404 同樣分 `TROOP_NOT_CONFIGURED` / `BACKEND_INVALID`，附 `backendConfigProblem`。
6. **前端**：
   - 旅團列表顯示紅色虛線警示卡（不可點擊），直接寫出問題代碼及修正方法。
   - 版本核對失敗（`error`）時，卡片除保留原文「暫時未能核對 GS 版本…請不要當作已經更新」外，會顯示**真正原因**；並改為**不提供 Code.gs 下載**（版本未核實時不應叫人覆蓋後端）。

## 2b. 第二回報：`{"success":false,"error":"Unknown action: "}`

這句是 **leaf GS 的 `doGet`/`doPost` 尾段**回覆（`apps-script/Code.gs`：`'Unknown action: '+action`）。
注意冒號後面是空白 ⇒ 後端收到的 `action` 是空字串。

成因（已修）：

| 情況 | 舊行為 | 現在 |
|---|---|---|
| `action` 只在 query string（`POST /api/proxy?action=ecStatus`），body 冇 `action` | proxy 只讀 `payload.action`，於是轉發一個**冇 action** 的 body → GS 回 `Unknown action: ` | `payload.action` 會由已解析的 action 補回，再轉發 |
| `action` 是空字串／純空白 | 視為有 action 照樣轉發 | 即時 400 `MISSING_ACTION`，講清楚要填 body 的 `action` |
| 後端真的不認識該 action（打錯字／GS 版本舊） | 只回一句 `Unknown action: xxx`，前端亦唔顯示 troubleshooting | proxy 加 `troubleshooting.hint`（「後端連線正常，但唔識 action『xxx』…」），前端 `apiRequest` 會連 hint 一齊顯示，並且**不會**誤判為 Sheet／帳號問題 |

另外提醒：直接 `GET <GAS /exec>` 而完全冇 `action` 參數，一樣會得到這句 —— 測試連線請用
`/api/health?troopId=0042` 或網站上的「重新檢查」，唔好直接開 `/exec`。

## 3. 現在的正確處理流程（APP ADMIN）

1. Vercel → Settings → Environment Variables，逐個檢查 `TROOP_0042_BACKEND` / `_APIKEY` / `_NAME`：
   - BACKEND 只貼「部署 → 管理部署」的 `https://script.google.com/macros/s/…/exec`
   - 不可有引號、空白、換行、`/dev`、`?` 參數；Workspace 網址（`/a/<domain>/…`）系統會自動轉公開格式
2. **儲存後必須 Redeploy**（環境變數不會熱生效）。
3. `GET /api/health?troopId=0042` 應見 `troopFound:true`；若見 `code:"BACKEND_INVALID"`，`backendConfigProblem.message` 就會講是哪一部分錯。
4. 旅團端另需執行過 `initializeSheets()`（新 Sheet 首次使用）。
5. 回到網站按「重新檢查」。

## 4. 回歸測試

- `test/api.test.mjs`：值帶引號／尾隨換行仍可接通；`/dev` → `BACKEND_INVALID` + `DEV_URL`；可用清單與 `connected` 一致；`TROOP_NOT_CONFIGURED` 與 `BACKEND_INVALID` 不混淆；health 診斷不洩漏 URL。
- `test/frontend-render-harness.mjs`：`misconfigured` 顯示警示卡且不可點擊；版本核對失敗要顯示原因、保留「勿當已更新」原文、且不可出現下載連結。
