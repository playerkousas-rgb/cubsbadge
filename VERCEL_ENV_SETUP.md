# Vercel 環境變數（功能變數）設定指南 v10.0 — 超管密碼只存在 Vercel；GS 完全冇

> ⚠️ 更正之前 agent 寫錯嘅嘢（v10.0）：
> 1. ❌ 之前寫「旅團跑 `initializeSheets` 會生成 **API Key + SUPER_KEY**，交 APP ADMIN」——**錯**。
>    ✅ 旅團**只生成 API Key**，只交 3 樣：**旅團編號 + 部署 URL + API Key**。
> 2. ❌ 之前寫「超管密碼 = `SUPER_KEY`，喺 GS 用 `showSuperKey()` 睇」——**錯**（等於把超管帳號放出來）。
> 3. ❌ v5.7 寫「超管密碼 = GS Script Property `SUPER_KEY`，去 ⚙ 專案設定 → 指令碼屬性睇／改」——**一樣錯**：
>    指令碼屬性旅團睇得到，等於冇隱藏。
>    ✅ v5.8 定版：**超管密碼只存在 APP ADMIN 嘅 Vercel 功能變數**；leaf GS 只有帳號名，
>    **冇密碼、冇雜湊、冇 Script Property、冇 fallback**；超管登入一律由 Vercel 層驗證。
> 4. ❌ 之前 `Code.gs` 寫死超管密碼 `0728`（連密碼都喺程式碼）——**錯**，已完全移除。
> 5. ✅ **正確契約：所有功能變數由 APP ADMIN（Vercel Project 維護者）一個人設定**；旅團唔設定任何功能變數。

---

## 一、邊個做啲乜（一句講完）

| 角色 | 要做嘅事 |
|------|---------|
| **旅團（leaf 部署者）** | ① 下載 `Code.gs` → 建 Google Sheet → 部署為網頁應用程式<br>② 執行 `initializeSheets()`（**只生成 API Key**，順手清走舊版遺留嘅超管 property）<br>③ 把 **旅團編號 + 部署 URL + API Key** 交 APP ADMIN<br>（旅團**唔會**、亦**唔需要**設定任何功能變數；**永遠睇唔到超管密碼**） |
| **APP ADMIN（你）** | 喺 Vercel 設定**全部**功能變數：`SUPER_KEY` + 每旅團 `TROOP_<id>_BACKEND` / `_APIKEY` / `_NAME` → Redeploy |

> 旅團**唔會**見到、亦**唔會**收到 `SUPER_KEY` —— 連自己部 GS 都冇呢個值。

---

## 二、功能變數清單（全部由 APP ADMIN 設定）

| # | 功能變數 | 值來自 | 幾多個 |
|---|---------|--------|--------|
| 1 | `SUPER_KEY` | **APP ADMIN 自己定**（= 超管 `sheep` 嘅密碼，亦係管理 API key） | 全 APP **1 個** |
| 2 | `TROOP_0082_BACKEND` | 旅團交嚟嘅部署 URL（`/exec` 結尾） | 每旅團 1 個 |
| 3 | `TROOP_0082_APIKEY` | 旅團交嚟嘅 API Key（`sc_…`） | 每旅團 1 個 |
| 4 | `TROOP_0082_NAME` | **APP ADMIN 自己定**（旅團顯示名稱，例：第 82 旅） | 每旅團 1 個 |

**命名規則：** `TROOP_` + 旅團編號（保留前導 0，0082 就係 `TROOP_0082_*`）+ `_BACKEND` / `_APIKEY` / `_NAME`。
多旅團（例：0082 + 0015）就加 `TROOP_0015_*` 三個；`SUPER_KEY` 仍然全 APP 一個。

**Vercel Dashboard 操作：** Project → Settings → Environment Variables → Add
（4 個都勾 Production, Preview, Development）→ **Redeploy**。

> 🔑 `TROOP_<id>_APIKEY` 有雙重身份：① 代理注入嘅旅團 API Key；② **超管 sig 嘅簽名鑰匙**
> （Vercel 用同一隻值簽，leaf 用自己嘅 `API_KEY` 驗簽）。所以**冇設 `_APIKEY` 嘅旅團，超管登入唔到**（其他功能照舊）。

---

## 三、超管帳號（`sheep`）—— GS 只有一個名，密碼只喺 Vercel

```js
// apps-script/Code.gs（v5.8）
const SUPER_ADMIN_LOGIN = 'sheep';            // ← leaf 只有呢一行（＋衍生內部電郵）
// 冇 SUPER_ADMIN_PASSWORD、冇雜湊、冇 Script Property、冇 fallback。
// 超管登入：APP（Vercel /api/super-login）比對 SUPER_KEY → 用本單位 apikey 簽短效 sig
//           → POST action=superLogin → leaf 用自己 getApiKey() 驗簽 → 發 token。
```

```
前端「登入」（帳號 sheep）→ /api/proxy
   → Vercel 就地比對 SUPER_KEY（timing-safe；密碼唔會離開 Vercel）
   → 簽 ≤10 分鐘 sig（HMAC-SHA256，鍵 = 該旅團 apikey）
   → leaf GS：{action:'superLogin', payload, sig}   ← 冇密碼、冇 apikey
   → leaf 驗簽通過 → 發超管 token（虛擬帳號：唔寫 Users 表、唔喺用戶管理／成員名單／操作紀錄出現）
```

- **改超管密碼**：Vercel → Project → Settings → Environment Variables → `SUPER_KEY`（改完 **Redeploy**）。
  系統**唔會**喺 leaf 改密碼 —— 超管喺 APP 撳「改密碼」只會收到「請去 Vercel 改」嘅提示。
