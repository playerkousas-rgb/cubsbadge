# 領袖「忘記密碼」— 設計、部署與維運

> 適用版本：frontend `2026.11.02.3` / GS `2026.11.02.3`（見 [CHANGE_LOG_v6.0.md](CHANGE_LOG_v6.0.md) 第 13 節）。
> 只適用於 **👨‍💼 領袖（Email 登入）**。家長／成員用 YMIS 登入，忘記密碼請由領袖喺「用戶管理 → 🔑 重設密碼」處理。

## 1. 使用者流程

1. 登入頁揀「👨‍💼 領袖」分頁 → 按「🔑 忘記密碼？」。
2. 輸入開戶時登記嘅電郵 → 按「📧 發送重設碼」。
3. 如資料符合重設條件，請留意電郵；電郵包含一組 8 位重設碼（例如 `A1B2-C3D4`），**15 分鐘**有效。
4. 返到同一個視窗輸入重設碼 + 自訂新密碼（4-8 位）兩次 → 「💾 設定新密碼」。
5. 成功後電郵會自動填返登入欄，用新密碼登入即可；毋須再強制改密（新密碼係本人即場揀嘅）。

> 無論電郵有冇登記，畫面回應都係同一句「若此電郵已登記為領袖帳戶…」。呢個係刻意設計：唔俾外人用「忘記密碼」探測邊個電郵有領袖帳號。
> 收不到信：檢查垃圾郵件 → 重新申請（新碼會作廢舊碼）→ 仍唔得就聯絡幼童軍團長／管理員喺「用戶管理」重設。

## 2. 安全設計

| 項目 | 做法 |
| --- | --- |
| 授權來源 | **只有**寄到 Users 表登記電郵嘅一次性重設碼。`requestPasswordReset` / `confirmPasswordReset` 完全唔讀 request 入面嘅 `token`、`apikey`、`ymis`、`target_ymis`、`role`、`password_hash`；`/api/proxy` 亦主動剷走呢啲欄位。 |
| 合資格帳戶 | 啟用中＋角色 `branch_leader` / `group_leader` / `admin`＋有登記電郵＋已設密碼。保留帳號、`super_admin`、停用帳號、純成員／家長帳號一律唔受理。 |
| 重設碼儲存 | 工作表只存 `hashPassword(code)`（SHA-256）；比較用 `safeEqualText`。明文重設碼、密碼一律唔入表、唔入操作紀錄、唔回傳前端。 |
| 有效期／次數 | 15 分鐘；最多 5 次錯碼，之後該碼鎖死；一次性（成功即 `used`）；新申請、成功、過期、帳戶被停用／降級／改電郵都會作廢其餘未用碼。 |
| 限速 | 同一電郵 30 分鐘最多 3 次；全團每小時最多 30 次（防止公開入口被用嚟洗版或耗盡 Google 每日發信配額）。24 小時前嘅列自動清走。並以 `LockService.getScriptLock()` 避免並發請求互相覆寫。 |
| Session | 重設成功後 `destroyUserTokens(ymis)` 刪走該用戶全部舊 token，舊裝置即刻登出。 |
| 稽核 | 寫入「操作紀錄」一列 `password_reset_by_email`，操作者中性 `system`，詳情唔含重設碼／密碼。 |
| 帳號枚舉 | 有效／無效電郵及寄信成功／失敗回應一致；限速對所有電郵一致。 |
| 關門制 | 兩個 action 同 `apply` 一樣放喺 `doPost` 嘅本地入口閘門之後；`ALLOW_LOCAL_LOGIN=false` 嘅旅團照舊只收上游 sig，唔會因為新增入口而被繞過。 |

### 為什麼唔用「重設連結」？

連結需要後端知道網站網址（每個旅團部署唔一定同一個 domain），亦要處理 URL 參數、跨分頁狀態同開放重導風險。用「電郵重設碼 + 喺原本分頁輸入」可以完全唔依賴網址設定，亦唔會喺瀏覽器網址列、Referer 或 log 留下憑證。

### 點解兩個 action 唔列入 `SENSITIVE_ACTIONS`？

