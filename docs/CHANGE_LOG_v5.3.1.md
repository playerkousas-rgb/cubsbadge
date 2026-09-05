# 🧭 v5.3.1 變更報告（cubsbadge）

> 對齊 SCOUTBADGE 的更新：團長鎖死一位、領袖免 YMIS 電郵登入、初始密碼 1234 ＋ 首次登入強制改密、權限收緊、批量開戶。
>
> 本報告說明：哪些項目在本次工作分支 `arena/01a06f88-cubsbadge` 上**已經存在**、哪些是**本次新增／對齊**，以及相應測試與文件。

---

## 1. 🔒 團長鎖死一位（Strict Single Group Leader Lock）

- 後端（`apps-script/Code.gs`）
  - ✅ 新增 `getActiveGroupLeader()`：偵測全團狀態為 `active` 的團長（換人時以 `findActiveGroupLeader(excludeYmis)` 排除自己，避免自鎖）。
  - ✅ 統一錯誤訊息 `gslLockMsg(name)`：`團長只能有一位，全團已有現任團長（陳大文）。如需更換，請先將現任團長轉為其他角色。`（只顯示姓名，不外洩內部 `Lxxxx`）。
  - ✅ 硬鎖執行點：
    - 單一新帳戶開立（`createUserRecord`，供 `addUser` 使用）：若 `role=group_leader` 且全團已有活躍團長 → 拒絕。
    - 批量開戶（`handleBulkAddUsers`）：依序逐列鎖定，同批第二個團長列也會被拒。
    - 更改角色（`handleUpdateUserRole`）：升他人為團長時鎖定；換任流程（先降現任、再升新人）可正常運作。
  - ✅ 防申請篡改：`APPLY_ROLES` 只收 `member`／`branch_leader`；審批（`handleReviewApplication`）即使有人手改 Sheet 寫入 `group_leader`／`admin` 亦退回 `member`。
- 前端（`index.html`）
  - ✅ 「👥 用戶管理」角色下拉：當全團已有活躍團長時，「團長」選項自動 **disabled** 並標註 `團長（已有現任：XXX）`（`gsl_opt_taken`）。
  - ✅ 將現任（唯一）團長**降職**或**停用**時彈出二次確認（`gsl_demote_warn`／`gsl_deactivate_warn`）。
  - ✅ 補齊此前引用但字典遺漏的 GSL 中／英文字串（`gsl_only_one`、`gsl_demote_warn`、`gsl_deactivate_warn`、`gsl_opt_taken`）。
  - 批量開戶由後端逐列鎖定，前端已有 `gsl_only_one` 預檢提示。

> 本分支**已存在**（未改動/僅對齊）：團長選項禁用前的錯誤提示、後端 `findActiveGroupLeader`。本次新增上述公開命名 `getActiveGroupLeader`／`gslLockMsg`，並把訊息對齊報告範例。

## 2. 📧 領袖免 YMIS、用電郵登入（Leader without YMIS & Email Login）

- ✅ 申請（`handleApply`）：領袖身份忽略 YMIS、Email 必填；審批時 `generateLeaderId()` 自動編配。
- ✅ **順序內部編號** `L0001、L0002…`：新增 `getNextLeaderId()`，掃描 `Users` 與 `Applications` 取最大編號 +1，取代原先時間戳隨機編號（`generateLeaderId()` 改為呼叫它）。
- ✅ 電郵登入：`handleLogin` 已支援以電郵（或舊 10 位 YMIS）登入領袖帳戶（本分支已存在，本次補測試確認）。
- ✅ 批量開戶（`handleBulkAddUsers`）：領袖列可留空 `ymis`、填 Email，自動編配 `Lxxxx`。
- ✅ 前端用戶列表只顯示 member 的 YMIS，不顯示內部 `(Lxxxx)`（本分支已存在）。
- 文件：`docs/BULK_ONBOARD.md`、`docs/LEADER_GUIDE.md`、`data/members_template.csv` 與 CSV 下載範本同步加入領袖免填 YMIS 的示範列。

## 3. 🔑 申請批核密碼預設 1234 ＋ 首次登入強制改密

- ✅ 新增常數 `DEFAULT_TEMP_PASSWORD='1234'`、`MIN_PASSWORD_LEN=4`、`MAX_PASSWORD_LEN=128`。
- ✅ `generateTemporaryPassword()` 回傳 `1234`（審批開戶、`resetPassword` 重設為一次性密碼皆用同一預設）。
- ✅ 首次登入強制改密機制（`force_change_password` 欄）本分支已存在；本次把新密碼下限由 6 → 4 位，前後端（`handleChangePassword`、前端強制改密視窗、相關中／英 i18n）同步。
- ✅ 申請表介面新增提示：*💡 申請經批核後，初始密碼預設為 1234；首次登入時系統會強制要求設定新密碼。*

## 4. 🛡️ 權限收緊（Permission Tightening）

- ✅ `CAN_MANAGE_ROLES`（本分支已存在）：支部領袖 `branch_leader` 只能開立／管理 `member`；本次補測試確認不可越權開立 `admin`／`group_leader`／`branch_leader`。
- ✅ `createUserRecord`／`handleUpdateUserRole` 開戶與改角色皆以 `canManageUser` 執行角色驗證。

## 5. 🧪 測試套件與文件

- ✅ 新增 Node mock 環境 `test/mock-gas.mjs`：以記憶體試算表載入 `apps-script/Code.gs`。
- ✅ 新增後端邏輯 e2e `test/e2e.mjs`（`npm run test:e2e`），涵蓋：
  - 【10d】團長鎖死一位：硬鎖、顯示姓名、換人流程；
  - 【10e】領袖免 YMIS 電郵登入：順序 L 編號、電郵登入＋強制改密、批量免 YMIS、舊 YMIS 帳戶相容；
  - 【10f】權限收緊與批量開戶逐列鎖定；
  - 【10g】初始密碼 1234、改密下限 4 位、改密後不再強制。
  - **28 項全數通過（0 失敗）**。
- ✅ 既有 `npm test`（`test/ymis_parse.test.js`）仍全數通過。
- ✅ 文件：`docs/BULK_ONBOARD.md`、`docs/LEADER_GUIDE.md`、`data/members_template.csv`、CSV 下載範本（`index.html`）已同步更新。

---

## 註

- 本分支 `arena/01a06f88-cubsbadge` 在承接 scoutbadge v5.3 前，已內建「審批開戶流程、`force_change_password` 欄位、領袖免 YMIS 電郵登入、支部領袖權限收緊」等多項；本次工作把 report 內具名而本分支仍缺失的部分補齊（順序 `Lxxxx`、預設密碼 `1234`＋最小 4 位、`getActiveGroupLeader`／`gslLockMsg`、`bulkAddUsers`、前端團長選項禁用＋二次確認、i18n、文件與測試）。
- `assets/batch-onboard/Code.gs`（後端直接寫 Sheet 的備用腳本）仍以 10 位 YMIS 為準；如需它支援「領袖留空 YMIS」可另行調整，日常批量開戶走主流程（前端 → `addUser`／`bulkAddUsers`）已支援。
