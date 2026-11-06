// 投稿カレンダー：instagram/images/ に、これからの投稿日（月・水・金・日）の空フォルダを作る。
//   例: images/2026-11-06(金)/
// フォルダに写真を入れると、その日の19時に投稿される（2枚以上ならスワイプ投稿）。
// 過ぎた日の空フォルダは片付ける。毎日の自動投稿のときにも実行されるので、カレンダーは自動で先に伸びる。
//
// 使い方: node instagram/calendar.mjs [日数]   （既定 120日 = 約4か月先まで）

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(here, "images");
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const POST_DAYS = [0, 1, 3, 5]; // 日・月・水・金

function jstDate(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
}
const ymd = (d) => d.toISOString().slice(0, 10);

export function calendarNames(days = 120, start = jstDate()) {
  const names = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400 * 1000);
    if (POST_DAYS.includes(d.getUTCDay())) names.push(`${ymd(d)}(${WEEKDAYS[d.getUTCDay()]})`);
  }
  return names;
}

// 中身が .gitkeep だけ（写真もメモもない）フォルダか
function isEmptyFolder(dir) {
  return readdirSync(dir).every((n) => n === ".gitkeep" || n === ".DS_Store");
}

export function updateCalendar(dir = IMAGES_DIR, days = 120) {
  mkdirSync(dir, { recursive: true });
  const today = ymd(jstDate());
  const created = [];
  const removed = [];
  for (const name of calendarNames(days)) {
    const folder = path.join(dir, name);
    if (existsSync(folder)) continue;
    // 同じ日付で始まるフォルダ（名前を変えたもの）があれば作らない
    if (readdirSync(dir).some((n) => n.startsWith(name.slice(0, 10)))) continue;
    mkdirSync(folder);
    writeFileSync(path.join(folder, ".gitkeep"), "");
    created.push(name);
  }
  for (const name of readdirSync(dir)) {
    const folder = path.join(dir, name);
    const date = /^\d{4}-\d{2}-\d{2}/.exec(name)?.[0];
    if (date && date < today && statSync(folder).isDirectory() && isEmptyFolder(folder)) {
      rmSync(folder, { recursive: true });
      removed.push(name);
    }
  }
  return { created, removed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const days = Number(process.argv[2]) || 120;
  const { created, removed } = updateCalendar(IMAGES_DIR, days);
  console.log(`カレンダー: 新しく作ったフォルダ ${created.length}件${created.length ? "（" + created.join(", ") + "）" : ""}`);
  if (removed.length) console.log(`過ぎた空フォルダを片付けました: ${removed.join(", ")}`);
}
