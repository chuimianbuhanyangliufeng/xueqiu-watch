# 雪球自选股变动监控

监控雪球用户 **7143769715** 的默认自选股，检测到**新增/移除股票**时通过 Server酱 推送到微信。

## 架构

```
GitHub Actions（每30分钟）
  → 带你的雪球Cookie 读取该用户默认自选股
  → 与 snapshot.json 上次快照比对
  → 有变动 → Server酱 → 微信「方糖」公众号收到推送
  → 无变动 → 静默结束
  → Cookie失效 → 微信推送提醒你更新
```

## 首次部署步骤（约10分钟）

### 1. 创建 GitHub 私有仓库
新建一个 **Private** 仓库（如 `xueqiu-watch`），把本目录所有文件传上去（含 `.github` 文件夹和 `index.mjs`，不要传 snapshot.json——首次运行会自动生成）。

### 2. 配置 Secrets
仓库 → Settings → Secrets and variables → Actions → New repository secret，添加两个：

| 名称 | 值 | 获取方式 |
|---|---|---|
| `XUEQIU_COOKIE` | 雪球登录Cookie整段 | 浏览器登录 xueqiu.com → F12 → Network → 刷新 → 点任意 xueqiu.com 请求 → Request Headers 里复制 `Cookie:` 后面的全部内容 |
| `SENDKEY` | Server酱 SendKey | 微信扫码登录 https://sct.ftqq.com → 首页复制 SendKey（首次会引导关注「方糖」公众号） |

### 3. 首次运行验证
仓库 → Actions → `xueqiu-watch` → Run workflow 手动触发一次。
成功后微信会收到「雪球自选股监控已启动」+ 当前全部持仓列表，即验证通过。

## Cookie 过期后怎么办

Cookie 失效当天会收到微信提醒「⚠️ 雪球Cookie已失效」，更新只需 1 分钟：

1. 浏览器重新登录雪球网页版，照旧复制新 Cookie
2. 仓库 → Settings → Secrets → 点 `XUEQIU_COOKIE` → Update
3. Actions 页手动 Run workflow 验证一次

## 本地运行（可选调试）

```bash
set XUEQIU_COOKIE=粘贴cookie
set SENDKEY=粘贴SendKey
node index.mjs
```

## 注意事项

- 仓库必须设为 **Private**（Cookie 存在 Secrets 里不会泄露，但私有更稳妥）
- GitHub Actions 定时任务在高负载时段可能有几分钟延迟，属正常现象
- 免费版 Server酱 每天 5 条推送上限；变动频繁时会自动合并为一条
- 若雪球改版导致接口字段变化，`index.mjs` 中已做兼容处理；如失效可人工核对接口返回结构
