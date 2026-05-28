# 天主教會愛德人才服務平台

一個讓堂區、教區、善會可以登錄人才、發布服務需求、自動媒合志工的平台。

## 系統概念

- **教友端**:登錄個人專長 → 願意接受邀請 → 等候堂區或活動單位邀請
- **單位端**:申請活動需求 → 系統自動推薦人選 → 寄發 LINE/Email 邀請
- **管理端**:審核資料、媒合、產生服務名單、看到人才分布與缺口

## 技術架構

| 層 | 技術 | 原因 |
|---|---|---|
| 前端 | 純 HTML + Vanilla JS | 部署簡單,堂區工作人員容易維護 |
| 後端 | Node.js + Express | 生態成熟,Airtable 官方 SDK |
| 資料庫 | Airtable | 非工程師可直接編輯,降低維運成本 |
| AI | Anthropic Claude API | 專長標準化、邀請文案生成 |
| 認證 | JWT | 簡單、無 session 依賴 |

## 目錄結構

```
catholic-talent-platform/
├── server/
│   ├── index.js              主程式進入點
│   ├── airtable.js           Airtable 封裝層 (所有 Token 都在這裡)
│   ├── middleware/auth.js    JWT 認證中介
│   ├── routes/
│   │   ├── people.js         教友資料 + 專長 + 服務經驗
│   │   ├── needs.js          需求 + 媒合 + 通聯紀錄
│   │   └── admin.js          堂區、技能字典、登入、報表
│   └── services/
│       ├── matching.js       自動推薦演算法
│       ├── invitation.js     LINE/Email 邀請文案
│       └── reports.js        分布、缺口分析
├── public/
│   ├── index.html            首頁 (角色入口)
│   ├── register.html         教友登錄表單
│   ├── update.html           資料更新
│   ├── needs.html            單位需求申請
│   ├── login.html            管理者登入
│   ├── admin.html            管理者查詢
│   ├── matching.html         媒合操作
│   ├── roster.html           活動服務名單
│   ├── dashboard.html        人才分布與缺口
│   ├── css/style.css
│   └── js/common.js          共用 API 呼叫
├── .env.example
├── package.json
└── README.md
```

## 部署步驟

### 1. 建立 Airtable Base
依 README 的「Airtable 欄位設計」建立 8 張表。建議:
- 表名先用英文(`People`、`Parishes`...),欄位名可用中文。
- 在 People 表的「所屬堂區」欄位設成 **Link to Parishes**。
- 「所需專長」設成 **Link to Skills(允許多筆)**。

### 2. 取得 Personal Access Token
1. 進入 <https://airtable.com/create/tokens>
2. 建立 Token,Scope 至少勾選 `data.records:read`、`data.records:write`、`schema.bases:read`
3. Access 加入這個 Base
4. 複製 Token(只顯示一次)

### 3. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env,填入 PAT、Base ID、JWT_SECRET、管理員密碼 hash
```

產生管理員密碼 hash:
```bash
node -e "console.log(require('bcryptjs').hashSync('你的密碼', 10))"
```

### 4. 啟動
```bash
npm install
npm start         # 正式
npm run dev       # 開發 (nodemon)
```

開啟 <http://localhost:3000>

## API 路徑總覽

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/auth/login` | 公開 | 管理者登入,回 JWT |
| POST | `/api/people` | 公開 | 教友登錄(建立) |
| GET | `/api/people` | 管理 | 條件查詢 |
| GET | `/api/people/:id` | 管理 | 單筆 |
| PUT | `/api/people/:id` | 管理 | 更新 |
| POST | `/api/people/self-update` | 公開(用 token 連結) | 教友更新自己 |
| POST | `/api/people-skills` | 公開 | 新增/更新個人專長 |
| POST | `/api/needs` | 公開 | 單位需求申請 |
| GET | `/api/needs` | 管理 | 列出需求 |
| GET | `/api/needs/:id/recommend` | 管理 | 自動推薦人選 |
| POST | `/api/matching` | 管理 | 確認媒合 |
| POST | `/api/matching/:id/invite` | 管理 | 產生邀請文 |
| GET | `/api/needs/:id/roster` | 管理 | 服務名單 |
| GET | `/api/reports/distribution` | 管理 | 人才分布 |
| GET | `/api/reports/gaps` | 管理 | 缺口分析 |

## 安全與權限

- **Token 不外露**:所有 Airtable 呼叫都在 server。前端永遠只跟 `/api/*` 對話。
- **角色分流**:公開頁面(register、update、needs)允許未登入者送出表單;管理頁面(admin、matching、dashboard)需要 JWT。
- **個資同意**:登錄表單必須勾選同意聲明才能送出(前端強制 + 後端驗證)。
- **速率限制**:對公開的 POST 端點加上 rate-limit,避免機器人灌爆。
- **個人專屬連結**:教友自己更新資料用一次性 token (`/update?t=xxx`),避免對外開放可任意改別人。

## 後續維運建議

見文末「後續維運建議」。
