# 三個 BADGE 兄弟同類問題審計（ScoutBadge / VSbadge / RoverBadge）

日期：2026-11-20　審計者：CubBadge 對話（PR #43）
方法：clone `main`（`--depth 50`）靜態閱讀 `apps-script/Code.gs`、`index.html`、`api/*badge.js`；**未執行兄弟 repo 的測試**。行號以 2026-11-20 `main` 為準，日後可能漂移，請以函式名為錨。

CubBadge 已修的三個問題（PR #43）：
①「授權勾選」對成員完全無效 ＋ 為領袖開通勾選時把角色降為成員；
②登入頁 YMIS 分頁截斷 Email／該分頁冇忘記密碼入口／登入後冇改密碼入口；
③活動履歷不同步去 SCOUTBOOK／CUBBOOK（BOOK 端設計）。

---

## 0. 一覽

| | ScoutBadge | VSbadge | RoverBadge |
|---|---|---|---|
| `can_tick` 是否有被寫入閘門使用 | **沒有**（只睇角色） | 有（角色 **且** `can_tick===true`） | 有（`canTickUser_`，角色 **且** `can_tick`） |
| 「授權勾選」對成員是否有效 | **無效**（UI 仍顯示按鈕） | 不可用（刻意：成員永不能勾） | **無效**（UI 仍顯示按鈕） |
| 「收回勾選」對領袖是否有效 | **無效**（閘門只睇角色） | 有效 | 有效（有測試） |
| `save`／`saveOtherBadge` 是否有勾選權限檢查 | **完全沒有**（任何有效 token 都可寫） | 有 | 有 |
| 前端「授權勾選」會否降級角色 | **會**（硬送 `new_role:'member'`；改小隊職務亦會） | 不會（傳現有 role） | 不會（v8.8 已修） |
| 後端 `handleUpdateUserRole` 會否清空 role | 不會（`if(newRole)` 有保護，但 `allowed_badges` 預設有瑕疵） | role 有保護；**`can_tick` 會被清空** | **role 與 `can_tick` 都會被清空** |
| 登入分頁截斷 Email（`maxlength=10`） | **有** | **有** | **有** |
| 登入後「更改密碼」入口 | **沒有**（只有強制改密） | 有（header 🔑 改密碼） | **沒有**（只有強制改密） |
| 忘記密碼入口 | 有（兩個分頁都見） | 有（YMIS 或電郵） | 有 |
| `load` 回傳 `me`（權限即時生效） | 沒有 | 沒有 | 沒有 |
| 活動履歷可否同步去 BOOK | 不可（BOOK 只讀 progress／otherBadges） | 不可（`privacy: progress-only`） | 不可（同上） |

> 結論：**ScoutBadge 有與 CubBadge 同類（而且更嚴重）的問題；VSbadge 只有輕微隱患；RoverBadge 是三個之中最正確的參考模型，但有一個與 CubBadge 一模一樣的潛在降級 bug。**

---

## 1. ScoutBadge（GS 6.6.0）— 需要修，優先級最高

### 證據

