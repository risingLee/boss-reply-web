# 职场回复助手 - Web版

一键生成高情商职场回复。

## 部署到 Vercel

### 1. 推送到 GitHub
```bash
cd boss-reply-web
git init
git add .
git commit -m "init"
git remote add origin https://github.com/你的用户名/boss-reply-web.git
git push -u origin main
```

### 2. 导入到 Vercel
1. 打开 https://vercel.com
2. Import Project → 选这个仓库
3. 添加环境变量：
   - `HUNYUAN_SECRET_ID` = 你的腾讯云 SecretId
   - `HUNYUAN_SECRET_KEY` = 你的腾讯云 SecretKey
4. Deploy

### 3. 完成
部署后会得到一个 `xxx.vercel.app` 域名，直接访问就能用。

## 本地测试
需要安装 Vercel CLI：
```bash
npm i -g vercel
vercel dev
```

## 绑定自定义域名（可选）
Vercel 后台 → Settings → Domains → 添加你的域名
