// queue.json の中身をチェックする。問題があればメッセージの配列を返す。
// 単体で実行すると結果を表示する:  node instagram/validate.mjs

import { readFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isJpeg(file) {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(3);
  readSync(fd, buf, 0, 3, 0);
  closeSync(fd);
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function validateQueue(queue, repoRoot) {
  const problems = [];
  if (!Array.isArray(queue)) return ["queue.json は [ ... ] の配列にしてください"];
  const ids = new Set();

  queue.forEach((p, i) => {
    const where = `${i + 1}件目${p && p.id ? `（${p.id}）` : ""}`;
    if (!p || typeof p !== "object") return problems.push(`${where}: 形式が正しくありません`);
    if (!p.id) problems.push(`${where}: id がありません`);
    else if (ids.has(p.id)) problems.push(`${where}: id が重複しています`);
    ids.add(p.id);

    if (!p.caption || typeof p.caption !== "string") problems.push(`${where}: caption（本文）がありません`);
    const tags = p.hashtags || [];
    if (!Array.isArray(tags)) problems.push(`${where}: hashtags は [ ... ] の配列にしてください`);
    else if (tags.length > 30) problems.push(`${where}: ハッシュタグは30個までです（${tags.length}個）`);

    const full = `${p.caption || ""}\n\n${(Array.isArray(tags) ? tags : []).join(" ")}`;
    if (full.length > 2200) problems.push(`${where}: 本文とハッシュタグの合計が2200文字を超えています`);

    if (p.notBefore && !/^\d{4}-\d{2}-\d{2}$/.test(p.notBefore)) {
      problems.push(`${where}: notBefore は 2026-11-10 の形式で書いてください`);
    }

    const images = [].concat(p.image || []);
    if (images.length === 0) problems.push(`${where}: image（画像）がありません`);
    if (images.length > 10) problems.push(`${where}: 画像は10枚までです`);
    for (const img of images) {
      if (/^https?:\/\//.test(img)) continue;
      const file = path.join(repoRoot, img.replace(/^\/+/, ""));
      if (!existsSync(file)) problems.push(`${where}: 画像が見つかりません: ${img}`);
      else if (!isJpeg(file)) problems.push(`${where}: 画像はJPEGにしてください: ${img}`);
    }
  });
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const queue = JSON.parse(readFileSync(path.join(here, "queue.json"), "utf8"));
  const problems = validateQueue(queue, path.resolve(here, ".."));
  if (problems.length) {
    console.error("問題があります:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log(`OK: ${queue.length}件の投稿予約に問題はありません。`);
}