| 位置 | 內容 | 影響 |
|---|---|---|
| `apps-script/Code.gs:649` | `canUserTick(r){ return CAN_TICK_ROLES.indexOf(r)>=0; }` | Users 表 `can_tick` 欄完全沒有被任何閘門使用 |
| `apps-script/Code.gs:1879-1890` | `save`／`saveOtherBadge` 只檢查 apikey／token 是否有效，**冇角色、冇 can_tick** | 任何已登入帳戶（包括成員）都可寫入進度 |
| `apps-script/Code.gs:1414-1415` | 簽章路徑 `save`／`saveOtherBadge` 同樣冇權限檢查 | 上游 sig 亦可任意寫 |
| `apps-script/Code.gs:3102` | `handleUpdateUserRole`；`if(newRole)` 有保護，但 `allowed_badges` 預設用 `newRole==='member'?'':'*'`（`newRole` 為 undefined 時會寫 `*`） | 只改權限的請求會意外開放全部徽章範圍 |
| `index.html:5722` | `toggleCanTick(tid,ct)` → `{new_role:'member', can_tick:ct}` | **為領袖開通勾選＝降為成員** |
| `index.html:5710` | `editSquad` → `{new_role:'member', can_tick:false, squad, squad_role}` | **改小隊職務＝降為成員＋收回勾選** |
| `index.html:5713` | `updateUserRole` → `{new_role:nr, can_tick:true}` | 降為成員時仍寫 `can_tick=TRUE`（修好閘門後無害） |
| `index.html:5026` | 每一行用戶（含成員）都渲染「授權勾選」按鈕 | UI 承諾一個永遠做不到的操作 |
| `index.html:615` / `2559` | 登入輸入 `maxlength=10`，成員分頁 `i.maxLength=10`；`Code.gs:2535` 接受 Email | 貼電郵被剪短 → 永遠「帳號或密碼錯誤」 |
| `Code.gs:2535` | `/^L\d+/.test(loginId)`（無 `i`） | `l0001` 無法登入 |
| `index.html:646-647` | header 只有「回報」及「登出」 | 登入後不能自行改密碼（`changePassword` action 已存在） |

### 建議（可貼上的對話）

```text
你在 /scoutbadge（GS 6.6.0）。用戶回報「權限已設定為可勾選，但領袖仍更新不到成員進度」。已審計確認本專案有同類 bug，請逐項核實並修正，並附迴歸測試。

【1｜勾選權限完全無效（最嚴重）】
- apps-script/Code.gs:649 canUserTick() 只睇角色，Users 表 can_tick 欄從未被任何寫入閘門使用。
- Code.gs:1879-1890 的 save／saveOtherBadge 只驗證 apikey／token 有效性，連角色都冇檢查：任何已登入帳戶（包括成員）都可以寫入進度。簽章路徑 1414-1415 同樣。
要求：
 a. 新增 canTickUser_(u) = u 存在 && 角色屬 CAN_TICK_ROLES && u.can_tick===true；canUserTick(role) 保留但只作角色判斷。
 b. 所有寫入／審批閘門改用 canTickUser_：save、saveOtherBadge、addServiceRecord 一類紀錄寫入、deleteLogRecord、reviewRequest、reviewLogRequest。
 c. 錯誤要分開講：無有效 token →「Token 無效或過期」；有 token 但無權 →「此帳號未有勾選進度權限，請聯絡旅長在『用戶管理』按『授權勾選』」。
 d. 保留「冇 token 但有有效 apikey」的舊生態路徑行為不變。

【2｜前端「授權勾選」會降級角色】
- index.html:5722 toggleCanTick 硬送 new_role:'member' → 為領袖開通勾選即降為成員。
- index.html:5710 editSquad 硬送 new_role:'member', can_tick:false → 改小隊職務即降級並收回勾選。
要求：兩處都只送 can_tick（其餘欄位原樣帶回或省略），後端不得改寫角色；失敗要有提示並重新載入清單。

【3｜後端 handleUpdateUserRole（Code.gs:3102）】
- role 已用 if(newRole) 保護，但 allowed_badges 預設 `newRole==='member'?'':'*'`，newRole 為 undefined 時會寫 '*'。
要求：role／can_tick／allowed_badges 只在「明確提供且有效」時才寫；無效角色直接報錯；只有明確改角色時才補 allowed_badges 預設；回包帶最新 role／can_tick。

【4｜權限改完即時生效】
- handleLoad 回包新增 me:{scoutId,name,role,can_tick,allowed_badges}；前端載入資料時同步 currentUser 並寫回 localStorage session（有變更才重繪選單及提示）。

【5｜登入可用性】
- index.html:615 及 switchLoginType（2559）把輸入截短至 10 字，但後端（Code.gs:2535）接受 Email → 貼電郵永遠失敗。
要求：兩個分頁都接受「SCOUT ID 或 Email」、maxLength=100、標籤講清楚；L 編號登入大小寫兼容（2535 的 /^L\d+/ 加 i 並以正規化大寫查表）。
- 登入後冇更改密碼入口：header 加「🔑 更改密碼」，沿用既有 changePassword action（需現有密碼＋新密碼，成功後保留本機 token、撤銷其他裝置 session）。

【驗收】
- 新增 test/tick-permission.test.js（用 test/mock-gas.js 或既有 gasvm）覆蓋：
  成員 can_tick=TRUE → save 成功並寫入列；can_tick=FALSE → 被拒且不寫任何列；
  撤銷領袖 can_tick 後 → save／reviewRequest 被拒，但可繼續查看；
  updatePermissions 只帶 can_tick／allowed_badges → 角色不變；
  無效角色 → 被拒且 role／can_tick 原封不動；
  load 回傳 me 且反映最新權限。
- npm test 全綠；GS 版本號、前端 build、release 檔同步；更新 docs/CHANGE_LOG_*.md。
【硬性限制】不改寫／遷移任何既有資料，不更換 API Key、部署 URL 或 Script Properties；不改 WORKFLOW 的資料保全規則。
```

