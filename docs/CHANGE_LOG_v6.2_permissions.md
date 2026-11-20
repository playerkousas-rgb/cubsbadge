# CubBadge 更新紀錄：授權勾選、角色誤降與登入可用性（GS 2026.11.20）

日期：2026-11-20
前端 build：`2026.11.20`　GS：`2026.11.20`

本版處理管理員回報的三個問題。**不動任何既有資料**：不重設、不改寫、不遷移用戶／成員／進度／活動履歷紀錄，不更換既有 API Key、部署 URL 或 Script Properties。

---

## 1. 「權限已設定為可勾選，但領袖登入後更新不到成員進度」

### 兩個疊加的根因

| # | 位置 | 舊行為 | 後果 |
|---|---|---|---|
| 1 | 前端「✅ 授權勾選」`toggleCanTick()` | 每次都送 `new_role:'member'` | 管理員為一位**領袖**開通勾選，該帳戶即刻由 `branch_leader`／`admin` 降為 `member` |
| 2 | 後端 `canUserTick()` | 只讀 `role`，**完全忽略** Users 表 `can_tick` 欄 | 就算 `can_tick=TRUE`，成員角色仍然過不到寫入閘門 → 個別授權等於無效 |
| 3 | 後端 `updatePermissions` / `upsertUser` | 請求冇 `new_role` 時照寫，`undefined` 令 role 欄變空白 | 任何只改 `can_tick`／`allowed_badges` 的請求都會「靜靜降級」（空白 role ≤ member） |

空白 role 亦解釋了回報②「冇改過密碼但登入不到」的一個可控成因：帳戶被降級後，忘記密碼（只寄 active、角色 ≥ 旅長、非超級管理員的帳戶）不再寄出重設碼。

### 修正

- **GS**：`canUserTick()` 改為「角色級別夠 **或** `can_tick === TRUE`」。授權勾選＝獨立的個人開關，與角色分離。
- **GS**：`save` / `saveOtherBadge` 閘門依原因給出不同訊息——無有效 token（「Token 無效或過期」）／有 token 但無權（提示「請聯絡旅長／管理員按『授權勾選』」），唔再把兩者混成「需領袖權限」。
- **GS**：`handleUpdateUserRole()` 重寫。`new_role`／`can_tick` **只在明確提供且有效時才寫**；無效角色直接報錯而唔會清空 role；回包帶最新 `role`／`can_tick`。
- **GS**：`handleLoad()` 回包新增 `me`（ymis／name／role／can_tick／allowed_badges／squad／squad_role），前端每次載入即時同步權限，管理員改完毋須對方重新登入。
- **前端**：新增 `canTickProgress()`（角色可勾 **或** `can_tick`），進度頁、批次勾選、日期修改、其他獎章等 16 個寫入入口全部改用它；`toggleCanTick()` 改為傳送**現有角色**，失敗會回滾並提示；改到自己時同步本機 session。
- **前端**：`applyServerMe()` 把伺服器最新權限套用到本機（有變更才重繪選單／提示），並保留本機 session。
- **前端**：成員而獲得授權時，進度頁改為顯示綠色「✅ 已獲授權勾選」提示，而唔再顯示「唯讀」。

### 迴歸保證

`test/tick-permission.test.mjs`（新增）＋ `test/frontend-render-harness.mjs`（加強）：

- 成員 `can_tick=TRUE` → `save` / `saveOtherBadge` 成功；`can_tick=FALSE` → 被拒且不留下紀錄；
- `updatePermissions` / 只送 `can_tick` 的 `updateUserRole` → **角色不變**；
- 無效角色 → 被拒且 role／can_tick 原封不動；
- `load` 的 `me` 反映即時權限；
- 授權勾選**不會**附帶審批、用戶管理、活動履歷編輯權限（成員原有申報功能保留）；
- 前端授權勾選只送 `updateUserRole` 一次，且 `new_role` 等於該帳戶現有角色。

---

## 2. 「冇改過密碼但登入不到管理員帳號，亦冇改密碼／忘記密碼入口」

### 核實結果（逐項）

