// 朝のプレビュー結果（preview.json）から、GitHub の Issue 本文を作って表示する。
//   node instagram/preview-issue.mjs preview.json owner/repo
import { readFileSync } from "node:fs";

const [file, repo] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, "utf8"));
const enc = (rel) => rel.split("/").map(encodeURIComponent).join("/");
const [y, m, d] = p.date.split("-").map(Number);
const wd = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

const lines = [];
lines.push(`今日 **${m}月${d}日（${wd}）19時** に、次の内容で Instagram（と Facebook ページ）に投稿する予定です。`);
lines.push("");
for (const img of p.images) {
  const src = /^https?:\/\//.test(img) ? img : `https://raw.githubusercontent.com/${repo}/main/${enc(img)}`;
  lines.push(`<img src="${src}" width="320">`);
}
lines.push("");
lines.push("### 投稿文");
lines.push("");
lines.push("```");
lines.push(p.caption);
lines.push("```");
lines.push("");
if (p.captionFile) {
  lines.push(`✏️ **文章を直したいとき**：[ここを開いて編集](https://github.com/${repo}/edit/main/${enc(p.captionFile)}) → 緑の「Commit changes」。19時にその文章で投稿されます。`);
}
lines.push("");
lines.push("🛑 **今日の投稿をやめたいとき**：その日のフォルダの写真を削除してください。");
lines.push("");
lines.push("このままでよければ、何もしなくて大丈夫です。投稿が終わるとこの Issue は自動で閉じます。");
console.log(lines.join("\n"));
