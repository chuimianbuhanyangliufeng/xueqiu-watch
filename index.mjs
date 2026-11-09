// 雪球自选股变动监控 + Server酱微信推送
// 用法：node index.mjs
// 环境变量：
//   XUEQIU_COOKIE  - 雪球网页版登录 Cookie（整段复制）
//   SENDKEY        - Server酱 SendKey (https://sct.ftqq.com)
//   TARGET_UID     - 要监控的雪球用户 ID（默认 7143769715）
//   SNAPSHOT_FILE  - 快照文件路径（默认 ./snapshot.json）

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TARGET_UID = process.env.TARGET_UID || "7143769715";
const COOKIE = process.env.XUEQIU_COOKIE || "";
const SENDKEY = process.env.SENDKEY || "";
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || "snapshot.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

class CookieExpiredError extends Error {}
class ApiError extends Error {}

async function api(url) {
  const res = await fetch(url, {
    headers: {
      Cookie: COOKIE,
      "User-Agent": UA,
      Referer: `https://xueqiu.com/u/${TARGET_UID}`,
      Accept: "application/json, text/plain, */*",
    },
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new CookieExpiredError(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new ApiError(`HTTP ${res.status} @ ${url}`);
  const data = await res.json();
  // 雪球未登录错误码 400016
  if (data.error_code === 400016 || data.error_code === 400010) {
    throw new CookieExpiredError(data.error_description || "未登录");
  }
  if (data.error_code && data.error_code !== 0 && data.error_code !== "0") {
    throw new ApiError(`error_code=${data.error_code} ${data.error_description || ""}`);
  }
  return data;
}

async function pushWeixin(title, desp) {
  if (!SENDKEY) {
    console.log(`[dry-run 推送] ${title}\n${desp}`);
    return;
  }
  const body = new URLSearchParams({ title, desp });
  const res = await fetch(`https://sctapi.ftqq.com/${SENDKEY}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const out = await res.json().catch(() => ({}));
  if (out.code === 0) {
    console.log("微信推送成功");
  } else {
    console.error("微信推送失败:", JSON.stringify(out));
    process.exitCode = 1;
  }
}

// 找到该用户的默认自选股分组 pid（"全部"分组）
async function getDefaultPid() {
  try {
    const data = await api(
      `https://stock.xueqiu.com/v5/stock/portfolio/list.json?uid=${TARGET_UID}&size=20&page=1`
    );
    const groups = data?.data?.stocks || [];
    if (groups.length > 0) {
      const def =
        groups.find((p) => p.id === -1) ||
        groups.find((p) => (p.name || "") === "全部") ||
        groups[0];
      if (def && def.id != null) {
        console.log(`默认自选股分组: ${def.name} pid=${def.id} 共${def.symbol_count ?? "?"}只`);
        return def.id;
      }
    }
  } catch (e) {
    console.warn(`获取分组列表失败(${e.message})，回退到默认 pid=-1`);
  }
  return -1; // 雪球股票自选股"全部"分组 pid
}

// 拉取自选股列表，返回 Map(symbol -> {name, created})
async function fetchWatchlist(pid) {
  const data = await api(
    `https://stock.xueqiu.com/v5/stock/portfolio/stock/list.json?pid=${pid}&category=1&uid=${TARGET_UID}&size=1000&page=1`
  );
  const stocks = data?.data?.stocks || [];
  const map = new Map();
  for (const s of stocks) {
    const code = s.symbol || s.stock_id;
    if (!code) continue;
    map.set(code, {
      name: s.name || code,
      created: s.created ?? null,
    });
  }
  return map;
}

function loadSnapshot() {
  if (!existsSync(SNAPSHOT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function pctStr(p) {
  if (p == null) return "";
  return `${p >= 0 ? "+" : ""}${Number(p).toFixed(2)}%`;
}

function codeStr(v) {
  return v.symbol ?? "";
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  if (!COOKIE) {
    console.error("缺少 XUEQIU_COOKIE 环境变量");
    process.exitCode = 1;
    return;
  }

  const pid = await getDefaultPid();
  const now = fetchWatchlist(pid);
  const nowMap = await now;
  console.log(`当前自选股共 ${nowMap.size} 只`);

  const prev = loadSnapshot();

  if (!prev) {
    // 首次运行：建立基线
    const lines = [...nowMap.values()].map((v) => {
      const d = fmtDate(v.created);
      return `- ${v.name}（${codeStr(v)}${d ? "，加入于 " + d : ""}）`;
    });
    writeFileSync(
      SNAPSHOT_FILE,
      JSON.stringify({ updatedAt: new Date().toISOString(), stocks: Object.fromEntries(nowMap) }, null, 2)
    );
    await pushWeixin(
      "雪球自选股监控已启动",
      `已建立基线快照，当前【用户 ${TARGET_UID}】默认自选股共 **${nowMap.size}** 只：\n\n${lines.join("\n")}\n\n后续有增删变动会推送到这里。`
    );
    return;
  }

  const prevMap = new Map(Object.entries(prev.stocks));
  const added = [];
  const removed = [];

  for (const [code, info] of nowMap) {
    if (!prevMap.has(code)) {
      const d = fmtDate(info.created);
      added.push(`${info.name}（${code}${d ? "，加入于 " + d : ""}）`);
    }
  }
  for (const [code, info] of prevMap) {
    if (!nowMap.has(code)) {
      removed.push(`${info.name}（${code}）`);
    }
  }

  if (added.length === 0) {
    if (removed.length > 0) {
      // 仅移除：静默更新快照，不推送
      console.log(`移除 ${removed.length} 只（按要求不推送）: ${removed.join("、")}`);
      writeFileSync(
        SNAPSHOT_FILE,
        JSON.stringify({ updatedAt: new Date().toISOString(), stocks: Object.fromEntries(nowMap) }, null, 2)
      );
    } else {
      console.log("自选股无变动");
    }
    return;
  }

  const parts = [`**➕ 新买入/加入（${added.length}）**\n\n${added.join("\n\n")}`];
  if (removed.length) parts.push(`（另有移除 ${removed.length} 只：${removed.join("、")}，仅作记录）`);

  await pushWeixin(
    `自选股变动：新增${added.length}`,
    `【雪球用户 ${TARGET_UID}】默认自选股发生变动（现共 ${nowMap.size} 只）：\n\n${parts.join("\n\n---\n\n")}`
  );

  writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), stocks: Object.fromEntries(nowMap) }, null, 2)
  );
  console.log("快照已更新");
}

main().catch(async (e) => {
  if (e instanceof CookieExpiredError) {
    console.error("雪球 Cookie 已失效:", e.message);
    await pushWeixin(
      "⚠️ 雪球Cookie已失效",
      `监控任务无法读取【用户 ${TARGET_UID}】的自选股（${e.message}）。\n\n请尽快更新：\n1. 浏览器重新登录雪球网页版\n2. F12 → Network → 复制任意请求的 Cookie\n3. GitHub 仓库 Settings → Secrets → 更新 XUEQIU_COOKIE`
    );
    process.exitCode = 1;
  } else {
    console.error("运行失败:", e.message || e);
    process.exitCode = 1;
  }
});
