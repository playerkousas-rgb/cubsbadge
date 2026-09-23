# 進度追蹤旅系統升級版 — 對齊定案（2026-09-23）

> 本檔係本倉進度追蹤 leaf 嘅接駁規格及版號唯一記錄。程式碼內不寫 release version；`apps-script/Code.gs`、`assets/batch-onboard/Code.gs` 只保留功能說明。`docs/` 已在 `.vercelignore`，不會部署到公開網站。
>
> 本倉係 **cubsbadge**：最下游進度追蹤 leaf。實作按 VS／RS 已實測嘅 GAS-to-GAS 做法對齊，但 `<purpose>`、匯出格式名及 Cubs 自己嘅 action 名保持本支部一致。

## 0. 定位及範圍

一份 `Code.gs` 可部署喺旅、團（支部）及進度三層。一個節點可以同時做上游及下游：上游 Script Properties 登記下游 `/exec` URL + 下游 SHEET KEY，之後由上游以 `sig` 讀寫下游；下游 `ALLOW_LOCAL_LOGIN` 控制本地直接入口。

接入完全自願：未登記、已登記但未閂口，原有 leaf 行為不變。進度追蹤係最下游記錄冊，只做：

1. 被上游登記；
2. 接受上游簽名讀寫；
3. 本地入口保持開啟，或者由上游閂成只收 `sig`。

模組註冊、通告／訂閱、財務、跨支部權限樹、邀請連結、管理層 ADMIN APP 等屬旅／團管理系統，不加入 Cubs leaf。

本倉本輪範圍：接駁、簽名、上下游掣、上游開戶、含 hash JSON 搬數、選單及守護測試。既有前端 `index.html`、既有 Vercel `api/`、既有工作表 schema 及資料不改。

## 1. ABCD（全部不寫入任何 SHEET）

| 代號 | 名稱 | 來源 | 儲存位置 | 用途 |
|---|---|---|---|---|
| A | `SUPER_KEY` | 現有超管設定 | Vercel env | 中央超管登入；與旅系統接駁無關 |
| B | `TROOP_(id)_BACKEND` | 部署後 `ScriptApp.getService().getUrl()` | Vercel env；上游為 `DOWNSTREAM_<id>_URL` | proxy／上游要打去邊個 GAS |
| C | `TROOP_(id)_NAME` | ADMIN 自填 | Vercel env | 前端顯示名 |
| D | `TROOP_(id)_APIKEY` | GAS `API_KEY` Script Property | Vercel env；上游為 `DOWNSTREAM_<id>_KEY` | apikey，同時係本節點簽名根密鑰 |

Sheet 選單「🔗 旅系統 → 🔑 顯示 BACKEND／APIKEY（交 ADMIN）」一次顯示 B、D；C 由 ADMIN 填。B/D 只落 Script Properties 及 Vercel env，A 只在 Vercel env；四者及其值不寫任何工作表、不寫 Git、不回前端、不放 URL。

換 D 必須同步三處：下游刪除 `API_KEY` 後重新 `showApiKey()`、上游重新登記下游、ADMIN 更新 Vercel env 後 Redeploy。

## 2. 上下游登記

```text
旅 GAS ── sig ──▶ 團（支部）GAS ── sig ──▶ 進度 GAS
  │                    │                         │
  DOWNSTREAM_<id>_*    DOWNSTREAM_<id>_*         ALLOW_LOCAL_LOGIN
```

上游每個下游保存以下 Script Properties：

- `DOWNSTREAM_<id>_URL`
- `DOWNSTREAM_<id>_KEY`
- `DOWNSTREAM_<id>_NAME`
- `DOWNSTREAM_<id>_AT`

`<id>` 必須是 1–32 字元，只可用英文字母、數字、底線、連字號。URL 必須係正式 `https://script.google.com/macros/s/.../exec`，其他 URL 一律拒絕。登記、測試、閂口、開戶及匯出／匯入都由 Sheet 選單操作。

接入次序固定：

1. 每層貼同一份 `Code.gs`，部署為網頁應用程式（執行身分「我」、存取權「任何人」），抄 B/D；
2. ADMIN 登記 B、C、D；
3. 上游「➕ 登記下游」；
4. 「📡 測試下游連線（sig）」；
5. 舊進度「📤 匯出 JSON（含 hash）」、新支部「📥 匯入 JSON」；
6. 核對資料後，上游「🔒 閂口」；
7. 閂口後新戶一律在上游「👤 為下游開戶」。

升級既有部署只須以新檔覆蓋並在「管理部署 → 編輯 → 版本」選新版本；`/exec` URL 不變。只有新支部 SHEET 需要執行 `initializeSheets()`；既有進度 SHEET 不重跑、不清資料、不改 schema。

