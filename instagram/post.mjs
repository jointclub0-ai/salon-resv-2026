// Instagram 自動投稿スクリプト
// 次の1件を投稿し、結果を posted.json に記録する。
//   1. queue.json の中で「まだ投稿していない・下書きでない・公開日を過ぎた」最初の1件
//   2. なければ instagram/images/ の写真を名前順に1枚
// 本文(caption)がなければ、AI（Claude）が写真を見て本文とハッシュタグを作る。
//
// 必要な環境変数:
//   IG_USER_ID       Instagram ビジネスアカウントのID
//   IG_ACCESS_TOKEN  長期アクセストークン
// 任意:
//   DRY_RUN=1        実際には投稿せず、投稿予定の内容だけ表示する
//   IG_GRAPH_HOST    既定 graph.facebook.com（Instagramログイン方式なら graph.instagram.com）
//   IG_API_VERSION   既定 v23.0
//   SITE_BASE_URL    既定 https://jointclub-kobe.com （画像の公開URLの元）
//   ANTHROPIC_API_KEY  本文(caption)がない投稿を AI に書いてもらうときに必要

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateQueue } from "./validate.mjs";
import { generateCaption, loadProfile } from "./caption.mjs";
import { prepareImage } from "./prepare.mjs";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const QUEUE = path.join(here, "queue.json");
const POSTED = path.join(here, "posted.json");
const IMAGES_DIR = path.join(here, "images");
const PROCESSED_DIR = path.join(here, "processed");

const DRY_RUN = ["1", "true", "yes"].includes(String(process.env.DRY_RUN || "").toLowerCase());
let HOST = process.env.IG_GRAPH_HOST || "graph.facebook.com";
let USER_ID = process.env.IG_USER_ID;
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

function isJpegFile(file) {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(3);
  readSync(fd, buf, 0, 3, 0);
  closeSync(fd);
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// instagram/images/ に置かれた写真を、名前順に投稿候補にする。
// 同じ名前の .txt があれば、その中身を AI へのメモとして使う（例: photo1.jpg と photo1.txt）。
export function folderPosts(dir = IMAGES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /\.jpe?g$/i.test(n) && !n.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "ja", { numeric: true }))
    .filter((n) => {
      const file = path.join(dir, n);
      return isJpegFile(file) && statSync(file).size <= 8 * 1024 * 1024;
    })
    .map((n) => {
      const memoFile = path.join(dir, n.replace(/\.jpe?g$/i, ".txt"));
      return {
        id: `images/${n}`,
        image: path.relative(repoRoot, path.join(dir, n)).split(path.sep).join("/"),
        memo: existsSync(memoFile) ? readFileSync(memoFile, "utf8").trim() : undefined,
      };
    });
}

// queue.json の投稿を先に、そのあと images/ フォルダの写真を順番に。
export function pickNext(queue, posted, today = todayJst(), folder = []) {
  const done = new Set(posted.map((p) => p.id));
  const fromQueue = queue.find((p) => !p.draft && !done.has(p.id) && (!p.notBefore || p.notBefore <= today));
  if (fromQueue) return fromQueue;
  // queue.json で使っている写真は、フォルダからは二重に投稿しない
  const used = new Set(queue.flatMap((p) => [].concat(p.image || [])));
  return folder.find((p) => !done.has(p.id) && !used.has(p.image));
}

async function api(method, endpoint, params, host = HOST) {
  const url = new URL(`https://${host}/${VERSION}/${endpoint}`);
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

// 整えた写真をリポジトリに保存して push し、すぐに見られる URL（raw.githubusercontent.com）を返す。
// GitHub Actions の外（手元のテストなど）では、ホームページの URL を返す。
async function hostImages(rels) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return rels.map(toPublicUrl);
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  git("add", ...rels);
  if (git("diff", "--cached", "--name-only")) {
    git("commit", "-m", "Instagram 用に写真を整えました");
    git("pull", "--rebase");
    git("push");
  }
  const sha = git("rev-parse", "HEAD");
  const urls = rels.map((r) => `https://raw.githubusercontent.com/${repo}/${sha}/${r.split("/").map(encodeURIComponent).join("/")}`);
  // push 直後に見えるようになるまで少し待つ
  for (const url of urls) {
    for (let i = 0; i < 12; i++) {
      const res = await fetch(url, { method: "HEAD" }).catch(() => null);
      if (res && res.ok) break;
      await sleep(5000);
    }
  }
  return urls;
}

