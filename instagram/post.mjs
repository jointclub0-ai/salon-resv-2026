// Instagram 自動投稿スクリプト
// queue.json の中から「まだ投稿していない・下書きでない・公開日を過ぎた」最初の1件を投稿し、
// 結果を posted.json に記録する。
//
// 必要な環境変数:
//   IG_USER_ID       Instagram ビジネスアカウントのID
//   IG_ACCESS_TOKEN  長期アクセストークン
// 任意:
//   DRY_RUN=1        実際には投稿せず、投稿予定の内容だけ表示する
//   IG_GRAPH_HOST    既定 graph.facebook.com（Instagramログイン方式なら graph.instagram.com）
//   IG_API_VERSION   既定 v23.0
//   SITE_BASE_URL    既定 https://jointclub-kobe.com （画像の公開URLの元）

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateQueue } from "./validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const QUEUE = path.join(here, "queue.json");
const POSTED = path.join(here, "posted.json");

const DRY_RUN = ["1", "true", "yes"].includes(String(process.env.DRY_RUN || "").toLowerCase());
const HOST = process.env.IG_GRAPH_HOST || "graph.facebook.com";
const VERSION = process.env.IG_API_VERSION || "v23.0";
const SITE = (process.env.SITE_BASE_URL || "https://jointclub-kobe.com").replace(/\/$/, "");

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

// 画像のパス（リポジトリ内）を公開URLに変換。http(s) で始まる場合はそのまま。
export function toPublicUrl(image) {
  if (/^https?:\/\//.test(image)) return image;
  const rel = image.replace(/^\/+/, "");
  return `${SITE}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function buildCaption(post) {
  const tags = (post.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return [post.caption.trim(), tags].filter(Boolean).join("\n\n");
}

// 今日（日本時間）の日付 YYYY-MM-DD
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function pickNext(queue, posted, today = todayJst()) {
  const done = new Set(posted.map((p) => p.id));
  return queue.find((p) => !p.draft && !done.has(p.id) && (!p.notBefore || p.notBefore <= today));
}

async function api(method, endpoint, params) {
  const url = new URL(`https://${HOST}/${VERSION}/${endpoint}`);
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  const res = method === "GET"
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Instagram API エラー: ${endpoint}: ${msg}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// コンテナの処理完了を待つ（画像の取り込みに数秒かかることがある）
async function waitReady(containerId) {
  for (let i = 0; i < 20; i++) {
    const { status_code } = await api("GET", containerId, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`メディアの準備に失敗しました（${status_code}）。画像URLが公開されているか、JPEGか確認してください。`);
    }
    await sleep(3000);
  }
  throw new Error("メディアの準備がタイムアウトしました。");
}

async function publish(post) {
  const user = process.env.IG_USER_ID;
  const images = [].concat(post.image);
  const caption = buildCaption(post);
  let creationId;

  if (images.length === 1) {
    const { id } = await api("POST", `${user}/media`, { image_url: toPublicUrl(images[0]), caption });
    creationId = id;
  } else {
    const children = [];
    for (const img of images) {
      const { id } = await api("POST", `${user}/media`, { image_url: toPublicUrl(img), is_carousel_item: "true" });
      await waitReady(id);
      children.push(id);
    }
    const { id } = await api("POST", `${user}/media`, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
    creationId = id;
  }

  await waitReady(creationId);
  const { id: mediaId } = await api("POST", `${user}/media_publish`, { creation_id: creationId });
  const { permalink } = await api("GET", mediaId, { fields: "permalink" }).catch(() => ({}));
  return { mediaId, permalink };
}

async function main() {
  const queue = await readJson(QUEUE, []);
  const posted = await readJson(POSTED, []);

  const problems = validateQueue(queue, repoRoot);
  if (problems.length) {
    console.error("queue.json に問題があります:\n- " + problems.join("\n- "));
    process.exit(1);
  }

  const post = pickNext(queue, posted);
  if (!post) {
    console.log("投稿できる予約がありません（queue.json に新しい投稿を追加してください）。");
    return;
  }

  console.log(`次の投稿: ${post.id}`);
  console.log(`画像: ${[].concat(post.image).map(toPublicUrl).join(", ")}`);
  console.log("本文:\n" + buildCaption(post));

  if (DRY_RUN) {
    console.log("\n[ドライラン] 実際の投稿はしていません。");
    return;
  }
  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    console.error("IG_USER_ID と IG_ACCESS_TOKEN を GitHub の Secrets に設定してください。");
    process.exit(1);
  }

  const { mediaId, permalink } = await publish(post);
  posted.push({ id: post.id, mediaId, permalink: permalink || null, postedAt: new Date().toISOString() });
  await writeFile(POSTED, JSON.stringify(posted, null, 2) + "\n");
  console.log(`投稿しました: ${permalink || mediaId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
