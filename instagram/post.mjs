// Instagram 自動投稿スクリプト
// 次の1件を投稿し、結果を posted.json に記録する。
//   1. queue.json の中で「まだ投稿していない・下書きでない・公開日を過ぎた」最初の1件
//   2. instagram/images/ の写真（名前が日付なら、その日以降に投稿。フォルダならまとめてスワイプ投稿）
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
//   FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN  Facebook ページにも同じ内容を投稿する（facebook.mjs を参照）

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateQueue } from "./validate.mjs";
import { generateCaption, loadProfile } from "./caption.mjs";
import { prepareImage } from "./prepare.mjs";
import { connectPage, facebookPageId, publishToFacebook } from "./facebook.mjs";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const QUEUE = path.join(here, "queue.json");
const POSTED = path.join(here, "posted.json");
const IMAGES_DIR = path.join(here, "images");
const PROCESSED_DIR = path.join(here, "processed");
// 朝のプレビューで作った投稿文。この名前のファイルがあれば、AIは使わずこの文章をそのまま投稿する。
export const CAPTION_FILE = "投稿文.txt";
const PREVIEW = ["1", "true", "yes"].includes(String(process.env.PREVIEW || "").toLowerCase());

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

// 日本時間の「時」
export function jstHour(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).getUTCHours();
}

// 自動実行してよい時間帯か（お知らせ 8〜18時 / 投稿 19〜24時、日本時間）
export function inWindow(kind, now = Date.now()) {
  const h = jstHour(now);
  return kind === "preview" ? h >= 8 && h < 18 : h >= 19;
}

// 日本時間でその日に投稿した記録があるか
export function postedOn(posted, day) {
  return posted.some(
    (p) => p.postedAt && new Date(Date.parse(p.postedAt) + 9 * 3600 * 1000).toISOString().slice(0, 10) === day,
  );
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
// フォルダごと入れると、その中の写真（2〜10枚）をまとめて1回のスワイプ投稿にする。
// フォルダの中の .txt は、その投稿の AI へのメモになる。
const isPostableJpeg = (file) => isJpegFile(file) && statSync(file).size <= 8 * 1024 * 1024;
const byName = (a, b) => a.localeCompare(b, "ja", { numeric: true });
const toRel = (file) => path.relative(repoRoot, file).split(path.sep).join("/");

export function folderPosts(dir = IMAGES_DIR) {
  if (!existsSync(dir)) return [];
  const posts = [];
  for (const n of readdirSync(dir).filter((n) => !n.startsWith(".")).sort(byName)) {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) {
      const files = readdirSync(full).filter((f) => !f.startsWith("."));
      const photos = files
        .filter((f) => /\.jpe?g$/i.test(f))
        .sort(byName)
        .map((f) => path.join(full, f))
        .filter(isPostableJpeg)
        .slice(0, 10);
      if (photos.length === 0) continue;
      const memo = files
        .filter((f) => /\.txt$/i.test(f) && f !== CAPTION_FILE)
        .sort(byName)
        .map((f) => readFileSync(path.join(full, f), "utf8").trim())
        .filter(Boolean)
        .join("\n");
      posts.push({
        id: `images/${n}/`,
        notBefore: dateFromName(n),
        captionFile: toRel(path.join(full, CAPTION_FILE)),
        image: photos.length === 1 ? toRel(photos[0]) : photos.map(toRel),
        memo: memo || undefined,
      });
    } else if (/\.jpe?g$/i.test(n) && isPostableJpeg(full)) {
      const memoFile = path.join(dir, n.replace(/\.jpe?g$/i, ".txt"));
      posts.push({
        id: `images/${n}`,
        notBefore: dateFromName(n),
        captionFile: toRel(path.join(dir, n.replace(/\.jpe?g$/i, "") + "." + CAPTION_FILE)),
        image: toRel(full),
        memo: existsSync(memoFile) ? readFileSync(memoFile, "utf8").trim() : undefined,
      });
    }
  }
  return posts;
}

