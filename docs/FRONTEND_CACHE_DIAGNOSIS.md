# 首次載入橙色舊版、F5 後黃色：證據、修正與驗收邊界

本文件記錄 2026-10-25 的快取修正：前端 build `2026.10.25.1`；當時要求的 GS 為 `2026.10.24`，該次只修改前端，沒有修改 GS。

> 後續 2026-10-25 加入小隊職務更新時，Apps Script 已同步升至 GS `2026.10.25`。本文件下方的「只更新網站／GS 不用動」只描述先前的快取修正，不是目前發佈指示；現行部署方式以 [APP_ADMIN_WORKFLOW.md](../APP_ADMIN_WORKFLOW.md)、[LEADER_GUIDE.md](LEADER_GUIDE.md) 及 v6.0 變更紀錄第 12 節為準。

## 已確認的事實

1. 使用者確認是直接輸入／開啟 `https://cubsbadge.vercel.app/`，不是另一個拼法的網站。
2. 使用者兩張截圖不只是顏色不同：橙色頁顯示舊 v5.2 標題、2025 綱要、舊選單、舊 footer 及空旅團列表；黃色頁是 v6.0、2026 綱要、系統介紹／更新公告及兩個旅團。
3. 所以有不同版本的完整頁面被呈現，不能當成同一份 HTML 由 JavaScript 切換主題色。
4. 2026-10-24 獨立讀取正式站點，頁面為 v6.0，顯示現行綱要、系統介紹及旅團列表。GitHub 的 production deployment 狀態亦顯示 main `e3bc312` 發佈成功。
5. 目前原始碼沒有註冊 Service Worker；不能因此反推使用者瀏覽器必定沒有其他／歷史安裝的攔截來源。
6. Vercel 連接拒絕列出專案，且可列出的 team 為空，因此未能核實該連接帳戶下的 alias、實際 HTTP response headers 或 CDN 狀態。沒有讀取憑證值、變更環境變數或操作部署。

**尚未在使用者相同瀏覽器、設定及快取環境復現。** 不能僅憑截圖確定是 HTTP disk/memory cache、快取代理、瀏覽器歷史還原、外掛或其他來源。舊文件 v5.8.1 對「一定是快取、F5 一次後永久正常」的肯定已撤回。

## 目前程式的防護缺口

- 入口只有 `no-cache, must-revalidate`，沒有禁止儲存。新標頭不能保證已交到先前快取版本的瀏覽器。
- 未帶版本的自有 assets 使用一週快取及 `stale-while-revalidate`，不適合原地更新同名 JS。
- 沒有獨立的前端 build 核對；GS 版本核對不能判斷目前 HTML 是不是最新前端。
- 手動重新整理函式以新 query 取代整段 URL，會丟掉 Portal 參數。

## 本次防護修正

- `/`、`/index.html` 對 browser／CDN／Vercel edge 設 `no-store`，不僅要求重驗。
- 自有 assets 改為 `max-age=0, must-revalidate`，不使用 stale-while-revalidate；JS URL 帶前端 build，避免沿用上一版同名資源的快取鍵。
- `data/frontend-release.json` 是獨立前端 build 宣告；更新前端發佈時須同步 HTML 的 `cubsbadge-build` meta 與 JS query，測試會檢查一致性。
- `GET /api/frontend-version` 只回傳 app／build，對各層禁快取，不讀取旅團 registry、Sheet、API Key 或任何登入資料。
- 已載入新防護的頁面，在啟動、bfcache 恢復、返回分頁及恢復連線時核對同源前端 build。不同版本會以帶 `_frontend` 版本參數的 URL 更新，保留原本 query／hash。
- 每個瀏覽器分頁 session 對同一目標 build 最多自動更新一次；sessionStorage 不可用時，以 URL 參數防止相同目標循環。
- 有待寫進度、請求正在進行、回報傳送、履歷編輯、開啟的 modal 或輸入焦點時，不自動重新載入；待使用者返回安全狀態再核對。
- 不登出、不清除 localStorage、IndexedDB、CacheStorage、cookies 或待同步資料；不註冊 Service Worker、不加入全站快取清除標頭。
- 檢查失敗／離線／逾時時保持目前頁面可用，不重新整理或阻止登入。
- 手動重新載入的備援功能亦改為保留 Portal query 及 hash。

## 重要限制：不能隔空修復不含新程式的舊 HTML

若瀏覽器一直直接還原早期 v5.2 HTML，而那份 HTML 根本沒有版本檢查程式，新 JavaScript 不會自行執行。必須先成功取得一次新 HTML，這套防護才會運作；不能宣稱本補丁能在任何歷史快取環境消除第一次舊畫面。

`no-store` 亦不是瀏覽器資料清除指令，不能把新增 response header 當成已刪掉所有舊文件。若發佈後仍反覆載入 v5.2，需要在出現舊頁的當下檢查 DevTools Network：Document 的實際 URL、狀態、來源（disk/memory/service worker）、response headers 及版本；如需分享診斷，應刪去 cookies、Authorization、token 等敏感內容。不要提交未經清理的整份 HAR。

因此本輪可以確認「防護及模擬情境通過」，不等於已在使用者環境證明根因或完成正式站點回歸。

## 已完成驗收

- `npm test`：包含前端版本 endpoint、快取策略、版本一致性、自動更新一次、URL 保留、sessionStorage 不可用、延後更新、bfcache 事件、離線／逾時／異常回應及未儲存資料保全的回歸。
- `npm run check`：執行真實 inline script，測試已有 GS 配舊／空初始化標記仍為 current、不偽造初始化紀錄；亦驗證實際自動更新安全條件及手動 reload 保留參數。
- 真實 Chromium 本地預覽：首次及再次直接進入為黃色、旅團卡載入、沒有強制 RUN SCRIPT 紅色標籤、介紹中英切換及手機寬度無溢出，沒有 page error。
- Chromium 注入「**已有新防護的過時 HTML**」：自動一次切換到新黃色頁，query／hash 保留，不按 F5。這是受控故障注入，**不是原始 v5.2 使用者問題的實測重現**。
- Chromium 待寫進度情境：偵測新版本但不更新；安全狀態後只更新一次，localStorage 測試資料保留。

## 部署及 Sheet 初始化

這一輪只更新網站、版本 endpoint、靜態資源及指南，**不修改 `apps-script/Code.gs`，不用 RUN SCRIPT**。

- 旅團 GS 已是 `2026.10.24`：只部署網站，GS 不用動。
- 仍在舊 GS 的旅團：為了上一輪的 API Key 顯示修正，仍須更換 Code.gs 及部署新版本；已有正常 Sheet 不需只為版本標記重跑初始化。
- 新建 Sheet 首次使用：仍須 `initializeSheets()` 建表／建立預設帳號及 API Key。
- 本版 `initializeRequired:false`，版本狀態判定真正尊重此旗標；不擅自更新或偽造 Script Properties 的初始化紀錄。
