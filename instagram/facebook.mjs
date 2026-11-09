// Facebook ページへの投稿（Instagram と同じ写真・同じ文章）
//
// 環境変数:
//   FB_PAGE_ID            Facebook ページのID（既定: Joint Club 1136009469592981）。"off" にすると Facebook には投稿しない
//   FB_PAGE_ACCESS_TOKEN  任意。Facebook 用のトークン。なければ IG_ACCESS_TOKEN を使う
//                         （システムユーザーのトークンに pages_manage_posts などの権限が必要）

const VERSION = process.env.IG_API_VERSION || "v23.0";
const DEFAULT_PAGE_ID = "1136009469592981";

export function facebookPageId() {
  const v = String(process.env.FB_PAGE_ID || "").trim();
  if (["off", "no", "false", "0"].includes(v.toLowerCase())) return null;
  return v || DEFAULT_PAGE_ID;
}

async function fb(method, endpoint, params, token) {
  const url = `https://graph.facebook.com/${VERSION}/${endpoint}`;
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET" ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Facebook API エラー: ${endpoint}: ${msg}`);
  }
  return json;
}

// ページに投稿するための「ページ用トークン」を手に入れる。
export async function connectPage(pageId = facebookPageId()) {
  const base = process.env.FB_PAGE_ACCESS_TOKEN || process.env.IG_ACCESS_TOKEN;
  if (!base) throw new Error("トークン（FB_PAGE_ACCESS_TOKEN か IG_ACCESS_TOKEN）がありません。");
  const notes = [];
  try {
    const r = await fb("GET", pageId, { fields: "id,name,access_token" }, base);
    // access_token が返らないときは、渡したトークン自体がページ用トークン
    return { pageId: r.id, name: r.name, token: r.access_token || base };
  } catch (e) {
    notes.push(e.message);
  }
  try {
    const r = await fb("GET", "me/accounts", { fields: "id,name,access_token", limit: "100" }, base);
    const p = (r.data || []).find((x) => x.id === pageId);
    if (p) return { pageId: p.id, name: p.name, token: p.access_token };
    notes.push(`me/accounts にページ ${pageId} がありません（見えるページ: ${(r.data || []).map((x) => x.name).join(",") || "なし"}）`);
  } catch (e) {
    notes.push(e.message);
  }
  try {
    const r = await fb("GET", "me/permissions", {}, base);
    const granted = (r.data || []).filter((p) => p.status === "granted").map((p) => p.permission);
    notes.push(`トークンの権限: ${granted.join(",") || "なし"}`);
  } catch {
    // 調べられなくても続ける
  }
  throw new Error("Facebook ページに接続できませんでした。\n- " + notes.join("\n- "));
}

// 写真（公開URL）と文章をページに投稿する。1枚なら写真投稿、2枚以上なら複数写真の投稿。
export async function publishToFacebook(page, imageUrls, message) {
  let postId;
  if (imageUrls.length === 1) {
    const r = await fb("POST", `${page.pageId}/photos`, { url: imageUrls[0], message }, page.token);
    postId = r.post_id || r.id;
  } else {
    const params = { message };
    for (const [i, url] of imageUrls.entries()) {
      const { id } = await fb("POST", `${page.pageId}/photos`, { url, published: "false" }, page.token);
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    }
    const r = await fb("POST", `${page.pageId}/feed`, params, page.token);
    postId = r.id;
  }
  const { permalink_url } = await fb("GET", postId, { fields: "permalink_url" }, page.token).catch(() => ({}));
  return { postId, permalink: permalink_url || null };
}
