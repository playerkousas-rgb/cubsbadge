# CHANGE LOG v5.9 — 對齊 Rover Badge：回報意見＋版號統一＋超管零痕跡

> 本次對齊 roverbadge 嘅四組改動（64e6072 / 68c9674 / 60c967b / 99a92d5），
> 並按「超管痕跡零命中」原則做足：工作表、審計、指令碼屬性、前端、公開 API 回應、
> 分發俾旅團嘅 Code.gs，搜帳號名／代號／機制字眼全部零命中。
>
> **功能變數契約不變**（APP ADMIN 層）：`SUPER_KEY` + `TROOP_<id>_BACKEND / _APIKEY / _NAME`，
> 全部照舊由 APP ADMIN 喺 Vercel 設定；旅團唔使（亦唔會）設定任何功能變數。

## 1. 🐛💬 回報意見（Scout Admin 統一回報 widget）

對齊 rover v5.1：問題回報／意見回饋直達 scout-admin 後台（統一回報格式 v1，
見 scout-admin `SCOUT_ADMIN.md`），來源系統／欄位／接收端全部統一。

- `index.html` 載入 `https://scout-admin-blue.vercel.app/widget.js`（`data-app="幼童軍進度追蹤"`）。
- 3 個入口（同一個 modal，`openScoutReport()` 開啟，已選旅團自動預填旅團號）：
  1. 首頁 welcome-nav 第四個按鈕（金色外框，同三個分頁按鈕區分）；
  2. 登入頁連結列；
  3. 登入後 header 常駐（語言掣同排）。
- widget 載入失敗（離線／被擋）→ fallback 開獨立回報頁 `report.html?app=幼童軍進度追蹤`。
- widget 自生嘅右下 FAB 隱藏（`#scoutw-fab{display:none}`），用常駐按鈕代替，唔會重複。
- **UX 原則**：用戶只負責「求救」——提交後只知已收到；任何內部處理／解決細節
  唔會喺本 APP 出現（同 roverbadge 一致）。

## 2. 🔢 版號統一：全 APP = v5.9

舊版有 v5.2／v5.8 殘留喺不同位置。現全數統一（`index.html` 19 處：`<title>`／動態標題 JS／
home tagline／登入 h1／footer／ SETUP 下載字樣／版本紀錄等）＋ `package.json` = `5.9.0`。
`test/html-integrity.test.mjs` 會守住：任何非 v5.9 版本字樣再出現，測試即紅。

## 3. 🧹 超管零痕跡（本次做足嘅部分）

| 面 | 改動 |
|---|---|
| Tokens 表（SHEET 登入 LOG） | 保留帳號 session 改**無狀態 token**（`cbs-super-v1-` 前綴＋HMAC(用途字串, 本節點 API_KEY)）：登入唔寫 Tokens 行、唔寫審計、唔寫 `SUPER_ADMIN_LAST_LOGIN`；`removeSuperAdminTokenRows()` 初始化時靜音清走舊版寫入嘅 session 行 |
| 操作紀錄／審計 | `sheetActor()` 一律中性化：保留帳號（含舊標籤「SHEEP 系統管理員」、舊代號）→ `system`；`purgeSuperAdminLabels()` 把舊部署寫過嘅識別字全部改成 `system`（零命中，唔係只改部分） |
| Users／成員名單 | 保留帳號照舊虛擬帳號；`getUser()` 回傳嘅 session 身份改中性：`ymis`＝中性代號、顯示名「系統管理員」、電郵空白（登入回應搜唔到帳號名） |
| 錯誤回應 | 改密碼→`PASSWORD_MANAGED_CENTRALLY`＋「此帳號密碼由中央管理…」；停用保留帳號→「不能停用此系統帳號」（唔再用字面帳號名做判斷）；proxy 拒 `action=superLogin`→`UNSUPPORTED_ACTION`＋「不支援此操作」 |
| editor ui | `initializeSheets` 彈窗／回傳（`{success,apiKey,scriptUrl,troopId,troopName}`）、`showApiKey` 彈窗、`showVercelEnv` 對話框：全部只講旅團 3 樣，刪 SUPER_KEY／超管段落 |
| 公開 API | leaf `health`／`diagnose`、`/api/health`（envContract 只剩 3 樣 boolean）、`/api/ecosystem`、`/api/troops`（`_note`／`_hint`）：零 SUPER_KEY／零機制字眼 |
| 前端 | 部署地圖、SETUP 三步驟、404 診斷提示、Leader Guide（刪「維護帳戶（隱藏）」章節）：零超管字眼 |
| 分發 Code.gs | 旅團可下載呢個檔，所以做最嚴：`sheep` 只剩 2 行身份常量（登入識別＋舊標籤常數）；「超管／維護帳戶／SHEEP 顯示名」零命中；註釋統一用「保留帳號」 |