- **未設定 `SUPER_KEY` = 超管完全登入唔到**（冇任何後備密碼、冇預設值）。
- 超管登入失敗一律回**同一句通用訊息**（`帳號或密碼錯誤`），唔會透露隱藏帳戶存在。
- 舊部署（v5.5–v5.7）遺留喺 GS「指令碼屬性」嘅 `SUPER_KEY`：跑一次新 `initializeSheets()` **會自動清走**（`legacySuperKeyPurged:true`）。
- 超管唔會出現喺：Users 表、用戶管理、成員名單、全團總覽、**操作紀錄**（非超管見唔到）。

> 密碼由你定，**唔需要複雜**：6–8 位自己記得就得。緊要嘅係：唔喺程式碼、唔喺文件、唔喺 GitHub、**唔喺任何一部旅團嘅 GS**。

## 四、`SUPER_KEY` 喺 Vercel 端嘅用途

- 超管登入閘口：`/api/proxy`（`action:'login'` + 超管帳號）→ `api/super-login.js`
  - 未設定 → 通用失敗（入口關閉，唔會變成公開登入）
  - 密碼錯 → 通用失敗（15 分鐘 20 次輕量限流）
  - 密碼啱 → 簽 sig 轉發 leaf；密碼本身**永不轉發**
- 保護 APP 管理 API：`/api/register`（旅團註冊）必須帶 `x-super-key` header（或 body `superKey`）
  - 未設定 → `503`（管理 API 停用，唔會變成公開註冊口）
  - 驗證失敗 → `403`
  - 驗證通過 → 轉發註冊俾後端管理 GS
- `/api/health` 只回 `SUPER_KEY` **有冇設定**（boolean），**永不回值**

---

## 五、紅線（唔好放寬）

- `apikey` / `SUPER_KEY` / 超管密碼**值**永不回前端、永不入 URL、永不入 QR（`/api/*` 回應只可以有 boolean「有冇設定」）
- **leaf GS 永不持有超管密碼**：唔准寫入 Script Property，亦唔准喺 `Code.gs` 寫死
- GS **永不顯示**超管密碼；SETUP／initializeSheets／showApiKey 彈窗只顯示旅團要交嘅 API Key
- proxy 一律丟棄前端自帶嘅 `apikey` / `backend`（SSRF 防線），由 registry（= 功能變數）注入
- 功能變數值唔入 GitHub（Vercel Dashboard 設定就得）
- `troops.json` / `data/troops.json` 已棄用，程式唔讀

---

## 六、檢查清單

- [ ] 旅團只交咗 3 樣（編號／部署 URL／API Key）——冇 SUPER_KEY
- [ ] Vercel 功能變數：`SUPER_KEY` + `TROOP_<id>_BACKEND` / `_APIKEY` / `_NAME`（全部由 APP ADMIN 設定）
- [ ] 已 Redeploy
- [ ] leaf GS：`Code.gs` 只有 `sheep` 帳號名；**指令碼屬性冇 `SUPER_KEY`**（跑 `initializeSheets()` 會清）
- [ ] 用超管 `sheep` 登入一次（密碼 = Vercel `SUPER_KEY`）
- [ ] 用普通領袖帳號確認見唔到超管（用戶管理／成員名單／操作紀錄）
- [ ] `/api/health` 嘅 `envContract` 4 樣 boolean + `SUPER_KEY` 都係 true

---

## 七、常見問答

**Q: 點解旅團唔使設定功能變數？**
A: 因為**全部功能變數由 APP ADMIN 設定**：值（`SUPER_KEY`、`TROOP_<id>_NAME`）你話事，URL／API Key 由旅團交俾你入 Vercel。旅團只係部署自己嘅 GS 同交 3 樣資料。

**Q: 超管密碼喺邊？**
A: **只喺 Vercel 功能變數 `SUPER_KEY`**。`Code.gs` 只有帳號名 `sheep`；leaf 任何地方（Sheet、程式碼、指令碼屬性、操作紀錄）都搵唔到密碼。

**Q: 我會唔會唔記得咗超管密碼？**
A: 去 Vercel → Project → Settings → Environment Variables 睇 `SUPER_KEY`（只有你睇到）。

**Q: 旅團自己開 GS → ⚙ 專案設定 → 指令碼屬性，會唔會睇到我密碼？**
A: **唔會**（v5.8 起）。舊部署如果曾經設定過，跑一次新 `initializeSheets()` 會清走；清完之後旅團點搵都冇。

**Q: 超管登入失敗，話「帳號或密碼錯誤」？**
A: 三個可能：① 密碼錯；② Vercel 未設定 `SUPER_KEY`（去 Settings 睇）；③ 該旅團未設 `TROOP_<id>_APIKEY`（超管 sig 靠佢驗簽）。睇 `/api/health?troopId=0082` 嘅 `envContract` 就知邊樣未設。

**Q: 旅團部 GS 未升級（仲係 v5.7 或之前）會點？**
A: 普通功能照用；超管登入會失敗（後端唔識 `action=superLogin`）。叫旅團覆蓋最新 `Code.gs` → 部署「新版本」→ 跑一次 `initializeSheets()`。

**Q: GS 彈窗會唔會再顯示帳號密碼？**
A: 唔會。`initializeSheets()` 只顯示「交俾 APP ADMIN 嘅 3 樣」＋預設管理員帳號提示，冇任何超管密碼。

**Q: 幾個旅團點算？**
A: 每旅團 3 個功能變數；`SUPER_KEY` 全 APP 一個（你一個人管晒）。

---

COPYRIGHT 2026 Scout System - Vercel Env v10.0：全部功能變數由 APP ADMIN 設定；超管 = `sheep` + **只喺 Vercel 嘅** `SUPER_KEY`（leaf GS 完全冇）