// 名前の先頭の日付（2026-11-20 / 2026.11.20 / 20261120 など）を YYYY-MM-DD にする。なければ undefined。
export function dateFromName(name) {
  const m = /^(\d{4})([-._])(\d{1,2})\2(\d{1,2})(?!\d)/.exec(name) || /^(\d{4})()(\d{2})(\d{2})(?!\d)/.exec(name);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[3]), Number(m[4])];
  if (y < 2020 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// いつもの投稿日（月・水・金・日）かどうか（日本時間）
export function isRegularDay(today = todayJst()) {
  return [0, 1, 3, 5].includes(new Date(`${today}T00:00:00Z`).getUTCDay());
}

// 次に投稿するものを選ぶ。
//   1. queue.json の投稿（公開日を過ぎたもの）
//   2. images/ の「日付つき」の写真・フォルダで、その日付を過ぎたもの（古い日付から）
//   3. いつもの投稿日なら、images/ の日付なしの写真・フォルダを名前順に
// いつもの投稿日以外は、日付つきのものだけ投稿する。
export function pickNext(queue, posted, today = todayJst(), folder = [], regularDay = true) {
  const done = new Set(posted.map((p) => p.id));
  const fromQueue = queue.find(
    (p) => !p.draft && !done.has(p.id) && (p.notBefore ? p.notBefore <= today : regularDay),
  );
  if (fromQueue) return fromQueue;
  // queue.json で使っている写真は、フォルダからは二重に投稿しない
  const used = new Set(queue.flatMap((p) => [].concat(p.image || [])));
  const open = folder.filter((p) => !done.has(p.id) && ![].concat(p.image).some((i) => used.has(i)));
  const dated = open
    .filter((p) => p.notBefore && p.notBefore <= today)
    .sort((a, b) => a.notBefore.localeCompare(b.notBefore));
  if (dated.length) return dated[0];
  return regularDay ? open.find((p) => !p.notBefore) : undefined;
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
  // システムユーザーのトークンの場合、ビジネスポートフォリオ経由で Instagram アカウントを探す
  try {
    const r = await api("GET", "me/businesses", {
      fields: "id,name,owned_instagram_accounts{id,username},instagram_business_accounts{id,username}",
    }, "graph.facebook.com");
    const found = [];
    for (const b of r.data || []) {
      for (const ig of [...(b.owned_instagram_accounts?.data || []), ...(b.instagram_business_accounts?.data || [])]) {
        found.push(`${ig.username || "?"}（${ig.id}）`);
        if (ig.username) return { host: "graph.facebook.com", userId: ig.id, username: ig.username };
      }
    }
    notes.push(`graph.facebook.com / me/businesses: ${(r.data || []).map((b) => b.name).join(",") || "なし"} / Instagram: ${found.join(",") || "なし"}`);
  } catch (e) {
    notes.push(`graph.facebook.com / me/businesses: ${e.message}`);
  }
  try {
    const r = await api("GET", "me/permissions", {}, "graph.facebook.com");
    const granted = (r.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
    notes.push(`許可されている権限: ${granted.join(",") || "なし"}`);
  } catch (e) {
    notes.push(`graph.facebook.com / me/permissions: ${e.message}`);
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

  const today = todayJst();
  const manual = process.env.MANUAL_RUN === "1";
  const regularDay = manual || isRegularDay(today);
  // 自動実行は予備の時刻にも起動するので、今日すでに投稿していたら何もしない
  // GitHub の自動実行は何時間も遅れることがあるので、決まった時間帯の外なら何もしない
  // （お知らせは 8〜18時、投稿は 19〜24時。手動実行はいつでも動く）
  if (!manual && !inWindow(PREVIEW ? "preview" : "post")) {
    console.log(`::warning::自動実行が予定の時間帯の外（日本時間 ${jstHour()}時）に起動したので何もしません。`);
    return;
  }
  if (!manual && postedOn(posted, today)) {
    console.log("今日はもう投稿済みです。");
    return;
  }
  const post = pickNext(queue, posted, today, folderPosts(), regularDay);
  if (!post) {
    if (regularDay) console.log("::warning::投稿できる写真がありません。instagram/images/ に写真を追加してください。");
    else console.log("今日はいつもの投稿日ではなく、今日の日付の写真もないのでお休みです。");
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
  const captionPath = post.captionFile && path.join(repoRoot, post.captionFile);
  const savedCaption = captionPath && existsSync(captionPath) ? readFileSync(captionPath, "utf8").trim() : "";
  if (savedCaption) {
    // 朝に確認・修正された投稿文をそのまま使う
    full = { ...post, caption: savedCaption, hashtags: [] };
    console.log(`（本文は ${post.captionFile} を使います）`);
  } else if (!post.caption) {
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

  if (PREVIEW) {
    // 朝のプレビュー：投稿文をファイルに保存して、確認・修正できるようにする（投稿はしない）
    if (captionPath && !savedCaption) await writeFile(captionPath, caption + "\n");
    if (process.env.PREVIEW_OUT) {
      await writeFile(process.env.PREVIEW_OUT, JSON.stringify({
        date: today,
        id: post.id,
        images: [].concat(post.image),
        caption,
        captionFile: post.captionFile || null,
      }, null, 2));
    }
    console.log("\n[プレビュー] 投稿はしていません。");
    return;
  }

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

  // Facebook ページにもつながるか確認（つながらなくても Instagram の投稿は続ける）
  const fbPageId = facebookPageId();
  let fbPage = null;
  if (fbPageId) {
    try {
      fbPage = await connectPage(fbPageId);
      console.log(`Facebook 接続OK: ${fbPage.name || fbPageId}`);
    } catch (e) {
      console.log(`::warning::Facebook ページにつながらないので、Facebook への投稿はしません。${e.message.replace(/\n/g, " ")}`);
    }
  }

  if (DRY_RUN) {
    console.log("\n[ドライラン] 実際の投稿はしていません。");
    return;
  }

  const local = prepared.filter((p) => p.rel).map((p) => p.rel);
  const hosted = local.length ? await hostImages(local) : [];
  const imageUrls = prepared.map((p) => (p.url ? p.url : hosted[local.indexOf(p.rel)]));
  const { mediaId, permalink } = await publish(imageUrls, caption);
  const record = { id: post.id, mediaId, permalink: permalink || null, postedAt: new Date().toISOString(), caption };
  posted.push(record);
  await writeFile(POSTED, JSON.stringify(posted, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "posted=1\n");
  console.log(`投稿しました: ${permalink || mediaId}`);

  if (fbPage) {
    try {
      const fbr = await publishToFacebook(fbPage, imageUrls, caption);
      record.facebookPostId = fbr.postId;
      record.facebookPermalink = fbr.permalink;
      await writeFile(POSTED, JSON.stringify(posted, null, 2) + "\n");
      console.log(`Facebook にも投稿しました: ${fbr.permalink || fbr.postId}`);
    } catch (e) {
      console.log(`::warning::Instagram には投稿しましたが、Facebook への投稿に失敗しました。${e.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
