# 部署到 GitHub Pages（加密、公開網址、本機關機也活著）

這份把**唯讀展示網站**放到 GitHub Pages。本機只負責爬蟲，爬完 `git push`，親友就能用密碼看最新價格——**這台電腦關機，網站照樣活著**。

```
本機 (爬蟲)                         GitHub Pages (24h 常開)
scraper.js → cache/  ──build──►  docs/data/*.json (AES 加密)
                                        ▲
親友瀏覽器 ── 輸入密碼 ─ 解密 ─────────┘
```

## 安全性

- 資料用 **AES-256-GCM** 加密後才上傳；沒有密碼只會拿到亂碼。
- 密碼在**瀏覽器內解密**（PBKDF2 15 萬次 + Web Crypto），密碼本身不會傳到任何伺服器。
- 原始未加密的 `cache/` 已被 `.gitignore` 排除，**不會上傳**。
- 適合「親友共用一組密碼」的低敏感度分享。想要「個別 email 登入、可踢人」才需要 Cloudflare Access（要自己的網域）。

## 一次性設定

### 1. 設定分享密碼

編輯專案根目錄的 `.viewer-password`（此檔已 gitignore，不會上傳），把裡面的 `change-me-please` 改成你要的密碼。

### 2. 產生加密網站

```bash
npm run build:static      # 讀 cache/ → 產生加密的 docs/
```

### 3. 建 GitHub repo 並推上去

在 GitHub 網站建一個新的 repo（例如 `flight-search`，公開或私有皆可；免費版 Pages 需公開 repo），然後在本機：

```bash
git remote add origin https://github.com/<你的帳號>/flight-search.git
git add -A
git commit -m "feat: encrypted static site for GitHub Pages"
git branch -M main
git push -u origin main
```

### 4. 開啟 GitHub Pages

到 repo 的 **Settings → Pages**：
- **Source**: `Deploy from a branch`
- **Branch**: `main`　**Folder**: `/docs`
- 存檔，等 1~2 分鐘

網址會是：`https://<你的帳號>.github.io/flight-search/`
把網址 + 密碼給親友即可。

## 之後每次更新價格

```bash
npm run scrape-all -- --year=2026 --month=9 --stays=5,6,7   # 或用本機 UI 爬
npm run build:static                                        # 重新加密
git add -A && git commit -m "data: update prices" && git push
```

Windows 可直接雙擊 **`publish.bat`**（自動 build + commit + push）。

GitHub Pages 幾秒到 1 分鐘後自動更新，親友重新整理就看到新價格。

## 更換密碼

改 `.viewer-password` → `npm run build:static` → push。舊密碼即失效（親友需輸入新密碼）。