## 3. GAS-to-GAS `sig`

每個 repo 有自己固定一條 purpose；cubsbadge 寫死：

```text
purpose  = cubsbadge-troop-sig-v1
sigKey   = hex(HMAC-SHA256(message=purpose, key=下游 SHEET KEY))
canonical = action + "\n" + ts(毫秒) + "\n" + nonce + "\n" + hex(SHA-256(rawBody))
sig      = hex(HMAC-SHA256(canonical, key=sigKey))
```

上游簽出站用登記咗嘅下游 D；下游驗入站用自己嘅 D。推導出來嘅 `sigKey` 不落地、不儲存。cubsbadge 只支援 cubsbadge 對 cubsbadge 接駁，不支援跨 repo 直連。

為防 GAS 302 轉址遺失 query，一次請求可有兩個通道：

- query：`?sig=&sts=&snonce=`，digest 綁完整原始 body；
- body：`{ ..., sig, sig_ts, sig_nonce }`，digest 綁移除三個簽名欄後嘅 `JSON.stringify`。

下游先驗 query，失敗再驗 body；只要其中一組通過，兩組 nonce 都會一次過寫入 `CacheService` 消耗，堵死混合重放。簽名請求一律 POST，GET 帶 sig 一律拒絕。

防護規則：

- 時窗 ±5 分鐘，未來時間戳拒絕；
- nonce 一次性，cache TTL 600 秒；
- body 最多 900 KB；
- sig 必須係 64 位 hex，nonce 必須係安全字元；
- 比較時先對兩邊各自 SHA-256，再作固定長度比較；
- 下游收到上游標籤後先清除至 `0-9A-Za-z_.@-`，再寫入工作表，防止公式注入。

### 3.1 Cubs signed action 白名單

讀：

```text
load, getLoginMode, getLinkState, getMembers, getConfig, getAllUsers,
getOtherBadges, getPendingRequests, getApplications, getLogRecords,
getLogRequests, getAuditLog
```

寫：

```text
save, saveOtherBadge, requestComplete, reviewRequest, addMember, addUser,
bulkAddUsers, upsertUser, importUsers, resetPassword, updateUserProfile,
deactivateUser, reactivateUser, deleteUser, updateUserRole, updatePermissions,
saveLogRecord, deleteLogRecord, reviewLogRequest, setLocalLogin
```

永不接受 signed action：`login`、`apply`、`logout`、`changePassword`、`updateConfig`、`requestLogRecord`、`cancelLogRequest`，以及白名單以外任何 action。中央登入票據係另一條登入鏈，不屬於 signed action。

每筆 signed write 在下游「操作紀錄」記一行，操作者標記為 upstream／清理後嘅 `on_behalf`；signed read 不留操作紀錄。讀取用戶清單永不回傳 `password_hash`。

## 4. 中央登入與回傳邊界

中央登入保留既有 APP → leaf 鏈，並對齊固定受信端點：

```text
固定 SUPER_VERIFY_URL = https://cubsbadge.vercel.app/api/super
```

GAS 收到 `login` 嘅 `super_ticket` 後，只會回打上述固定端點驗票；票據一次性、有效期 60 秒，成功後才發超管 token。`SUPER_KEY` 永不進 GAS／Sheet；proxy 亦不應附送超管明文密碼。為兼容既有 Cubs proxy，已存在嘅 server-to-server `action=superLogin` apikey 路徑保留，仍不接收密碼。

旅系統鏈路本身係單向同步：上游 POST，下游同步回 `{success,data}` 或 `{success:false,error}`。沒有 callback endpoint、沒有下游主動回打上游、沒有 timer／trigger／onEdit。同步回傳不算 callback。

## 5. `ALLOW_LOCAL_LOGIN` 直接入口掣

旗只存在下游 Script Properties：

| 值 | 行為 |
|---|---|
| 未設定／空白 | 開啟，現有旅團零影響；初始化不自動寫入 |
| `1`、`true`、`yes`、`on`、`open`（不分大小寫／空白） | 開啟 |
| 其他任何值，包括 `false`、`0`、`no`、`off`、錯字 | 閂口，fail closed |

閂口後所有未簽名本地請求回：

```json
{"success":false,"upstream_only":true,"error":"...只接受上游簽名（sig）請求..."}
```

直接 `login`、`apply`、GET `load`／`getLoginMode`、token 操作及舊 apikey 直接寫入都拒絕。有效 signed request 仍然接受；中央登入與此旗脫鉤，仍然接受。掣可逆：下游「🚪 本機直接入口」開／閂，或上游 signed `setLocalLogin(allow=true/false)`。

