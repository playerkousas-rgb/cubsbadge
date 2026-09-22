# APP ADMIN 工作流程 v10.0 — 同一個 APP 管晒所有旅團（功能變數全部由你設定）

## 一句講完

**所有功能變數由 APP ADMIN（你）設定；旅團只交 3 樣資料（旅團編號 / 部署 URL / API Key），旅團唔會設定任何功能變數，亦永遠睇唔到超管密碼。**

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

1. 建新 Google Sheet → 擴充功能 → Apps Script → 貼 `apps-script/Code.gs`（v5.8）→ 儲存
2. 執行 `initializeSheets()` → 授權
   - **只生成 API Key**（彈窗只顯示：旅團編號 / 部署 URL / API Key）
   - 順手**清走舊版遺留喺指令碼屬性嘅 `SUPER_KEY`**（值只應該存在你嘅 Vercel）
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

## 超管帳號 `sheep`（leaf 完全冇密碼）

- `apps-script/Code.gs`（v5.8）**只有一個常數**：`SUPER_ADMIN_LOGIN = 'sheep'`
- **密碼只存在 Vercel 功能變數 `SUPER_KEY`**：GS 冇密碼、冇雜湊、冇 fallback、連 Script Property 都唔會讀
- **登入流程（就咁簡單）**：
  1. 前端「登入」→ `/api/proxy`
  2. Vercel 比對 `SUPER_KEY`（密碼唔會離開 Vercel，亦唔會落 GS）
  3. 通過就送 `action=superLogin` 落 leaf（apikey 由 server 端注入）→ leaf 發超管 token
- 未設定 `SUPER_KEY` → 超管完全登入唔到（冇任何後備密碼）
- **改超管密碼**：Vercel → Settings → Environment Variables → `SUPER_KEY` → Redeploy（系統唔會喺 leaf 改）
- 超管登入失敗一律回同一句通用訊息（`帳號或密碼錯誤`），唔會透露隱藏帳戶存在
- 超管唔會出現喺：Users 表、用戶管理、成員名單、全團總覽、**操作紀錄**（非超管見唔到）
- GS 彈窗（`initializeSheets()` / `showApiKey()` / `showVercelEnv()`）只顯示旅團要交嘅 3 樣，永不顯示超管密碼

## 紅線

- 旅團交嘅只有 3 樣；**唔好**叫旅團去 GS 彈出超管密碼交俾你（舊做法已作廢）
- **唔好**喺 GS 指令碼屬性放 `SUPER_KEY`（舊做法；旅團睇得到 = 冇隱藏）
- 密碼／apikey／SUPER_KEY **值**：唔入 GitHub、唔回前端、唔入 URL / QR
- `troops.json` / `data/troops.json` 已棄用（程式唔讀），設定一律喺 Vercel 功能變數

詳情見 `VERCEL_ENV_SETUP.md`（v10.0）與 `docs/CHANGE_LOG_v5.8.md`。

COPYRIGHT 2026 Scout System
