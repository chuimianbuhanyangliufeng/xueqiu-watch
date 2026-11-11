// 本地定时运行入口：时间窗口闸门 + 与 GitHub 快照同步 + 执行监控
// 由 Windows 任务计划每 5 分钟调用；设置 FORCE_RUN=1 可无视窗口立即执行（测试用）
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- 读取本地凭据 .env.local（不入库） ----
function loadEnv() {
  const p = path.join(DIR, ".env.local");
  const env = {};
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    console.error("缺少 .env.local，无法运行");
    process.exit(1);
  }
  return env;
}

// ---- 窗口闸门：周一~周五 9:20-14:30 ----
function inWindow() {
  const now = new Date();
  const day = now.getDay(); // 0=周日 6=周六
  if (day === 0 || day === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 9 * 60 + 20 && mins <= 14 * 60 + 30;
}

function git(args) {
  return execSync("git " + args, { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

const env = loadEnv();

if (process.env.FORCE_RUN !== "1" && !inWindow()) {
  process.exit(0); // 静默退出，不打日志
}

const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
console.log(`\n===== ${now} 本地运行 =====`);

const COMMITTER = '-c user.name=local-bot -c user.email=local@bot';

// 1) 先把上次运行遗留的未提交快照落盘成 commit（防 pull 被脏工作区挡住）
try {
  if (git("status --porcelain snapshot.json")) {
    git(`add snapshot.json`);
    git(`${COMMITTER} commit -m "chore: 本地快照更新 [skip ci]"`);
  }
} catch {}

// 2) 与云端同步；若快照冲突，谁的时间戳新用谁
try {
  git("pull --rebase -X ours origin main");
  console.log("已同步云端快照");
} catch {
  try { git("rebase --abort"); } catch {}
  try {
    const remoteSnap = git("show origin/main:snapshot.json");
    const localSnap = readFileSync(path.join(DIR, "snapshot.json"), "utf8");
    const rT = JSON.parse(remoteSnap).updatedAt || "";
    const lT = JSON.parse(localSnap).updatedAt || "";
    if (rT > lT) {
      // 云端更新（PC关机期间云端兜底跑过）→ 采用云端版本作为比对基线
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path.join(DIR, "snapshot.json"), remoteSnap);
      git("add snapshot.json");
      git(`${COMMITTER} commit -m "chore: 采用云端较新快照 [skip ci]"`);
      console.log("已采用云端较新快照作为基线");
    } else {
      console.log("与云端快照有分叉，以本地较新版本为准");
    }
  } catch (e) {
    console.warn("云端同步失败(用本地快照继续):", String(e.message).slice(0, 150));
  }
}

// 执行监控主脚本
const r = spawnSync(
  process.execPath,
  ["index.mjs"],
  {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      XUEQIU_COOKIE: env.XUEQIU_COOKIE,
      SENDKEY: env.SENDKEY,
      TARGET_UID: "7143769715",
      SNAPSHOT_FILE: "snapshot.json",
    },
  }
);

// 快照有变化则提交推回，供云端兜底运行使用（防重复推送）
try {
  const st = git("status --porcelain snapshot.json");
  if (st) {
    git("add snapshot.json");
    git(`${COMMITTER} commit -m "chore: 本地快照更新 [skip ci]"`);
    try {
      git("push");
      console.log("快照已推回云端");
    } catch {
      git("fetch origin");
      git("rebase -X ours origin/main"); // 冲突时以本地较新快照为准
      git("push");
      console.log("快照已推回云端(经rebase)");
    }
  }
} catch (e) {
  console.warn("快照提交失败(不影响推送结果):", String(e.stderr || e.message).slice(0, 200));
}

process.exit(r.status ?? 0);