| 檢查 | 結果 |
|---|---|
| 登入頁有冇管理員專用分頁？ | **冇**。只有「領袖／管理員（Email）」及「成員（YMIS）」兩個分頁；管理員用哪個也可以，但**舊版 YMIS 分頁把輸入截短至 10 字**，貼上電郵等於一定失敗 |
| 忘記密碼入口是否兩個分頁都有？ | **舊版只在領袖分頁顯示**。切去成員分頁時入口被收走，管理員若慣用 YMIS 分頁便完全見不到 |
| 登入後可否自行改密碼？ | **舊版冇**。只有「用戶管理 → 🔑 重設密碼」（由另一位領袖操作）或登出後用忘記密碼 |
| 密碼被改過？ | 後端冇任何自動改密碼流程；`handleChangePassword` 拒絕 super_admin／新舊相同／舊密碼錯誤。帳戶被鎖或降級才是常見成因 |
| 連續錯誤 | 5 次失敗鎖 15 分鐘，鎖定期內**正確密碼亦回同一句「帳號或密碼錯誤」**（安全設計，避免洩漏帳號存在），但舊版冇提示「已鎖定」 |
| 忘記密碼條件 | 只寄 active、角色 ≥ 旅長、非 super_admin、已登記電郵且有密碼的帳戶。**被降為成員後就不再收到重設碼**（與問題 1 的降級 bug 互相關聯） |

結論：**冇證據顯示系統曾自動改動用戶密碼**；「登入不到」可由 ① 被授權勾選／權限編輯降為成員、② 5 次錯誤鎖定、③ 用 YMIS 分頁輸入電郵被截短、④ 忘記密碼入口在該分頁不存在 四個原因造成。以上均已修正或加上提示。

### 修正

- 兩個登入分頁都**接受 YMIS 或 Email**，輸入框上限由 10 放寬至 100，標籤改為「YMIS（10 位）或 Email」。
- 兩個分頁都**恆常顯示「🔑 忘記密碼？」**（不再切換分頁時收走）。
- 登入頁新增說明：管理員／領袖請用登記電郵；連續 5 次錯誤會鎖定 15 分鐘；成員忘記密碼由領袖在「用戶管理」重設。
- 登入後頁首新增 **🔑 更改密碼**：輸入現有密碼＋新密碼（4–8 位）兩次，走 `changePassword`；成功後**保留目前 session**（其他裝置的舊 session 照常失效）。
- 內部編號登入不分大小寫（`l0001` → `L0001`）。

---

## 3. 「輸入服務紀錄，本系統見到，但 SCOUTBOOK／CUBBOOK 見不到」

**歸屬：CUBBOOK／SCOUTBOOK 的設計限制，不是本專案漏送，也不是資料遺失。** 本專案的紀錄完好保存在旅團自己的 Sheet；問題 1／2 的修正不影響這部分。

已核實（CUBBOOK `ALLOWED_ACTIONS`／`api/cubbadge.js`，SCOUTBOOK `api/scoutbadge.js` 同構）：

- CUBBOOK 只向 CubBadge 讀取 **`progress`／`flatProgress`／`otherBadges`**（以及待批的 `pendingRequests`），而且只接受四個動作：`login`、`logout`、`load`、`submitPending`。其他動作一律 `403 FORBIDDEN_WRITE`。
- CUBBOOK 只會把「完成申請」轉為 pending 交回 CubBadge；**不會**把 CubBadge 的活動履歷（服務／活動／訓練班）轉發去任何兄弟支部。
- BOOK 內的露營／遠足／訓練班／服務紀錄是**該 BOOK 自己本地的紀錄**，與 CubBadge 的「活動履歷」是兩套互不相通的資料。
- CubBadge 另有舊版「服務紀錄」工作表（`SRV_<timestamp>`，11 欄），只經 `getServiceRecords` 讀取，不在 `load` 或簽章請求的白名單內；新紀錄一律寫入「活動履歷」（12 欄）。

所以：在 CubBadge「活動履歷」新增的服務紀錄，**設計上不會出現在 SCOUTBOOK／CUBBOOK**。若希望同步，須在 BOOK 專案新增讀取活動履歷的介面（屬 BOOK 的 scope 決定，非本專案可單方面改動）；本專案只確保 `progress`／`flatProgress`／`otherBadges` 與 pending 申報格式穩定。詳見 [ECOSYSTEM.md](ECOSYSTEM.md)。

---

## 部署（旅團）

1. 下載最新 `apps-script/Code.gs`（GS `2026.11.20`）→ 右鍵以純文字編輯器開啟 → 全選複製 → Apps Script 全選貼上 → 儲存。
2. 部署 → 管理部署 → 編輯 → 版本選「**新版本**」→ 部署（**URL 不變**）。
3. **毋須**執行 `initializeSheets()`；本版沒有新增工作表或欄位，亦不讀寫任何既有資料以外的內容。
4. 已部署 `2026.11.02+` 的旅團毋須重新授權電郵；如從更舊版本升級，先執行一次 `testPasswordResetMail()` 授權發信（此函式不寫任何工作表）。
5. **保留**原有 API Key、部署 URL、Script Properties；不要重新初始化或匯入資料。

前端會顯示「最新更新公告｜2026-11-20」，並核對旅團實際部署的 GS 版本；舊 GS 會顯示明確的升級提示而非「後端斷線」。
