# APP ADMIN 工作流程 - 同一個 APP 管晒所有旅團（v8.0 功能變數契約）

## 你問：管理員是指向同1個APP ADMIN的對吧？

**答：係！**

- 每個支部是**獨立APP**：
  - `vsbadge.vercel.app` → 深資童軍 #8B0000
  - `roverbadge.vercel.app` → 樂行童軍 #0D47A1
  - `scoutbadge.vercel.app` → 童軍 #2E7D32
  - `cubbadge.vercel.app` → 幼童軍 #FFC107

- 每個 APP **各自**有一個 APP ADMIN (維護該 Vercel Project 的人，超管帳號 SHEEP，密碼 = `SUPER_KEY` 功能變數)
  - 例如 vsbadge 的 APP ADMIN 管晒所有用 vsbadge 的旅團 (0082, 0015, 0233...)
  - 唔係每個旅團開一個 Vercel，係共用同一個

## 旅團加入流程（功能變數 4 樣，唔再改 JSON）

```
[旅團 A] --\
            +--> 提交 4 樣 --> [APP ADMIN] --> Vercel 加功能變數 --> Redeploy
[旅團 B] --/
```

**旅團需提交（4樣，全部來自後端 GS）：**
| 項目 | 值來自（後端GS 對應） |
|------|----------------------|
| 旅團編號（如 0082） | 旅團自己話事 |
| `TROOP_0082_BACKEND` | GS 部署 URL（/exec） |
| `TROOP_0082_APIKEY` | GS `showApiKey()`（Script Property API_KEY） |
| `TROOP_0082_NAME` | GS `setTroopName()`（Script Property TROOP_NAME） |
| `SUPER_KEY` | GS `showSuperKey()`（= 超管 sheep 密碼；全 APP 一個，兩邊同一隻值） |

**管理員做（全部喺 Vercel Dashboard，唔使改任何 JSON）：**
1. 全 APP 一次：加功能變數 `SUPER_KEY`（同旅團 GS 超管密碼同一隻值）
2. 每旅團加 3 個功能變數：`TROOP_0082_BACKEND` / `TROOP_0082_APIKEY` / `TROOP_0082_NAME`
3. Redeploy

## 為何咁設計？

- **全部指向功能變數**：URL、API KEY、名稱、超管密碼 —— 4 樣都喺 Vercel 環境變數，唔再指向 JSON、唔再寫死
- **後端GS 對應**：4 樣功能變數同 GS Script Properties／部署 URL 一一對應，`showVercelEnv()` 一次過顯示晒
- **SUPER_KEY = 超管密碼**：GS 隱藏超管 sheep 嘅密碼同 Vercel `SUPER_KEY` 兩邊同一隻值；並保護 `/api/register` 管理 API（要帶 `x-super-key`）
- **人類靠登入防**：即使拿到 backend+apikey，無 token 都讀唔到進度
- **同一個 APP ADMIN**：方便集中維護，一個 Vercel Project 管幾十個旅團

## GS 自動生成 API KEY + SUPER_KEY 已加入

`apps-script/Code.gs` v5.5：

- `initializeSheets()`：自動生成 `API_KEY` + `SUPER_KEY`，問旅團編號／名稱，彈窗顯示 4 樣對應值
- `showVercelEnv()` / `showApiKey()`：隨時再睇 4 樣
- `showSuperKey()`：淨係 SUPER_KEY（= 超管密碼）
- 超管 sheep 登入密碼 = `SUPER_KEY`（未設先兼容舊 0728）；「改密碼」= `setSuperKey(新密碼)`

## 檢查

- 超管隱藏：已實作，非 super_admin 睇唔到 sheep 帳號；密碼指向 `SUPER_KEY` 功能變數
- 0082R 已移除：scoutbadge 之前有殘留，已清
- vsbadge 文字殘留：roverbadge/cubbadge/scoutbadge 之前寫 vsbadge 管理員，已改為各自 app 管理員
- ❌ 之前「改 troops.json + 加 1 個功能變數」做法已作廢：`troops.json` 已棄用（deprecated stub），設定全部喺 Vercel 功能變數 4 樣

COPYRIGHT 2026 Scout System
