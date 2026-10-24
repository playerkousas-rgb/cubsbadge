# 三個 BADGE 同系專案同步指示（2026-10-24）

本文件供童軍 `scoutbadge`、深資 `vsbadge`、樂行 `roverbadge` 各自的開發對話使用。**CUBS 合併並不代表其他三個 repository 或各旅團 Google 部署已更新。**

CUBS 參考來源：[cubsbadge/main](https://github.com/playerkousas-rgb/cubsbadge/tree/main)。請先讀下列共同驗收要求，再依自己支部的程式結構實作；不要整份覆蓋成幼童軍版本。

## 共同驗收要求

### 1. 接入資料只提供 API Key，不提供不可靠的 URL

- 旅系統的「顯示接入資料」選單改為「🔑 顯示 API KEY（交 ADMIN）」。
- `initializeSheets()`、`showApiKey()`、`showVercelEnv()`、`vercelEnvLines()`、`menuShowLinkCredentials()` 或本支部對應入口，統一只提供 `API Key = ...` 作為接入資料。
- 初始化可保留完成訊息、建表結果，以及本支部原有的預設旅團管理員首次登入／改密碼提示；不是要求刪除這些說明。
- 不顯示 `ScriptApp.getService().getUrl()`、`WEBAPP_URL` 舊快取或請求自行回報的部署網址；初始化的執行回傳物件亦不得帶出推算的 `scriptUrl`／`backend` 值。
- 不顯示未設定旅團編號的警告或 `TROOP_<旅團編號>_APIKEY` 佔位名稱。

### 2. 不要求旅團先設定編號或把 URL 貼入 GS

- 沒有旅團編號也必須能直接初始化、生成 API Key 或由選單查看 Key。
- 移除初始化時的旅團編號輸入提示；不要新增「設定旅團編號」選單。
- 不新增 `setBackendUrl`、貼部署 URL 的 GS 提示、本機網址設定、候選 URL 探測／自我核實等流程。
- 用戶流程維持：初始化生成／保留 API Key → 完成 Google 部署，在 Google 部署視窗取得 URL → 自己在原有 ADMIN FORM 填旅團編號、名稱、URL 和 API Key。
- 真正 URL 的來源是 Google 部署視窗，不是 GS 自動推算；不得恢復「開一次 /exec 就記啱」、部署 ID 長度可判別類型、快取／自報 URL 就代表「已核實」等說法。
- 只處理接入顯示及指南；不要因搜尋 `getUrl()` 而一併改寫內部驗票、登入或簽名協定。

### 3. 加入「系統介紹」

- 首頁新增「系統介紹」分頁，並在「新旅團部署」加入入口；交叉連結須正確切換選中的首頁分頁。
- 使用 CUBS 已有的通用「支部進度追蹤系統」圖，無須重新生成：
  - 公開網站圖檔：[`assets/system-introduction-zh-hant.webp`](https://github.com/playerkousas-rgb/cubsbadge/blob/main/assets/system-introduction-zh-hant.webp)
  - 原圖：[`docs/security-architecture.png`](https://github.com/playerkousas-rgb/cubsbadge/blob/main/docs/security-architecture.png)
- 對外圖檔放在會部署的 `assets/`；不要引用可能被 `.vercelignore` 排除的 `docs/`。支援手機、放大、下載；如用 WebP，本地預覽伺服器須提供 `image/webp`。
- 圖頂名稱維持「支部進度追蹤系統」，適用四個支部。圖片可保留繁中，旁邊補中英說明及圖片語言標示。
- 簡明說明：使用者 → 網站／伺服器轉接 → 本團 Apps Script → 本團 Google Sheet；Google 授權用途及權限較廣；程式的「任何人」入口設定不等於把 Sheet 公開分享；帳號密碼登入每次核實帳號及密碼，用戶自行設定系統密碼，首次登入更改臨時密碼。
- 公開介紹不要加入任何隱藏／保留帳號資訊，不要把 API Key 當作個人登入驗證。
- 保留安全邊界：私人 Sheet 不等於所有資料 API 自動安全。CUBS 已知部分資料讀取入口的登入／權限驗證仍待補強，這次沒有修復；各支部亦須先核實自己的狀態，不可把介紹圖當成獨立安全認證或宣稱所有讀取都已受登入保護。

### 4. 資料保全、版本與測試

- 現有 API Key、帳號、成員、YMIS、進度及舊 ID、其他徽章、活動履歷、備註、設定均須保留，不能重置、覆寫、重新編號或擅自遷移。
- 既有 Script Properties 的旅團編號／名稱及舊 URL 設定原樣保留；不再拿舊 URL 來顯示，也不要為這次 UI 修正刪掉既有屬性。
- 初始化可安全重跑；新裝只在 Key 不存在時生成，已有 Key 不得更換。
- 保留自己支部的綱要、評核權限、預設帳號及版本規則，不要套入幼童軍業務邏輯。
- 同步中英指南、下載參數、GS 版本／初始化標記及相關文件。
- 若移植 CUBS 的 Workspace URL 格式相容，只轉成相同部署 ID 的公開路徑；不代表修正錯 ID 或改變 Google 權限。不得藉正規化接受 HTTP、query、fragment、帳密或自訂連接埠。非 JSON 回應不能直接證明是錯誤／舊部署。
- 至少測試：三個不同的 Google 回報 URL 加舊快取仍不洩出任何 URL、所有接入顯示入口、新安裝無旅團編號可生成 Key、沒有編號／網址設定提示、重跑資料與 Key 不變、介紹分頁雙向切換、中英鍵完整、圖片及 Code.gs 下載不被部署忽略。
- 參考 CUBS 的 `test/credential-display.test.mjs`、`test/frontend-render-harness.mjs`、`test/html-integrity.test.mjs` 和 `docs/BACKEND_URL_DIAGNOSIS.md`；移植相應測試並跑本專案完整驗收。
- 完成後交代修改檔案、測試結果，以及是否已提交／合併／發佈。不要把 repository 修改當作旅團 Google Apps Script 已更新；本指示不要求直接操作線上 Google 部署。

## 可直接貼到三個對話的訊息

### 童軍 ScoutBadge

```text
請在童軍 scoutbadge 同步 CUBS 已合併的接入顯示及系統介紹修正。先讀 https://github.com/playerkousas-rgb/cubsbadge/blob/main/docs/SIBLING_BADGE_HANDOFF.md ，按共同驗收要求實作。重點：旅系統選單及 initializeSheets 等接入資料只顯示 API Key，不顯示自動取得／快取 URL；不要求設定旅團編號或貼 URL 到 GS。用戶在 Google 部署視窗取得 URL，再自己填 ADMIN FORM。加入「系統介紹」及部署教學入口，沿用通用附圖並補中英說明。保留童軍自己的綱要／權限／首次登入提示及全部現有資料、API Key，初始化可安全重跑；不要整份套用幼童軍程式。加入相應回歸測試，跑完整驗收後回報；今次只改 scoutbadge，不直接更新線上 Google 部署。
```

### 深資 Venture Scout Badge

```text
請在深資 vsbadge 同步 CUBS 已合併的接入顯示及系統介紹修正。先讀 https://github.com/playerkousas-rgb/cubsbadge/blob/main/docs/SIBLING_BADGE_HANDOFF.md ，按共同驗收要求實作。重點：旅系統選單及 initializeSheets 等接入資料只顯示 API Key，不顯示自動取得／快取 URL；不要求設定旅團編號或貼 URL 到 GS。用戶在 Google 部署視窗取得 URL，再自己填 ADMIN FORM。加入「系統介紹」及部署教學入口，沿用通用附圖並補中英說明。保留深資自己的綱要／權限／首次登入提示及全部現有資料、API Key，初始化可安全重跑；不要整份套用幼童軍程式。加入相應回歸測試，跑完整驗收後回報；今次只改 vsbadge，不直接更新線上 Google 部署。
```

### 樂行 Rover Badge

```text
請在樂行 roverbadge 同步 CUBS 已合併的接入顯示及系統介紹修正。先讀 https://github.com/playerkousas-rgb/cubsbadge/blob/main/docs/SIBLING_BADGE_HANDOFF.md ，按共同驗收要求實作。重點：旅系統選單及 initializeSheets 等接入資料只顯示 API Key，不顯示自動取得／快取 URL；不要求設定旅團編號或貼 URL 到 GS。用戶在 Google 部署視窗取得 URL，再自己填 ADMIN FORM。加入「系統介紹」及部署教學入口，沿用通用附圖並補中英說明。保留樂行自己的綱要／權限／首次登入提示及全部現有資料、API Key，初始化可安全重跑；不要整份套用幼童軍程式。加入相應回歸測試，跑完整驗收後回報；今次只改 roverbadge，不直接更新線上 Google 部署。
```
