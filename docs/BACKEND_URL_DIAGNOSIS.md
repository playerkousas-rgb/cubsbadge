# 部署 /exec 與「旅系統 → 顯示 BACKEND」不一致：調查及處理紀錄

調查及 CUBS 修正日期：2026-10-24；CUBS GS 版本：2026.10.24。

> **最終決定：只提供 API Key；旅團編號在 ADMIN FORM 填寫，不顯示未能確認的部署 URL。**
> 不新增要求用戶貼網址／設定 BACKEND 的步驟。先前建議的手動 URL 設定方案沒有採用。

## 1. 原因

**原本選單把 `ScriptApp.getService().getUrl()` 當成領袖剛剛選定的部署 URL，但兩者不是同一個資料來源。**

- Google「部署 → 管理部署」視窗顯示的是該視窗中選定的部署入口。
- Sheet 選單執行的是一般函式；程式沒有接收那個部署的 ID，也沒有讀取部署視窗的選擇。
- 同一個 Script 專案可以有多個部署。不能假設 `getUrl()` 就是剛新增／剛選定的那一個。
- 原本初始化也自動讀取，與選單／舊快取未必相同，所以可能出現第三條網址。

因此，即使領袖「剛部署完成，立即查看」，程式仍未能保證兩條網址相同；不能歸咎於領袖未等夠時間，也不能要求領袖辨認內部部署 ID。

沒有取得這次實際測試的部署清單及執行紀錄，所以尚不能判定另一個 ID 在 Google 內部屬於舊部署、另一個部署還是異常回傳。這不影響停止顯示不可靠 URL 的處理決定。

## 2. 原始碼證據及同系範圍

調查時查閱 `playerkousas-rgb/scoutbadge/main`：commit `c05eed33764718500b5885becc930f2e86f922a1`。
`apps-script/Code.gs:2890–2905` 的 `menuShowLinkCredentials()`，第 2892 行直接讀：

```javascript
try { url = ScriptApp.getService().getUrl() || ''; }
catch (e) { url = ''; }
```

之後直接當作 BACKEND 顯示。初始化第 513 行也使用相同取值方法。

[童軍版調查時的原始碼](https://github.com/playerkousas-rgb/scoutbadge/blob/c05eed33764718500b5885becc930f2e86f922a1/apps-script/Code.gs#L2890-L2905)

調查時，深資版 `vsbadge/main` 第 1971 行、樂行版 `roverbadge/main` 第 2374 行亦有相同直接取值寫法。
另外，童軍版第 2021、2050、2093 行的內部驗票／連線診斷也使用該取值；這是另一個可能的身分比對風險，本次沒有修改那些專案或登入協定。

**本輪僅修改 CUBS 工作區，沒有修改童軍、深資、樂行 repository 或其 Google 部署。**

## 3. 撤回早前不可靠方案（已從 CUBS 顯示流程移除）

下列說法不是可靠保證，不能再用來指示用戶：

- ID 56 字元就是 HEAD、74 字元就是正式部署：ID 長度不能證明部署類型或有效性。
- 在 doGet/doPost 內叫 `getUrl()` 就必然得到實際請求入口：不能依賴這個假設。
- 開一次 `/exec` 後就永遠記啱：若來源錯，自動寫入 `WEBAPP_URL` 也會錯；其他請求亦可能覆寫快取。
- `selfUrl` 自報 URL 就是獨立核實：它仍讀回同一來源，屬循環確認。
- 存在 `WEBAPP_URL` 或顯示「✅ 已核實」就可收貨：先前程式只因格式合格便標示已核實，不能證明是領袖選定的部署。

曾以真實 CUBS 程式及本地 mock 重現：目標為 A、`getUrl()` 回 B 時，舊方案把 B 寫入快取，再將 B 標示為已核實。這證明舊方案對此情境缺乏防護，不是對 Google 內部部署機制的實測。

## 4. CUBS 實際處理（GS 2026.10.24）

| 位置 | 處理 |
|---|---|
| `initializeSheets()` 彈窗 | 顯示初始化結果及現有 API Key，不提示輸入旅團編號、不顯示自動部署 URL |
| `initializeSheets()` 執行回傳值 | 移除 `scriptUrl`，避免在執行結果出現另一條錯網址 |
| `showApiKey()`／`showVercelEnv()`／`vercelEnvLines()` | 只提供同一隻 API Key，不依賴旅團編號、不提供 BACKEND 值 |
| Sheet 選單 | 改稱「🔑 顯示 API KEY（交 ADMIN）」；不再提供自動驗證 BACKEND 的選單 |
| 舊 URL 驗證選單相容函式 | 只提示 Google 部署視窗才是網址來源；不顯示網址、不發請求、不聲稱已核實 |
| `doGet`／`doPost` | 移除自動記錄 `WEBAPP_URL` 及 `selfUrl` 回報路由 |
| 舊 URL 快取 | 不再讀取來顯示；不擅自刪改既有設定 |
| 前端及文件 | 中英部署說明及下載版本同步更新，不新增貼網址到 GS 的設定步驟 |

正式部署網址仍由 Google 部署視窗提供。原有 APP ADMIN 登記及環境變數契約、API Key、業務資料、登入／簽名協定不變。既有內部驗票邏輯並未因本次介面修正而重寫，不能將「不再顯示網址」當成所有 URL 身分比對風險都已修正。

## 5. 回歸驗收

`test/credential-display.test.mjs` 覆蓋：

- Google 可能回傳三個不同 URL、同時存在舊 URL 快取時，各顯示位置都不顯示／回傳任何部署 URL。
- 初始化實際彈窗及執行回傳值，確實提供原有 API Key，沒有 `scriptUrl`。
- 顯示功能不讀取 Google service URL、不探測候選網址、不要求用戶貼網址。
- 新安裝沒有旅團編號亦可直接生成 API Key；初始化及選單無任何編號／網址設定提示，重跑保留同一 Key。
- 普通 HTTP 請求不改寫 URL 快取；舊 `selfUrl` 不再回傳網址。
- 新選單標示 API KEY，沒有自動驗證或手動 BACKEND 設定步驟；舊選單相容函式也不顯示網址。
- 重複初始化／查看保留 API Key、已有業務紀錄、旅團設定及舊快取原值。

測試使用本地假資料，沒有讀取用戶的線上資料或修改 Google 部署。部署後仍需以更新過的實際 Sheet 介面確認顯示行為。
