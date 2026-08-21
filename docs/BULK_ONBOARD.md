# 批量開戶（Bulk Onboarding）- 幼童軍版

一次過為整團開立多名成員 / 帳號，不用逐個填表，**全部在前端完成**。

## 開戶方式定位

| 方式 | 定位 | 說明 |
|---|---|---|
| ① 領袖前端上傳 YMIS 自訂報表 PDF（APP 內「📥 批量開戶」） | **整團批量開戶主路（最推薦）** | 在 YMIS 匯出「自訂報表」PDF → 上載（可輸密碼）→ 自動讀出編號/姓名/電郵 → 預覽 → 一次過開戶 |
| ② 領袖前端上傳批量範本 CSV / Excel（APP 內「📥 批量開戶」） | 批量開戶（推薦，日常） | 下載範本 → 前端上傳 → APP 轉 JSON 寫入後端 |
| ③ 領袖前端「➕ 新增成員/帳號」 | 單個開戶 | APP 內「👥 用戶管理」逐個新增 |
| ④ 後端 Sheet 直接寫（本文件 Apps Script） | **進階／備用，日常不建議** | 特殊情況或無前端權限時使用 |

> 設計原則：所有開戶盡量在前端完成（全前端控制）。方法④僅作備用。

## 流程總覽

```
YMIS 自訂報表 PDF ──► 前端解密讀取 ──► 預覽確認 ──► 寫入我們的 Sheet
      （或：下載範本 CSV ──► 填寫 ──► 前端上傳 ──► APP 轉 JSON ──► 寫入我們的 Sheet）
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

## 方法一：YMIS 自訂報表 PDF 匯入（最推薦，整團一次過）

1. 在 YMIS 匯出「自訂報表」PDF，欄位次序必須為：**童軍成員編號 → 中文姓名 → 電郵地址**。
2. 領袖登入 APP → 「👥 用戶管理」→ 按 **📥 批量開戶**。
3. （如有）輸入 PDF 密碼 → **📄 上載 YMIS PDF 報表**。PDF 在瀏覽器內解密，不會上傳伺服器。
4. 系統自動讀出成員並顯示**匯入預覽**（可即場修改編號/姓名/電郵、勾選要開戶的人）。
5. 設定預設小隊、預設角色、初始密碼（留空＝只加入成員）→ 按 **🚀 確認批量開戶**。
6. 每筆依序呼叫後端 `addUser`（有密碼）／`addMember`（無密碼），進度即時顯示。

> 完整教學（含 PDF 有密碼、欄位設定、常見問題）：見 [`docs/YMIS_EXPORT.md`](YMIS_EXPORT.md)。
> 解析器為 [`assets/ymis-parse.js`](../assets/ymis-parse.js)（純前端，支援多頁報表、中英雙行表頭、密碼 PDF）。

## 方法二：在 APP 內直接上傳 CSV / Excel（手機都做到）

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

## 方法三：Google Sheets + Apps Script（符合「SAMPLE → JSON → 寫入 SHEET」）

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