---

## 2. VSbadge（GS v9.6）— 模型正確，只需補漏

### 證據

| 位置 | 內容 | 影響 |
|---|---|---|
| `Code.gs:1305/1311/1315/1325/2406/2456` | `canUserTick(user.role) && user.can_tick===true` | ✔ 授權／收回**有效**（與 RoverBadge 同一模型） |
| `Code.gs:1523-1540` | `const tick=canUserTick(role) && isTrue(canTick);` 然後**無條件** `setValue(tick)` | 冇帶 `can_tick` 的請求（舊客戶端／上游 `updatePermissions`）會**靜靜收回勾選** |
| `Code.gs:1526-1527` | `const role=String(newRole||rec.user.role)` | ✔ 不會降級 |
| `index.html:5211` | `const tickButton=u.role==='member'?'':…` | ✔ 成員不顯示授權按鈕（一致） |
| `index.html:628` / `2434` | 登入 `maxlength=10`；成員分頁 `maxLength=10`；`Code.gs:1396` 接受 Email | 貼電郵被剪短 |
| `index.html:652` | header「🔑 改密碼」 | ✔ 已有，登入後可自行改密碼 |
| `index.html:5829` | `savePermissions` 對成員亦送 `can_tick:true` | 後端會算成 false（角色閘），但 UI 的「⚙️ 權限」對成員含意要講清楚 |

### 建議（可貼上的對話）

```text
你在 /vsbadge（GS v9.6）。審計結論：你的勾選模型（角色 且 can_tick===true）已正確，寫入閘門 1305/1311/1315/1325/2406/2456 都有 && user.can_tick===true，所以「授權／收回勾選」有效；成員永不獲得勾選屬刻意設計。請只補以下幾點，並附測試。

【1｜handleUpdateUserRole（Code.gs:1523）會靜靜清空 can_tick】
現在 `const tick=canUserTick(role) && isTrue(canTick);` 之後無條件寫入 → 任何冇帶 can_tick 的請求（舊客戶端、上游 updatePermissions、只改 allowed_badges）會把勾選權收回。
要求：只在 canTick!==undefined && canTick!==null 時才寫；role 已有 `newRole||rec.user.role` 保護，補上「無效角色直接報錯」與回包 {role,can_tick}。

【2｜登入分頁截斷 Email】
index.html:628 及 switchLoginType（2434）在成員分頁把 maxLength 設為 10，但後端（Code.gs:1396 getUser||getUserByEmail）接受 Email → 貼電郵被剪短必定失敗。
要求：兩個分頁都接受「YMIS 或 Email」、maxLength=100、標籤寫清楚；L 編號登入大小寫兼容。

【3｜可選但建議：權限改完即時生效】
handleLoad 回包新增 me:{ymis,name,role,can_tick,allowed_badges}；前端載入時同步 currentUser 並寫回 session（有變更才重繪）。

【4｜文案一致性】
若「⚙️ 權限」modal 對成員開放：要明確講「成員只會得到查看範圍，勾選權仍屬領袖」；或對成員隱藏該按鈕。

【驗收】新增/擴充測試：只帶 allowed_badges 的 updatePermissions 不改角色亦不清空 can_tick；成員 can_tick=TRUE 仍不可 save；撤銷領袖 can_tick 後 save 被拒。npm test 全綠；版本號同步；更新 CHANGE_LOG。
【硬性限制】不改寫／遷移任何既有資料，不更換 API Key、部署 URL 或 Script Properties。
```

