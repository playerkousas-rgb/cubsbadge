# Vercel 環境變數（功能變數）設定指南 v9.0 — 定版：**全部功能變數由 APP ADMIN 設定**

> ⚠️ 更正之前 agent 寫錯嘅嘢（v9.0）：
> 1. ❌ 之前寫「旅團跑 initializeSheets 會生成 **API Key + SUPER_KEY**，交 APP ADMIN」——**錯**。
>    ✅ 旅團**只生成 API Key**，只交 3 樣：**旅團編號 + 部署 URL + API Key**。
> 2. ❌ 之前寫「超管密碼 = SUPER_KEY，喺 GS 用 `showSuperKey()` 睇」——**錯**（等於把超管帳號放出來）。
>    ✅ GS **永不生成、永不顯示、永不回傳**超管密碼；`showSuperKey()` 已移除。
> 3. ❌ 之前 `Code.gs` 寫死超管密碼 `0728`（連密碼都喺程式碼）——**錯**。
>    ✅ `Code.gs` **只有帳號名 `sheep`**；密碼 100% 由功能變數讀取，冇寫死、冇 fallback。
> 4. ✅ **正確契約：所有功能變數由 APP ADMIN（Vercel Project 維護者）一個人設定**；旅團唔設定任何功能變數。

---

## 一、邊個做啲乜（一句講完）

| 角色 | 要做嘅事 |
|------|---------|
| **旅團（leaf 部署者）** | ① 下載 `Code.gs` → 建 Google Sheet → 部署為網頁應用程式<br>② 執行 `initializeSheets()`（**只生成 API Key**）<br>③ 把 **旅團編號 + 部署 URL + API Key** 交 APP ADMIN<br>（旅團**唔會**、亦**唔需要**設定任何功能變數） |
| **APP ADMIN（你）** | 喺 Vercel 設定**全部**功能變數：`SUPER_KEY` + 每旅團 `TROOP_<id>_BACKEND` / `_APIKEY` / `_NAME` → Redeploy |

> 旅團**唔會**見到、亦**唔會**收到 `SUPER_KEY`。

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

---

## 三、超管帳號（`sheep`）點隱藏

**`Code.gs` 只有一樣嘢：帳號名 `sheep`。**
- 冇任何寫死密碼（`0728` 已完全移除）
- 冇 `ensureSuperKey()` 自動生成、冇 `showSuperKey()` 顯示、冇雜湊 property 後備
- 密碼 100% 由功能變數讀取，兩個做法（二選一，APP ADMIN 決定）：

| 做法 | leaf GS Script Property | 邊個設定 | 安全度 |
|------|------------------------|---------|--------|
| A. 明文 | `SUPER_KEY` = 密碼 | **APP ADMIN 設定**（旅團唔知） | 開 GS Script Properties 睇得到 |
| B. **建議**：單向 hash | `SUPER_KEY_HASH` = 密碼嘅 SHA-256 | APP ADMIN 跑 `makeSuperKeyHash()` 拎 hash，交旅團貼入 | ✅ 旅團拎到 hash 都反推唔到密碼 |

- 兩個都**未設定** → leaf 上超管入口**完全關閉**（連舊 `0728` 都唔會通）；超管照樣可以喺 APP 層用 Vercel `SUPER_KEY` 操作管理 API。
- 超管登入失敗一律回**同一句通用訊息**，唔會透露隱藏帳戶存在或設定狀態。
- 超管**唔會**出現喺：Users 表、用戶管理、成員名單、全團總覽、**操作紀錄**（非超管唔會見到超管嘅紀錄）。
- 超管「改密碼」= 只寫入功能變數（`setSuperKey(新密碼)`，寫入 `SUPER_KEY`），**永不回顯**；記得同步更新 Vercel `SUPER_KEY`。
  （用 hash 模式時：改用 `superKeyHashOf(新密碼)` 拎新 hash，更新 leaf 嘅 `SUPER_KEY_HASH`。）

