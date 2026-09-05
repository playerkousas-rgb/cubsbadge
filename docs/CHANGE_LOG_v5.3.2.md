# 🧭 v5.3.2 變更報告（cubsbadge）

> 修復 SCOUTBADGE 用戶回報的同類問題：①YMIS／Email 唯一性、②用戶管理看不到成員（不能刪除／修改）、③領袖可在用戶管理直接設定成員密碼。
>
> 覆蓋 `apps-script/Code.gs` 並重新部署即可（毋須 initializeSheets()、無新工作表、無新欄位）；前端 `index.html` 一併更新。
> 本報告分支：`arena/01a0707d-cubsbadge`。

---

## 0. 🔍 問題重現（修復前以 mock 後端實測）

| # | 問題 | 修復前實測結果 |
|---|------|----------------|
| 1 | 停用帳號後，同一 YMIS／Email 可再開新帳號 | ❌ 同 YMIS+Email 開了第二個帳號，Users 表出現 2 列同 YMIS |
| 2a | status 欄空白的成員（舊資料） | ❌ `getAllUsers` 完全看不到 → 不能改角色、不能停用 |
| 2b | 純成員（只在成員名單、無帳號） | ❌ 用戶管理完全看不到 → 不能修改、不能刪除 |
| 3 | 有重複列時重設密碼 | ❌ 密碼寫進**inactive 那列**（第一個匹配），成員用新密碼仍登入不到 |

三個問題在 cubsbadge v5.3.1 **全部存在**（與 SCOUTBADGE 同源），已於 v5.3.2 修復。

## 1. 🔒 YMIS／Email 全團唯一（包括已停用帳號）

- 後端新增 `getUsersTable()`（按**表頭名稱**解析 Users 表）＋ `findUserRowByYmis`／`findUserRowByEmail`（掃描**全部列、任何狀態**）＋ `findDuplicateAccountError()`（統一錯誤訊息）。
- 檢查點全覆蓋：`apply`（申請）、`addUser`／`createUserRecord`（單個開戶）、`bulkAddUsers`（批量，同批重複亦逐列被拒）、`reviewApplication`（審批開戶）、`addMember`（加入成員名單）。
- **純成員開通**：YMIS 已在成員名單（純成員、無帳號）時，`addUser`／批量開戶填密碼＝為該成員**開通帳號**（成員名單不會重複加入），不會再像舊版般產生重複名單列。
- 舊帳號已停用時不再允許重用，提示：**「此 YMIS 曾開立帳號（現已停用）。請在用戶管理按「🔄 重新啟用」該帳號，或改用其他 YMIS」**。
- `getNextLeaderId()` 掃描全表（含停用），內部 `L0001…` 編號永不重用。
- 前端「新增成員」彈窗提示同步更新（YMIS／Email 全團唯一）。

## 2. 👥 用戶管理不再漏成員（可刪除、可修改）

- **表頭解析**：`getUser`／`getUserByEmail`／`getAllUsers`／`handleLogin`／`handleUpdateUserRole`／`handleDeactivateUser`／`findActiveGroupLeader`／`getMembers`／`removeSuperAdminRows` 全部改用 `getUsersTable()`——人手調動 Google Sheet 欄位也不會讀錯欄。
- **status 空白＝active**（`isActiveStatus()`）：舊資料 status 留空的成員立即在用戶管理出現，可改角色／權限／停用。
- **純成員合併列出**：`getAllUsers()` 把只存在「成員名單」而無帳號的成員合併回傳（`member_only:true`、`password_set:false`），前端顯示「👤 純成員（無帳號）」標籤，提供 ✏️ 改資料／🗑️ 刪除／🔑 開通帳號（設定密碼）。
- **已停用帳號**：`getAllUsers(include_inactive:true)` 一併回傳；前端清單頂部「顯示已停用 (n)」開關，已停用帳號提供 🔄 重新啟用／✏️ 改資料。預設只回 active，**舊客戶端完全相容**。
- 新開戶時 `ensureUserHeaders()` 自動補齊缺漏的標準表頭（status／last_login／allowed_badges／squad／squad_role／force_change_password），不會再開出「status 寫不進欄位 → 隱形帳號」。