---

## 3. RoverBadge（GS 5.4.0）— 最接近正確，但有一個與 CubBadge 相同的潛在降級 bug

### 證據

| 位置 | 內容 | 影響 |
|---|---|---|
| `Code.gs:790` | `canTickUser_(u)=u && canUserTick(u.role) && u.can_tick===true` | ✔ 參考模型；`tests/can-tick.test.mjs` 已把「撤銷後領袖不可勾選／審批」寫成規則 |
| `Code.gs:910/935/1556/1567/1571/1577/2872/3353/3389/3409/3454/3533` | 一律用 `canTickUser_` | ✔ 一致 |
| `Code.gs:1855-1885` | `sheet.getRange(i+1,4).setValue(newRole);` 與 `setValue(canTick)` **無條件寫** | 任何只帶 `allowed_badges` 的 `updatePermissions`（路由 597／1592／1596 會把 `body.new_role` 原樣傳入）→ **role 欄清空＝降為 member**，同時清空 `can_tick` |
| `index.html:6063` | `toggleCanTick(...,currentRole)`（v8.8 已修） | ✔ 不會降級 |
| `index.html:5764` | 每行（含 member）都顯示「授權勾選」 | 對 member 永遠無效（`canTickUser_` 要角色）→ 誤導 |
| `index.html:551` / `2425` | 登入 `maxlength=10`；成員分頁 `maxLength=10`；`Code.gs:2164` 接受 Email（且 `L` 已用 `/i`） | 貼電郵被剪短 |
| `index.html:577` | header 只有「登出」 | 登入後不能自行改密碼（只有強制改密） |

### 建議（可貼上的對話）

```text
你在 /roverbadge（GS 5.4.0）。審計結論：你的 can_tick 模型（canTickUser_ = 角色 且 can_tick）與 tests/can-tick.test.mjs 都正確，撤銷對領袖即時有效；前端 toggleCanTick 已傳現有角色（v8.8）。請修以下幾項並附測試。

【1｜handleUpdateUserRole（Code.gs:1855）會清空 role 與 can_tick（與 CubBadge 用戶回報同一個 bug）】
現時無條件 `setValue(newRole)` 及 `setValue(canTick)`；路由 597（簽章／上游）與 1592/1596 會把 body.new_role／body.can_tick 原樣傳入，任何只改 allowed_badges 的 updatePermissions 會把 role 寫成空白（＝降為 member）並清空勾選。
要求：
 a. role 只在「明確提供且有效」時才寫；無效角色直接報錯（不可寫空白）。
 b. can_tick 只在明確提供時才寫（undefined／null 不動）。
 c. allowed_badges 只在提供時寫，或明確改角色時才補角色預設。
 d. 回包 {success,role,can_tick} 讓前端同步。

【2｜members 行的「授權勾選」按鈕是死按鈕】
index.html:5764 對所有用戶行渲染授權／收回按鈕，但 canTickUser_ 要求角色屬 CAN_TICK_ROLES → member 永遠無法勾選，按下去只會寫入無用的 can_tick=TRUE。
要求：member 行隱藏此按鈕（或停用並加 title 說明「成員只可查看」）；如產品決定要容許成員被授權，才改 canTickUser_ 的規則並更新測試，二者只能選一。

【3｜登入分頁截斷 Email】
index.html:551 及 switchLoginType（2425）成員分頁 maxLength=10，而後端（2164）接受 Email → 貼電郵被剪短。
要求：兩個分頁都接受「YMIS 或 Email」、maxLength=100；確認 L 編號大小寫（2164 已用 /i，但要確認 getUser 查表時亦不分大小寫）。

【4｜登入後更改密碼】
header（index.html:577 附近）加「🔑 更改密碼」，沿用既有 changePassword（需現有密碼＋新密碼，保留本機 token、其他 session 失效）。

【驗收】擴充 tests/can-tick.test.mjs 或新增測試：只帶 allowed_badges 的 updatePermissions 不改 role、不清空 can_tick；無效角色被拒且原值不動；member 不顯示授權按鈕（DOM 測試）。npm test 全綠；版本號四處同步；更新 CHANGE_LOG。
【硬性限制】不改寫／遷移任何既有資料，不更換 API Key、部署 URL 或 Script Properties。
```

