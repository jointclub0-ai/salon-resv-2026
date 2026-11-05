// queue.json の中身をチェックする。問題があればメッセージの配列を返す。
// 単体で実行すると結果を表示する:  node instagram/validate.mjs

import { readFileSync, existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
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

    if (p.caption != null && typeof p.caption !== "string") problems.push(`${where}: caption（本文）は文字で書いてください`);
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

// instagram/images/ に置いた写真のチェック（JPEG以外は投稿できない）
export function validateImageFolder(dir) {
  const problems = [];
  if (!existsSync(dir)) return problems;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || /\.txt$/i.test(name)) continue;
    const file = path.join(dir, name);
    if (!/\.jpe?g$/i.test(name) || !isJpeg(file)) {
      problems.push(`images/${name}: JPEG（.jpg）にしてください。iPhoneの写真は「互換性優先」で書き出すとJPEGになります`);
    } else if (statSync(file).size > 8 * 1024 * 1024) {
      problems.push(`images/${name}: 8MBを超えているので小さくしてください`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const queue = JSON.parse(readFileSync(path.join(here, "queue.json"), "utf8"));
  const problems = [...validateQueue(queue, path.resolve(here, "..")), ...validateImageFolder(path.join(here, "images"))];
  if (problems.length) {
    console.error("問題があります:\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("OK: 問題はありません。");
}
