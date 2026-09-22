# APP ADMIN 工作流程 v9.0 — 同一個 APP 管晒所有旅團（功能變數全部由你設定）

## 一句講完

**所有功能變數由 APP ADMIN（你）設定；旅團只交 3 樣資料（旅團編號 / 部署 URL / API Key），旅團唔會設定任何功能變數。**

```
[旅團 A] --\                                        /--> Vercel 功能變數（全部由你加）
            +--> 交 3 樣：編號 / URL / API Key --> [你] --> Redeploy
[旅團 B] --/                                        \--> 完成，首頁即見該旅團
```

## 每個支部係獨立 APP

- `vsbadge.vercel.app` → 深資童軍 #8B0000
- `roverbadge.vercel.app` → 樂行童軍 #0D47A1
- `scoutbadge.vercel.app` → 童軍 #2E7D32
- `cubbadge.vercel.app` → 幼童軍 #FFC107

每個 APP 各自有一個 APP ADMIN（維護該 Vercel Project 嘅人，即係你）；同一個 Vercel Project 可以管幾十個旅團。

---

## 旅團做（佢哋只做 3 步，唔會掂功能變數）

1. 建新 Google Sheet → 擴充功能 → Apps Script → 貼 `apps-script/Code.gs` → 儲存
2. 執行 `initializeSheets()` → 授權
   - **只生成 API Key**（彈窗只顯示：旅團編號 / 部署 URL / API Key）
   - 彈窗**永不顯示**超管帳號或任何密碼
3. 部署為網頁應用程式（執行身分：我；存取：任何人）→ 交 3 樣俾你：

```
旅團編號：0082
TROOP_0082_BACKEND：https://script.google.com/macros/s/.../exec
TROOP_0082_APIKEY：sc_xxxxxxxx
```

（第 3 樣 `TROOP_0082_NAME` 係**你**話事：例如「第 82 旅」。）

---

## APP ADMIN 做（全部喺 Vercel Dashboard，1 分鐘，唔使改任何 JSON）

1. Vercel → Project → Settings → Environment Variables
2. 加功能變數：
   - 全 APP 一次：`SUPER_KEY`（**你自己定** = 超管 `sheep` 密碼，亦係 `/api/register` 管理 API key）
   - 每旅團 3 個：`TROOP_0082_BACKEND` / `TROOP_0082_APIKEY`（旅團交嚟）/ `TROOP_0082_NAME`（你定）
   - 4 個都勾 Production, Preview, Development
3. **Redeploy** → 首頁 `troopGrid` 即刻見到該旅團

---

## 超管帳號 `sheep`（唔會再放出來）

- `apps-script/Code.gs` **只有帳號名 `sheep`**：冇寫死密碼（`0728` 已完全移除）、冇自動生成、冇顯示功能
- 密碼 100% 由功能變數讀取：
  - Vercel：`SUPER_KEY`（你設定，保護管理 API）
  - leaf GS（可選，你決定）：`SUPER_KEY`（明文）**或** `SUPER_KEY_HASH`（單向 SHA-256，**建議**：跑 `makeSuperKeyHash()` 拎 hash 交旅團貼入，旅團永遠唔會知密碼）
  - 兩個都未設定 → leaf 上超管入口完全關閉（唔會有任何後備密碼）
- 超管唔會出現喺：Users 表、用戶管理、成員名單、全團總覽、**操作紀錄**（非超管見唔到）
- 超管「改密碼」只寫入功能變數、永不回顯；記得同步更新 Vercel `SUPER_KEY`
- GS 彈窗（`initializeSheets()` / `showApiKey()` / `showVercelEnv()`）只顯示旅團要交嘅 3 樣；`showSuperKeyStatus()` 只顯示「已設定 / 未設定」

## 紅線

- 旅團交嘅只有 3 樣；**唔好**叫旅團去 GS 彈出超管密碼交俾你（舊做法已作廢）
- 密碼／apikey／SUPER_KEY **值**：唔入 GitHub、唔回前端、唔入 URL / QR
- `troops.json` / `data/troops.json` 已棄用（程式唔讀），設定一律喺 Vercel 功能變數

詳情見 `VERCEL_ENV_SETUP.md`（v9.0）。

COPYRIGHT 2026 Scout System