---

## 4. 跨 repo 的語意決策（需要你拍板）

現時四個 BADGE 對 `can_tick` 的定義不一致：

| | 規則 | 結果 |
|---|---|---|
| CubBadge（本 PR） | 角色 **或** `can_tick===true` | 成員可被授權勾選；但**領袖被「收回勾選」後仍可勾** |
| VSbadge / RoverBadge | 角色 **且** `can_tick===true` | 收回即時生效；成員永遠不可勾 |
| ScoutBadge | 只看角色（`can_tick` 無作用） | 授權與收回都無效 |

RoverBadge 的規則有測試把「撤銷後領袖不可勾選／審批」寫成明確產品決定，建議以此為家族標準。若要把 CubBadge 對齊成「角色 且 `can_tick`」，必須同時處理向後兼容，否則可能再次出現「領袖突然勾唔到」：

- 讀取時把**空白** `can_tick` 視為 `TRUE`（只認明確 `FALSE` 為收回），這樣既有領袖帳戶不會一夜失去勾選權；
- 成員在 AND 模型下永遠不可勾（若要保留成員可被授權，就屬明確的產品例外，需在 UI 講清楚）；
- 前端 `canTickProgress()`／`canCurrentUserTickItem()` 與測試同步改（`test/tick-permission.test.mjs`、`frontend-render-harness`）。

在未拍板前，CubBadge 維持 PR #43 的 OR 模型是安全的（不會誤鎖任何帳戶），只是與「收回勾選」按鈕的承諾不完全一致。

---

## 5. 第③項（服務紀錄不同步）在三個兄弟的結論

同 CubBadge 一樣：**不是 BADGE 端的 bug，是 BOOK 端設計**。

- `VSBOOK/api/vsbadge.js:16`：`ALLOWED_ACTIONS = new Set(['login','logout','load','submitPending'])`，只讀 `progress`／`flatProgress`／`otherBadges`，並標明 `privacy: 'progress-only'`。
- `ROVERBOOK/api/roverbadge.js:23`：同一組動作白名單，只讀 `progress`／`otherBadges`。
- `SCOUTBOOK/api/scoutbadge.js`、`CUBSBOOK/api/cubbadge.js`：同構。

所以三個 BADGE 的活動履歷（服務／活動／訓練班）也都不會出現在各自的 BOOK；BOOK 自己新增的同類紀錄亦不會回傳 BADGE。要跨系統顯示，只能在 BOOK 端新增讀取活動履歷的介面（各自 repo 的範圍決定），BADGE 端毋須改動。

---

## 6. 建議次序

1. 合併並部署 CubBadge PR #43（GS 2026.11.20、前端 build 2026.11.20）。
2. **ScoutBadge**（同類 bug 最嚴重，且 `save` 連角色都冇檢查 —— 屬安全問題，優先處理）。
3. **RoverBadge**（潛在降級 bug；死按鈕；登入可用性）。
4. **VSbadge**（只需補 `can_tick` 被清空、登入截斷、可選 `me`）。
5. 回頭決定是否把 CubBadge 對齊成「角色 且 `can_tick`」（見第 4 節）。
