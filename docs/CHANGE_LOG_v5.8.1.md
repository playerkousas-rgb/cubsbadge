# CHANGE LOG v5.8.1 — 幼童軍黃色主題＋預覽旅團列表修復

> 本次只改前端 UI 顏色、Vercel 快取標頭、開發預覽（devserver）及 registry 開發兼容。
> **不改** `apps-script/Code.gs`、**不改**功能變數契約（4 樣）、**不改**任何 API 行為（生產環境）。

## 1. 🎨 主題色改為幼童軍黃色

回報：「不知什麼時候變成了橙色」。舊主色 `#FFC107`（琥珀色，偏橙）與香港童軍總會
幼童軍支部代表色不符。

- 總會《通用規條》6.9.2(b)：**幼童軍團旗底色為黃色**（小童軍=橙色、童軍=綠色、樂行=藍色）。
- 新主色（`index.html` `:root`）：
  | 變數 | 舊（琥珀/橙） | 新（幼童軍黃） |
  |---|---|---|
  | `--maroon`（主色） | `#FFC107` | `#FFD60A` |
  | `--maroon-dark`（懸停/漸層深） | `#FF8F00` | `#F2B705` |
  | `--maroon-light`（淺底） | `#FFF8E1` | `#FFF7CF` |
  | `--gold` | `#FFD700` | `#FFE23D` |
  | `--gold-dark` | `#FFC107` | `#FFC400` |
- `<meta name="theme-color">` 同步改為 `#FFD60A`。
- 深棕金文字 `#8B5A00`（標題／連結）保留——同制服棕/綠色調配黃底。
- `--orange`（`#FD7E14`）保留，只用於語意警告（toast warning、本地暫存章、待批修改標記）。

## 2. 📍 旅團列表「看不到」修復

回報：「還是連旅團帳戶列表也看不到，上上次更新 UI 時弄壞的」。

排查結論：
- 旅團清單自 v5.5 功能變數契約起**只來自 `/api/troops`（= Vercel 功能變數 `TROOP_*`）**，
  唔再讀 `data/troops.json`、冇內置 URL fallback（安全設計：部署 URL 唔入前端）。
- 生產站（cubsbadge.vercel.app）新瀏覽器實測**正常列出 0082**；
  用戶機睇唔到＝**瀏覽器快取咗舊版 index.html**（舊版用 `t.backend` 過濾，
  而 390cee5 之後 API 只回 `connected`，舊前端過濾到零 → 「暫無旅團資料」）。
- 沙盒預覽（devserver）從來冇 `TROOP_*` 功能變數 → 列表必然空白。

修復（唔改安全契約）：
1. **`vercel.json`**：`/` 同 `/index.html` 加 `Cache-Control: no-cache, must-revalidate`——
   用戶瀏覽器以後唔會再食舊版頁面（舊版請硬式重新整理一次）。
2. **`test/devserver.mjs`（沙盒預覽專用，唔會部署）**：未設 `TROOP_0082_BACKEND` 時
   自動啟用「內置 0082 預覽旅團」——用 `test/mock-gas.mjs` 喺記憶體執行 `apps-script/Code.gs`
   （跑 `initializeSheets()` 生成 API Key），並以功能變數契約 4 樣對齊：
   `TROOP_0082_BACKEND`（指向 127.0.0.1 mock）/ `TROOP_0082_APIKEY`（mock 生成）/
   `TROOP_0082_NAME=82旅` / `SUPER_KEY`（預覽值）。
   預覽帳號（密碼一律 1234）：`admin@example.com`（管理員）、`leader@troop82.hk`（旅長 陳大文）、
   `1234560001`–`1234560004`（王小一/李小二/張小三/王小明，紅隊/藍隊）。
   設定咗真實 `TROOP_0082_BACKEND` 就完全唔會啟動 mock。
3. **`api/_lib/registry.js`** `getTroopConfig()`：改用同一條 `isValidGasUrl()` 規則
   （生產照舊只認 `https://script.google.com/.../exec`；**非生產**環境容許 localhost mock，
   令 devserver 預覽可以行真實 proxy 流程）。生產行為零改動（Vercel 上 `VERCEL_ENV=production`）。

## 3. 自測

- `npm test` 全綠：YMIS 解析 / api 33 / ecosystem 55 / troop_link / e2e 72。
- 預覽實測：`/api/troops` 回 0082（connected）；`/api/proxy` 登入（旅長/成員）→ token →
  `load` 回成員名單＋權限；`/api/health?troopId=0082` 正常。
- 生產站新瀏覽器：旅團卡「0082 82旅」正常顯示。

## 4. 升級步驟

- 前端：部署最新 `index.html`＋`vercel.json`（Vercel 自動部署 main 即生效）。
- 後端 GS：**唔使改**、唔使重新部署。
- 用戶端：見到列表前請**硬式重新整理一次**（清咗舊快取後，以後唔會再出舊版）。

版本：前端 v5.2（UI 色調更新）／ 後端 `cub-leaf` 無改動

COPYRIGHT 2026 Scout System
