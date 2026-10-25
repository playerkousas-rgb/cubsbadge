# APP ADMIN 工作流程 v10.0 — 同一個 APP 管晒所有旅團（功能變數全部由你設定）

## 一句講完

**所有功能變數由 APP ADMIN（你）設定；旅團只交 3 樣資料（旅團編號 / 部署 URL / API Key），旅團唔會設定任何功能變數，亦永遠睇唔到超管密碼。**

```
[旅團 A] --\                                        /--> Vercel 功能變數（全部由你加）
            +--> 交 3 樣：編號 / URL / API Key --> [你] --> Redeploy
[旅團 B] --/                                        \--> 完成，首頁即見該旅團
```

## 所有補丁的資料保全硬性規則

**所有前端、API 及 Apps Script 補丁都不得修改用戶現有資料。** 這是每次更新及驗收的硬性功能要求，不是只適用於某一次 GS 版本。

- 不得刪除、覆寫、重置、重新編號或擅自遷移帳號、成員、YMIS、現行及舊 ID 進度、其他徽章、活動履歷、備註和旅團設定。
- 不得因綱要或系統更新而把舊 ID 靜默轉成新 ID，亦不得要求用戶重新輸入已有資料；舊紀錄必須按原值保留。
- 只可作出向後兼容的新增：補建缺失工作表、補齊缺失欄位，以及在設定不存在時加入預設值；**已有值一律不可改寫**。
- 版本及初始化標記只寫入 Apps Script Script Properties，不得借更新標記改寫用戶業務資料；現有 API Key 不得因補丁或重新初始化而更換。
- 補丁驗收必須比較更新前後的用戶資料，證明原有值保持不變；如需要新格式，應新增相容結構並保留原始資料，而不是覆寫。

## 本部署只服務幼童軍支部

- `cubbadge.vercel.app` → 幼童軍支部（黃色主題）
- 本檔只說明 CubBadge 的旅團接入；其他支部的部署、徽章及表格不屬於本系統依據。
- 每個 Vercel Project 可以管多個幼童軍旅團；APP ADMIN 負責維護該 Project 的功能變數。

---

## 現有旅團本次更新（2026-10-25）

- 用戶管理已修復停用帳戶顯示／重新啟用，以及帳戶角色更新；另新增獨立「小隊職務」隊員／隊長／副隊長選擇，儲存值為 `member`／`sixer`／`vice_captain`（副隊長不可用 `branch_leader` 代替）。
- 最新 GS 為 `2026.10.25`。旅團換上最新 `Code.gs` 並部署新版本後，**已有正常 Sheet 毋須執行 `initializeSheets()`**；不會重設或遷移用戶資料、成員資料或 API Key。純成員設定小隊職務時只會在成員名單最右補一欄 `squad_role`，原欄位及值不變。
- 仍使用舊 GS 的旅團須換上最新 `Code.gs` 並部署新版本；下方三步是**新建 Sheet 首次接入**，首次初始化仍不可省略。版本核對不會把舊初始化標記改成新值。

## 旅團做（佢哋只做 3 步，唔會掂功能變數）

1. 建新 Google Sheet → 擴充功能 → Apps Script → 貼最新 `apps-script/Code.gs`（GS 2026.10.25）→ 儲存
2. 執行 `initializeSheets()` → 授權
   - **生成／保留 API Key**（彈窗只提供 API Key，不顯示自動取得的部署 URL；不要求輸入或設定旅團編號）
   - 順手**清走舊版遺留喺指令碼屬性嘅 `SUPER_KEY`**（值只應該存在你嘅 Vercel）
   - 彈窗**永不顯示**超管帳號或任何密碼
3. 部署為網頁應用程式（執行身分：我；存取：任何人）→ 取得 Google 部署視窗的 URL → 在 ADMIN FORM 填旅團編號、名稱及以下資料：

```
旅團編號：0082
部署 URL：https://script.google.com/macros/s/.../exec
API Key：sc_xxxxxxxx
```

> ⚠️ GS 2026.10.25 **不再顯示自動取得的 BACKEND URL**，避免初始化、選單及快取各顯示另一條網址。
> 旅團編號只需在 ADMIN FORM 填寫，不在 GS 預先設定；既有 Script Properties 中的編號仍原樣保留。
> 旅團 API Key 在「🔗 旅系統 → 🔑 顯示 API KEY（交 ADMIN）」查看。
> 正式 URL 由 Google「部署 → 管理部署」中選定的網頁應用程式提供，不由 GS 彈窗猜測。
> **不增加叫用戶貼網址／設定 BACKEND 的 GS 步驟**；原有登記資料及 APP ADMIN 設環境變數流程不變。
> 不再以「✅ 已核實」、開過一次 `/exec` 或部署 ID 長度判定 URL 正確。

（第 3 樣 `TROOP_0082_NAME` 係**你**話事：例如「第 82 旅」。）

---

## APP ADMIN 做（全部喺 Vercel Dashboard，1 分鐘，唔使改任何 JSON）

1. Vercel → Project → Settings → Environment Variables
2. 加功能變數：
   - 全 APP 一次：`SUPER_KEY`（**你自己定** = 超管 `sheep` 密碼；公開申請 `/api/register` 唔使用、亦不得向外轉發此值）
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
- GS 登記資料彈窗（`initializeSheets()` / `showApiKey()` / `showVercelEnv()`）只提供 API Key，不要求預先設定旅團編號，亦不顯示自動取得的部署 URL，永不顯示超管密碼

## 紅線

- 旅團交嘅只有 3 樣；**唔好**叫旅團去 GS 彈出超管密碼交俾你（舊做法已作廢）
- **唔好**喺 GS 指令碼屬性放 `SUPER_KEY`（舊做法；旅團睇得到 = 冇隱藏）
- 密碼／apikey／SUPER_KEY **值**：唔入 GitHub、唔回前端、唔入 URL / QR
- `troops.json` / `data/troops.json` 已棄用（程式唔讀），設定一律喺 Vercel 功能變數

詳情見 `VERCEL_ENV_SETUP.md`（v10.0）與 `docs/CHANGE_LOG_v5.8.md`。

COPYRIGHT 2026 Scout System