// トークンの種類によって、使う API のサーバー（graph.facebook.com / graph.instagram.com）や
// アカウントIDの形が違うので、実際に問い合わせて使えるものを探す。
export async function resolveAccount() {
  const hosts = [...new Set([HOST, "graph.facebook.com", "graph.instagram.com"])];
  const notes = [];
  for (const host of hosts) {
    try {
      const r = await api("GET", USER_ID, { fields: "id,username" }, host);
      return { host, userId: r.id, username: r.username };
    } catch (e) {
      notes.push(`${host} / IG_USER_ID: ${e.message}`);
    }
  }
  // IG_USER_ID が合わない場合、トークンの持ち主から Instagram アカウントを探す
  try {
    const r = await api("GET", "me", { fields: "user_id,username" }, "graph.instagram.com");
    if (r.user_id) return { host: "graph.instagram.com", userId: String(r.user_id), username: r.username };
  } catch (e) {
    notes.push(`graph.instagram.com / me: ${e.message}`);
  }
  try {
    const r = await api("GET", "me/accounts", { fields: "instagram_business_account{id,username}" }, "graph.facebook.com");
    const ig = (r.data || []).map((p) => p.instagram_business_account).find(Boolean);
    if (ig) return { host: "graph.facebook.com", userId: ig.id, username: ig.username };
    notes.push("graph.facebook.com / me/accounts: Instagram アカウントが見つかりません");
  } catch (e) {
    notes.push(`graph.facebook.com / me/accounts: ${e.message}`);
  }
  // トークンの中身（権限と、許可された Instagram アカウントのID）を調べる
  try {
    const token = process.env.IG_ACCESS_TOKEN;
    const { data } = await api("GET", "debug_token", { input_token: token }, "graph.facebook.com");
    const targets = new Set();
    for (const g of data.granular_scopes || []) {
      if (g.scope.startsWith("instagram")) (g.target_ids || []).forEach((id) => targets.add(String(id)));
    }
    notes.push(`トークン: type=${data.type} valid=${data.is_valid} scopes=${(data.scopes || []).join(",")} instagram対象ID=${[...targets].join(",") || "なし"}`);
    for (const id of targets) {
      try {
        const r = await api("GET", id, { fields: "id,username" }, "graph.facebook.com");
        if (r.username) return { host: "graph.facebook.com", userId: r.id, username: r.username };
        // ID が Facebook ページの場合は、つながっている Instagram アカウントを見る
        const p = await api("GET", id, { fields: "instagram_business_account{id,username}" }, "graph.facebook.com");
        if (p.instagram_business_account) return { host: "graph.facebook.com", userId: p.instagram_business_account.id, username: p.instagram_business_account.username };
      } catch (e) {
        notes.push(`graph.facebook.com / ${id}: ${e.message}`);
      }
    }
  } catch (e) {
    notes.push(`graph.facebook.com / debug_token: ${e.message}`);
  }
  try {
    const me = await api("GET", "me", { fields: "id,name" }, "graph.facebook.com");
    notes.push(`トークンの持ち主: ${me.name || ""}（${me.id}）`);
  } catch (e) {
    notes.push(`graph.facebook.com / me: ${e.message}`);
  }
  throw new Error("Instagram アカウントに接続できませんでした。\n- " + notes.join("\n- "));
}

async function publish(imageUrls, caption) {
  const user = USER_ID;
  const images = imageUrls;
  let creationId;

  if (images.length === 1) {
    const { id } = await api("POST", `${user}/media`, { image_url: images[0], caption });
    creationId = id;
  } else {
    const children = [];
    for (const img of images) {
      const { id } = await api("POST", `${user}/media`, { image_url: img, is_carousel_item: "true" });
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

  const post = pickNext(queue, posted, todayJst(), folderPosts());
  if (!post) {
    console.log("::warning::投稿できる写真がありません。instagram/images/ に写真を追加してください。");
    return;
  }

  console.log(`次の投稿: ${post.id}`);

  // 写真を Instagram の縦横比などに合わせて整える（URL で指定した画像はそのまま）
  const prepared = [];
  for (const img of [].concat(post.image)) {
    if (/^https?:\/\//.test(img)) {
      prepared.push({ url: img });
      continue;
    }
    const out = await prepareImage(path.join(repoRoot, img.replace(/^\/+/, "")), PROCESSED_DIR);
    prepared.push({ file: out, rel: path.relative(repoRoot, out).split(path.sep).join("/") });
  }
  console.log(`画像: ${prepared.map((p) => p.rel || p.url).join(", ")}`);

  let full = { ...post };
  if (!post.caption) {
    if (!process.env.ANTHROPIC_API_KEY) {
      if (DRY_RUN) {
        console.log("本文: （AIが作る予定。ANTHROPIC_API_KEY がないので、ドライランでは作りません）");
        return;
      }
      console.error("本文がない投稿です。AIに書いてもらうには ANTHROPIC_API_KEY を GitHub の Secrets に設定してください。");
      process.exit(1);
    }
    const profile = loadProfile(here);
    const recent = posted.slice(-5).map((p) => p.caption).filter(Boolean);
    const images = prepared.map((p) => ({ file: p.file || "", url: p.url || toPublicUrl(p.rel) }));
    const ai = await generateCaption({ images, memo: post.memo, profile, recent });
    // 手で指定したハッシュタグがあれば、それを先に並べる
    full = { ...post, caption: ai.caption, hashtags: [...new Set([...(post.hashtags || []), ...ai.hashtags])].slice(0, 30) };
    console.log("（本文はAIが作りました）");
  }

  const caption = buildCaption(full);
  console.log("本文:\n" + caption);

  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    if (DRY_RUN) {
      console.log("\n[ドライラン] 実際の投稿はしていません。");
      return;
    }
    console.error("IG_USER_ID と IG_ACCESS_TOKEN を GitHub の Secrets に設定してください。");
    process.exit(1);
  }

  const account = await resolveAccount();
  HOST = account.host;
  USER_ID = account.userId;
  console.log(`\nInstagram 接続OK: @${account.username || "?"}（${HOST}）`);
  if (USER_ID !== process.env.IG_USER_ID) {
    console.log("::notice::IG_USER_ID とは別のIDで接続しました。Secrets の IG_USER_ID を直すとこの表示は消えます。");
  }

  if (DRY_RUN) {
    console.log("\n[ドライラン] 実際の投稿はしていません。");
    return;
  }

  const local = prepared.filter((p) => p.rel).map((p) => p.rel);
  const hosted = local.length ? await hostImages(local) : [];
  const imageUrls = prepared.map((p) => (p.url ? p.url : hosted[local.indexOf(p.rel)]));
  const { mediaId, permalink } = await publish(imageUrls, caption);
  posted.push({ id: post.id, mediaId, permalink: permalink || null, postedAt: new Date().toISOString(), caption });
  await writeFile(POSTED, JSON.stringify(posted, null, 2) + "\n");
  console.log(`投稿しました: ${permalink || mediaId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
