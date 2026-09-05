# 批量開戶（Bulk Onboarding）- 幼童軍版

一次過為整團開立多名成員 / 帳號，不用逐個填表，**全部在前端完成**。

> **v5.3.1 提醒（對齊 ScoutBadge）**
> - 申請／開戶批核後的**初始臨時密碼一律預設為 `1234`**；首次登入 APP 會強制要求設定至少 4 位的新私人密碼後才可使用。
> - **領袖可留空 `ymis`**（只填姓名＋電郵），系統自動編配內部序號 `L0001、L0002…`，領袖用電郵＋密碼登入。
> - **團長全團只可有一位**：若全團已有活躍團長，重複開立 group_leader 的列會被拒絕並顯示現任團長姓名（前端預覽會即時標紅衝突列）。
> - **支部領袖**只能開立／管理 member，不可越權開立 admin / group_leader / branch_leader。

## 三種開戶方式定位

| 方式 | 定位 | 說明 |
|---|---|---|
| ① 後端 Sheet 直接寫（本文件 Apps Script） | **進階／備用，日常不建議** | 特殊情況或無前端權限時使用 |
| ② 領袖前端「➕ 新增成員/帳號」 | 單個開戶 | APP 內「👥 用戶管理」逐個新增 |
| ③ 領袖前端上傳批量範本（APP 內「📥 批量開戶」） | 批量開戶（自行整理名單） | 下載 Excel/CSV 範本 → 前端上傳 → APP 轉 JSON 寫入後端 |
| ④ 領袖前端上載 **YMIS 自訂報表 PDF**（APP 內「📥 批量開戶」） | **批量開戶主路（最推薦）** | YMIS 匯出 PDF → 前端解析 → 預覽確認 → 寫入後端 |

> 設計原則：所有開戶盡量在前端完成（全前端控制）。方法①僅作備用。

## 流程總覽

```
YMIS 自訂報表 PDF ─► 前端 pdf.js 解析 ─► 預覽/修改 ─┐
下載範本 Excel/CSV ─► 填寫 ─► 前端上傳 ───────────┼─► APP 轉 JSON ──► 寫入我們的 Sheet
貼上 JSON 陣列 ───────────────────────────────┘
```

「我們的 Sheet」即 app 後端所用的 Google Sheet，帳號存放在名為 **`Users`** 的工作表，
其欄位結構與 app 後端完全一致（新版 16 欄）：

```
ymis, name, email, role, password_hash, branch, can_tick, auth_by,
auth_date, created_at, last_login, status, allowed_badges, squad, squad_role, force_change_password
```

- `branch` 一律為 `cub`（幼童軍支部標記）；小隊存於 `squad` 欄。
- 有填 `password` 的成員：`password_hash` 以 SHA-256 儲存，`force_change_password=TRUE`，首次登入 APP 會要求自行設定新密碼。
- 純成員（無密碼）：status=active 但無法登入，進度仍由領袖記錄。

## 方法一：上載 YMIS「自訂報表」PDF（最快，推薦）

適合開學季一次過為全團開戶，唔使自己重新打名單。

1. 在 YMIS 匯出「自訂報表」，欄位次序**必須**為：**童軍成員編號 → 中文姓名 → 電郵地址**。
   （詳細步驟見 [`docs/YMIS_EXPORT.md`](YMIS_EXPORT.md)）
2. 領袖登入 APP → 「👥 用戶管理」→ **📥 批量開戶**。
3. 如 PDF 有密碼，先在 **「PDF 密碼（如有）」** 欄輸入，再按 **📄 上載 YMIS PDF 報表**。
   - PDF 用 `pdf.js` **在瀏覽器內**解密與解析，**不會上傳到任何伺服器**，密碼亦不儲存。
   - 讀不到 PDF？可把報表文字複製，貼到「貼上文字」框，按 **🔍 解析貼上的文字**。
4. 檢查 **匯入預覽** 表格：可逐列修改 YMIS／姓名／電郵、剔選要開的成員；
   已存在的 YMIS 會標示「⚠️ 已存在」並自動取消勾選；編號不足 10 位可按「🔢 編號補足10位」。
5. 設定 **預設小隊 / 預設角色 / 初始密碼**（初始密碼留空＝只加入純成員，不可登入）。
6. 按 **🚀 確認批量開戶**，逐筆顯示成功／略過／失敗。

解析程式為 [`assets/ymis-parse.js`](../assets/ymis-parse.js)，會自動略過抬頭、欄名、頁碼、
列印日期等非資料行，並處理中文姓名被 PDF 拆字、長電郵折行、多頁報表等情況。
單元測試：`node test/ymis_parse.test.js`（測試資料全為假資料）。