### 3a. 關門後救援通道（對齊 rover 68c9674）

關門（`ALLOW_LOCAL_LOGIN=false`）後：

- 保留帳號 token（`cbs-super-v1-`）經**閘門例外**照通行：`load`、`getAllUsers`、
  `resetPassword` 等——誤閂鎖死嘅旅團仲救得到（載入資料、讀名單、重設密碼）。
- **新增** `doPost` token 路徑 `setLocalLogin`（角色 ≥ 小隊長／60）：保留帳號可以用自己
  嘅 token 重開掣，解除鎖死。舊嘅 sig 路徑（上游控制下游）完全唔變。
- 防繞（`test/troop_link.test.mjs` 新增兩支測試守住）：
  - 偽造前綴 token（HMAC 錯）→ 當普通關門拒絕；
  - 一般帳號 token 關門後照拒（閘唔會因救援通道而鬆）；
  - 一般帳號帶假 `super_ticket` → 唔可以繞閘（票據例外只限保留帳號）。
- 全程 SHEET 零痕跡：Tokens 冇行、審計係 `system`、指令碼屬性冇登入時間戳、
  任何工作表搜帳號名／電郵／舊代號零命中。

## 4. 🚪 關門制唔對下游顯示

`index.html` 無 `ALLOW_LOCAL_LOGIN`／無關門狀態 UI（下游旅團面向介面完全唔見關門制；
integrity 測試守住）。

## 5. ⚠️ 非官方聲明（footer 第 4 行，中英）

> ⚠️ 非官方聲明：本系統為獨立開發的非官方工具，並非香港童軍總會官方產品，與總會並無隸屬或贊助關係。
>
> ⚠️ Unofficial notice: This is an independently developed unofficial tool. It is not an official
> product of the Scout Association of Hong Kong and has no affiliation with or sponsorship from
> the Association.

footer 第三行移除「香港童軍總會」官方連結（只留健康檢查）；表單區嘅官方表格下載
（PT/68、金紫荊紀錄冊）係功能性連結，保留。

## 6. 部署清單（APP ADMIN）

1. Vercel：重新部署（`index.html`＋`api/`）。功能變數**唔使改**（契約不變）。
2. 各 leaf（可選但建議）：旅團跑一次 `initializeSheets()`——靜音清走舊版殘留
   （Tokens 舊 session 行、審計舊標籤、指令碼屬性遺留）。清完 SHEET 搜帳號名零命中。
3. 驗收（全部自動化：`npm test`）：
   - `ymis_parse`／`api`（33）／`ecosystem`（55，含無狀態 session、零痕跡、中性審計、
     `initializeSheets` 回傳／彈窗靜音測試）；
   - `troop_link`（12，**新增**：關門後救援全流程＋SHEET 零痕跡、防繞三連）；
   - `integrity`（22，**新檔** `test/html-integrity.test.mjs`：版號統一、超管零痕跡、
     關門唔顯示下游、非官方聲明、widget 完整）；
   - `e2e`。

## 7. 已知取捨（照舊，unchanged）

- leaf 無法分辨「APP 打嚟」定「旅團自己打嚟」（旅團有自己嘅 apikey）；但旅團本來就有
  該 Sheet 嘅完全控制權，唔會俾佢多任何權力。
- 保留帳號密碼（`SUPER_KEY`）只存在 Vercel；leaf 永不持有、永不顯示、永不回顯。