`SENSITIVE_ACTIONS` 係「一定要有 server apikey 或 session token」嘅寫入面。忘記密碼係**登入前**嘅公開入口，無 token 可用；好多旅團只設 `TROOP_<id>_BACKEND`、冇設 `_APIKEY`，一直靠 GAS session token 運作。如果放咗入去，呢啲旅團會被 proxy 401 攔死。安全性由上面嘅一次性重設碼保證，唔係由 session 保證。

## 3. 資料表：「密碼重設」

| 欄 | 用途 |
| --- | --- |
| `reset_id` | `PWR_<timestamp>_<random>` |
| `ymis` | 由電郵查出嘅帳號（無合資格帳戶留空） |
| `email` | 正規化（trim + 小寫）後嘅申請電郵 |
| `code_hash` | 重設碼 SHA-256（無合資格帳戶留空） |
| `created_ms` / `expires_ms` | epoch ms，唔用字串比較時間，避免時區／格式問題 |
| `attempts` | 累計錯碼次數 |
| `status` | `pending` / `no_account` / `superseded` / `used` / `expired` / `locked` / `void` |
| `used_at` | 成功時間（可讀格式，只供人手查閱） |

- **新建 Sheet**：`initializeSheets()` 會一併建立。
- **已有正常 Sheet**：毋須重跑 `initializeSheets()`；第一次撳「忘記密碼」時 `getPasswordResetSheet()` 用 `ensureTable()` 自動補建，只加空白表，唔會改動任何現有帳號、進度、API Key 或設定。
- 呢張表**唔加入** `REQUIRED_SHEETS`，所以 `diagnoseSheets()` 唔會對舊旅團誤報「缺少工作表」。

## 4. 部署／授權（APP ADMIN 同旅團必讀）

1. 下載並換上最新 `apps-script/Code.gs`（GS `2026.11.02.3`）→ 儲存。
2. **喺 Apps Script 編輯器執行一次 `testPasswordResetMail()`**：
   - Google 會彈出授權要求（程式新增咗 `MailApp.sendEmail`，即「傳送電郵」範圍）；按「檢視權限」→ 揀專用旅團 Google 帳戶 → 允許。
   - 函式會寄一封測試信到執行者自己嘅電郵，並清走發信故障旗標。
   - 佢**唔寫任何工作表、唔改任何帳號資料、唔係 `initializeSheets()`**，已有 Sheet 亦可安全執行。
3. 「部署 → 管理部署 → 編輯 → 版本選『新版本』→ 部署」，沿用原 URL。
4. 本版無新增必要欄位；建議更新後執行一次 `initializeSheets()`。跨多版本升級必須執行，新建 Sheet 首次使用亦須執行。
5. 前端部署新版後，首頁／登入頁公告會顯示 GS `2026.11.02.3`；舊 GS 會顯示升級提示，唔會當成後端斷線。

> ⚠️ Google 免費帳戶每日發信配額有限（約 100 封／日），本功能已有全團每小時 30 次限速。電郵由旅團自己嘅 Apps Script 發出，唔會經第三方服務，電郵內容只有重設碼同指示，沒有密碼。

### 如果發信授權未做好

`MailApp.sendEmail` 會擲錯。後端記錄發信故障，但公開回應與成功完全一樣；部署者可執行 `testPasswordResetMail()` 檢查授權。收不到信者可聯絡領袖在「用戶管理」重設密碼。

## 5. 舊 GS 相容

未換 Code.gs 嘅旅團會回 `Unknown action: requestPasswordReset`。前端 `fpwErrorText()` 會顯示明確提示：「此旅團的 Apps Script 尚未支援忘記密碼…」而唔係籠統嘅連線錯誤；喺升級前，團長仍可用既有「用戶管理 → 🔑 重設密碼」處理。

## 6. 相關測試

- `node --test test/password-reset.test.mjs`：經真正 `doPost` 路由驗證完整流程、不洩漏帳號、雜湊、錯碼／過期／限速、舊碼作廢、提權欄位、中途停用降級、舊 Sheet 自動補表、發信故障旗標、前端中英字典／版本／proxy 一致性。
- `node test/api.test.mjs`：proxy 剷走身份欄位、未設 apikey 嘅旅團仍可用。
- `npm test`：全套回歸（含 `html-integrity`、`release-version`、`frontend-render-harness`、e2e）。