## 方法二：在 APP 內直接上傳 Excel / CSV（自行整理名單）

1. 領袖登入 APP → 進入「👥 用戶管理」。
2. 按 **📥 批量開戶** → **⬇️ 下載成員範本 Excel**（`data/members_template.xlsx`，含「成員開戶」＋「填寫說明」兩個工作表）或 **CSV 版**（`data/members_template.csv`）。
3. 在 Excel / Google Sheets 打開，填寫每位成員的資料。
4. 回到對話框，按 **📥 上傳填好的 Excel / CSV**（支援 `.xlsx` / `.xls` / `.csv` 直接上傳，唔使再另存 CSV），系統逐筆開戶並顯示進度：
   - 有填 `password` → 開立可登入帳號（後端 `addUser`，首次登入強制改密碼）。
   - 只填 `ymis` + `name` → 只加入成員（後端 `addMember`，不可登入）。
5. 亦可把 JSON 陣列貼到文字框，按 **🚀 由 JSON 批量開戶**。

> 前端 Excel 解析在瀏覽器完成（SheetJS），轉出與 CSV 相同的 JSON 後仍呼叫後端既有的 `addUser`／`addMember`，**後端 Code.gs 毋須因 Excel 上傳而更新**。若旅團後端過舊、批量開戶回傳「Unknown action」，才需要貼上最新 Code.gs → 執行 initializeSheets() → 重新部署。

### 範本欄位（CSV）

| 欄位 | 說明 |
|---|---|
| ymis | 10 位數字（必填，作為帳號） |
| name | 姓名（必填） |
| email | 電郵（領袖/家長登入用，建議填） |
| squad | 小隊名稱（例如 紅隊） |
| squad_role | member / 隊長 / 副隊長 |
| role | member / branch_leader / group_leader / admin |
| can_tick | true / false（可否勾選進度，領袖用） |
| password | 有填則開立可登入帳號（首次登入強制改密） |
| note | 備註（僅提醒用，不寫入 Users 工作表） |

## 方法三：Google Sheets + Apps Script（進階／備用，符合「SAMPLE → JSON → 寫入 SHEET」）

適合直接在 Google Sheets 操作，資料在試算表內轉 JSON 並直接寫入我們的 Sheet。

1. 在 Google Sheets 新建試算表。
2. **檔案 > 匯入 > 上載 > 選取本機 CSV**，選 `data/members_template.csv`。
3. 填寫資料。
4. **擴充套件 > Apps Script**，把 [`assets/batch-onboard/Code.gs`](../assets/batch-onboard/Code.gs) 的內容貼上並儲存。
5. 修改檔首 `CONFIG`：
   - `MAIN_SHEET_ID`：我們的 Sheet 的 ID（直接寫入時需要，出現在網址 `/d/.../` 之間）。
   - `APIKEY`：與 app 登入相同的 apikey（用「推送後端」時需要）。
   - `BACKEND_URL`：你 app 的 doPost 部署網址（用「推送後端」時需要）。
6. 回到試算表，重新整理，出現 **批量開戶** 選單：
   - **✍️ 直接寫入主資料表**：直接 append 到我們的 Sheet 的 `Users` 工作表（依 ymis 跳過重複）。
   - **📤 轉JSON並推送後端**：逐列 POST 到 app 後端 `addMember` / `addUser`。
   - **📝 預覽JSON**：先檢查將轉出的 JSON。

### 全新 Sheet 也可以！（自動建表）

直接寫入支援**全新、完全空白的 Sheet**：若 `Users` 工作表不存在或沒有 `ymis` 表頭，
會自動建立標準 16 欄表頭。密碼以 SHA-256 雜湊儲存，與 app 後端登入機制一致。

> 提示：若想呢份 Sheet 完全由 app 使用（含進度追蹤、操作紀錄等其他工作表），
> 請先執行 app 後端的 `initializeSheets()` 一次性建立所有工作表。

## 注意

- YMIS 必須為 10 位數字，否則該列會被忽略。
- 已存在的 YMIS 會被跳過（不覆蓋）。
- 領袖帳號（role≠member）不會出現在進度名單；純成員會。
- 「重設密碼 / 停用帳號 / 操作紀錄 / 審批歷史」同樣在 APP「用戶管理」頁完成。
- 批量操作建議先以小量（2–3 筆）測試，確認無誤再全團匯入。
- 本文件及範本內的編號／姓名／電郵（例如 `1234560001`、`陳大文`、`chan@example.org`）全部為**示範假資料**，
  真實名單只會在領袖自己的瀏覽器內處理，並寫入你旅團自己的 Google Sheet。