**點睇／點改超管功能變數（永不經 GS 顯示值）：**
GS 編輯器 → ⚙ 專案設定 → 指令碼屬性（Script Properties）→ 自己睇／改。
APP ADMIN 輔助函數：`superKeyHashOf('密碼')`、`makeSuperKeyHash()`（只輸出 hash）、`showSuperKeyStatus()`（只顯示「已設定／未設定」）。

---

## 四、`SUPER_KEY` 喺 Vercel 端嘅用途

- 保護 APP 管理 API：`/api/register`（旅團註冊）必須帶 `x-super-key` header（或 body `superKey`）
  - 未設定 → `503`（管理 API 停用，唔會變成公開註冊口）
  - 驗證失敗 → `403`
  - 驗證通過 → 轉發註冊俾後端管理 GS
- `/api/health` 只回 `SUPER_KEY` **有冇設定**（boolean），**永不回值**
- 超管 `sheep` 喺 leaf GS 登入時，密碼比對嘅就係 leaf 上嘅 `SUPER_KEY` / `SUPER_KEY_HASH`（＝你喺 Vercel 設定嘅同一隻密碼）

---

## 五、紅線（唔好放寬）

- `apikey` / `SUPER_KEY` / 超管密碼**值**永不回前端、永不入 URL、永不入 QR（`/api/*` 回應只可以有 boolean「有冇設定」）
- GS **永不顯示**超管密碼；SETUP／initializeSheets／showApiKey 彈窗只顯示旅團要交嘅 API Key
- proxy 一律丟棄前端自帶嘅 `apikey` / `backend`（SSRF 防線），由 registry（= 功能變數）注入
- 功能變數值唔入 GitHub（Vercel Dashboard 設定就得）
- `troops.json` / `data/troops.json` 已棄用，程式唔讀

---

## 六、檢查清單

- [ ] 旅團只交咗 3 樣（編號／部署 URL／API Key）——冇 SUPER_KEY
- [ ] Vercel 功能變數：`SUPER_KEY` + `TROOP_<id>_BACKEND` / `_APIKEY` / `_NAME`（全部由 APP ADMIN 設定）
- [ ] 已 Redeploy
- [ ] leaf GS：`Code.gs` 只有 `sheep` 帳號名（無寫死密碼）
- [ ] 超管入口：設定 `SUPER_KEY`（明文）**或** `SUPER_KEY_HASH`（建議）後才生效
- [ ] 用超管登入一次；用普通領袖帳號確認見唔到超管（用戶管理／成員名單／操作紀錄）
- [ ] `/api/health` 嘅 `envContract` 4 樣 boolean + `SUPER_KEY` 都係 true

---

## 七、常見問答

**Q: 點解旅團唔使設定功能變數？**
A: 因為**全部功能變數由 APP ADMIN 設定**：值（`SUPER_KEY`、`TROOP_<id>_NAME`）你話事，URL／API Key 由旅團交俾你入 Vercel。旅團只係部署自己嘅 GS 同交 3 樣資料。

**Q: 超管密碼喺邊？**
A: 只喺功能變數（Vercel `SUPER_KEY`；leaf 可選 `SUPER_KEY` 或 `SUPER_KEY_HASH`）。`Code.gs` 只有帳號名 `sheep`，冇密碼。

**Q: 我會唔會唔記得咗超管密碼？**
A: 去 Vercel → Settings → Environment Variables 睇 `SUPER_KEY`（只有你睇到）；leaf 用咗 hash 模式就要喺你嘅密碼庫搵返。

**Q: 旅團自己開 GS Script Properties 會唔會睇到我密碼？**
A: 用 A 模式（明文 `SUPER_KEY`）會；用 **B 模式（`SUPER_KEY_HASH`，建議）** 就唔會——只有單向 hash。

**Q: GS 彈窗會唔會再顯示帳號密碼？**
A: 唔會。`initializeSheets()` 只顯示「交俾 APP ADMIN 嘅 3 樣」＋預設管理員帳號提示；超管相關一律只回 boolean。

**Q: 幾個旅團點算？**
A: 每旅團 3 個功能變數；`SUPER_KEY` 全 APP 一個（你一個人管晒）。

---

COPYRIGHT 2026 Scout System - Vercel Env v9.0：全部功能變數由 APP ADMIN 設定；超管只見 `sheep`