每個下游應保留至少一個本地領袖戶及超管恢復路徑，避免上游設定錯誤時無法救援。

## 6. 上游開戶

介面：`createAccountForDownstream(downstreamId, rawUser, manager)`。

流程：

1. 上游按既有角色、權限、YMIS／Email 唯一規則開戶；
2. 上游讀回新戶嘅 `password_hash`；
3. 以 signed `upsertUser` 推送同一個 hash 到下游；
4. 任一邊失敗都明確回報「上游已開戶，但下游寫入失敗」，不可靜默造成兩邊不一致。

`upsertUser` 規則：

- 新戶一定要 64 位 hex `password_hash`；帶明文 `password` 一律拒絕；
- 同 YMIS 或同 Email 對回同一身份時更新，不新增重複列；
- 有 hash 就更新密碼，無 hash 就保留既有密碼；
- 無 `branch` 不洗走下游既有 branch；
- `SUPER_ADMIN` 保留帳號不可操作；
- 操作冪等，並同步成員名單。

身份錨點：成員（YMIS）在該團支部 SHEET 誕生；leaf 不自行開成員戶口、不反寫上游。領袖／家長身份由其所屬旅／團管理層決定；leaf 只接收上游鏡像及搬數。

## 7. 含 hash JSON 搬數

舊進度按「📤 匯出 JSON（含 hash）」：

- 檔名 `cubsbadge-users-<yyyyMMdd-HHmmss>.json`；
- 建立後設為 `Access.PRIVATE` + `Permission.NONE`；
- Drive 失敗時完整 JSON 只寫 Logger 作後備；
- 不開新工作表、不將 hash 寫操作紀錄，只記筆數及檔案 ID；
- 匯入成功後嘗試刪除／移除 Drive 匯出檔。

新支部按「📥 匯入 JSON」：

- 接受 Drive link／file ID；
- JSON 每筆走 `upsertUser`；
- 新戶只收 64 位 hex hash；明文密碼、假 hash、壞 JSON、缺 YMIS 一律拒絕；
- `force_change_password` 跟隨匯出值；
- 一次最多 2000 筆；
- 彈窗顯示新增、更新、失敗及失敗原因；
- 重匯係 update，不會產生重複 Users row。

搬數完成、核對筆數及連線測試成功後，才由上游按「🔒 閂口」。

## 8. 明確不做

- 不在 SHEET 寫 ABCD；
- 不改 `SUPER_KEY` 的 Vercel 管理邏輯；
- 旅系統不設 callback；
- 不改 `index.html`、不改 `api/`；signed chain 係 GAS → GAS，不經 Vercel proxy；
- 不改現有工作表 schema、不清資料、既有進度部署不重跑初始化；
- leaf 不加入通告、圖書館、推送、訂閱、財務、跨支部管理模組；
- 下游不自行開成員戶口、不反寫上游；
- 程式碼內不加入 release version comment，版本及對齊紀錄只放本 MD。

## 9. 本輪實作及驗收

本倉改動：

- `apps-script/Code.gs`：加入 `cubsbadge-troop-sig-v1`、query/body 雙通道簽名、nonce 防重放、白名單路由、上下游 Script Properties registry、連線測試、上下游入口掣、上游開戶、Drive 私人 JSON 匯出／匯入及 Sheet 選單；移除初始化時自動寫 `ALLOW_LOCAL_LOGIN`；加入固定中央驗票端點；
- `assets/batch-onboard/Code.gs`：保持既有批量工具，清理 release version 註解；
- `test/troop_link.test.mjs`：10 項 in-memory GAS 守護測試；
- `package.json`：加入 `npm run test:link`，完整 `npm test` 包含旅系統測試；
- 本檔：唯一升級規格，且不進 Vercel build。

10 項測試覆蓋：

1. 掣未設定＝行為零變化；
2. 閂口後直接登入／申請／GET load／本地寫入拒絕；
3. 登記下游後 signed read/write 及上游閂口；
4. 錯 key、篡改、過期、未來時間、重放、混合 nonce、GET、白名單外 action；
5. ABCD 只在 Script Properties，不入任何工作表；
6. 上游開戶兩邊同一 hash、冪等、無 hash 保留原密碼；
7. Drive 私人匯出／匯入保留舊密碼，明文及壞輸入拒絕；
8. signed `importUsers` 及 `getAllUsers` 不洩漏 hash；
9. 上游標籤不會成為工作表公式；
10. Code.gs／batch Code.gs 不留 release version 字樣。

執行：

```bash
npm run test:link
npm test
```

本地測試不能代替正式 GAS 真機驗收；新部署仍要實測 302 轉址、Drive 權限、Script Properties、`onOpen` 授權及正式 `/exec` 存取權。