## 3. 🔑 領袖可直接設定成員密碼（用戶管理）

- `resetPassword` 支援 `new_password`：**領袖可直接輸入新密碼**告訴成員（成員忘記密碼又沒有登記電郵的最佳解法）；**留空＝預設 1234**。首次登入一律強制改密。
- 權限收緊：只可為「自己可管理角色」的用戶重設（`canManageUser`：支部領袖→成員；團長→領袖＋成員；admin→全部；sheep→全部）。以前任何領袖可重設任何人的密碼（包括 admin），已修正。
- **純成員開通**：對 member_only 成員設定密碼時，後端即場建立 Users 帳號（角色 member）並寫入密碼——從此「無帳號純成員」一鍵變「可登入帳號」。
- 重複列防寫錯：匹配時優先 active 列；已停用帳號直接回「請先重新啟用」。
- 前端：🔑 按鈕改為彈出「重設密碼」小視窗（可輸入新密碼／留空 1234），完成後仍顯示一次性密碼視窗供抄下／複製。

## 4. 🔄 新 action（後端）

| action | 說明 | 權限 |
|--------|------|------|
| `reactivateUser` | 重新啟用已停用帳號：status→active、密碼重設 1234＋強制改密、補回成員名單、套用團長唯一鎖 | 領袖（≥40）＋`canManageUser` |
| `updateMemberEntry` | 改姓名／小隊，同步 Users＋成員名單 | 領袖（≥40） |
| `deleteMemberEntry` | 移出成員名單；有活躍帳號則一併停用（YMIS 仍不可重用） | 領袖（≥40）＋`canManageUser` |

`getAllUsers` 新增 `include_inactive` 參數；`resetPassword` 新增 `new_password` 參數——**全部向下相容**（舊參數照舊）。

## 5. 🧪 測試

- `test/e2e.mjs` 新增 41 項（總數 28 → **69 全部通過**）：
  - 【11a】唯一性：停用後重用被拒（YMIS／Email）、apply 被拒、批量同批重複被拒、addMember 重複被拒、純成員開通帳號（名單不重複）；
  - 【11b】可見性：status 空白可見可操作、純成員合併列出、include_inactive、舊客戶端相容；
  - 【11c】密碼：自訂新密碼登入成功、留空＝1234、太短被拒、支部領袖越權被拒、純成員開通、重複列寫入 active 列、停用帳號須先啟用；
  - 【11d】重新啟用：補回成員名單、1234 登入＋強制改密、重複啟用被拒、團長唯一鎖；
  - 【11e】改資料／刪除：兩表同步、刪除後停用＋YMIS 不可重用、純成員刪除後可重新加入。
- `npm test`（YMIS PDF 解析）維持全數通過。
- 前端 `<script>` 通過 `node --check` 語法檢查。

## 6. 📄 文件

- `docs/LEADER_GUIDE.md`：用戶管理章節重寫（新按鈕、唯一性說明）。
- `docs/BULK_ONBOARD.md`：注意事項加入唯一性說明。
- 本文件 `docs/CHANGE_LOG_v5.3.2.md`。

## 7. ⬆️ 升級步驟

1. Apps Script：貼上最新 `apps-script/Code.gs` → 部署 → 管理部署 → 編輯 → 新版本 → 部署（URL 不變）。
2. 前端：部署最新 `index.html`（Vercel／任何靜態 hosting）。
3. 毋須 `initializeSheets()`、毋須改 Sheet；舊資料（status 空白、重複列）會被自動相容處理。
4. 建議升級後在用戶管理按「顯示已停用」檢查一次是否有歷史重複列（有也不影響操作，系統會一律寫入 active 列）。
