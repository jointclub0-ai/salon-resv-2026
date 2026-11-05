// 写真を見て、Instagram の投稿文とハッシュタグを Claude に作ってもらう。
// 必要な環境変数: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const MODEL = process.env.CAPTION_MODEL || "claude-opus-5-5";
// これより大きい画像はファイルを直接送らず、公開URLで渡す
const MAX_INLINE_BYTES = 3.5 * 1024 * 1024;

const CaptionSchema = z.object({
  caption: z.string().describe("ハッシュタグを含まない本文"),
  hashtags: z.array(z.string()).describe("# を付けたハッシュタグ。10〜20個"),
});

function imageBlock(file, publicUrl) {
  if (existsSync(file) && statSync(file).size <= MAX_INLINE_BYTES) {
    return {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: readFileSync(file).toString("base64") },
    };
  }
  return { type: "image", source: { type: "url", url: publicUrl } };
}

/**
 * @param {object} opts
 * @param {{file: string, url: string}[]} opts.images  ローカルのパスと公開URL
 * @param {string} [opts.memo]       投稿についてのメモ（任意）
 * @param {string} opts.profile      お店の情報（salon-profile.md の中身）
 * @param {string[]} [opts.recent]   最近の投稿文（同じ書き出しを避けるため）
 */
export async function generateCaption({ images, memo, profile, recent = [] }) {
  const client = new Anthropic();

  const system = [
    "あなたは神戸の美容室のInstagram担当です。添付の写真について、そのお店の公式アカウントとして投稿する日本語の本文とハッシュタグを書きます。",
    "写真に写っていることと、メモ・お店の情報に書かれていることだけを根拠にしてください。価格、割引、日付、メニュー名などで、どこにも書かれていないものは書かないでください。",
    "お客様の顔や個人が特定できることには触れないでください。",
    "以下がお店の情報と文章の雰囲気です。\n\n" + profile,
  ].join("\n");

  const lines = [];
  if (memo) lines.push(`この投稿についてのメモ: ${memo}`);
  if (recent.length) {
    lines.push("最近の投稿です。書き出しや言い回しが同じにならないようにしてください:\n" + recent.map((r) => `- ${r.slice(0, 80)}`).join("\n"));
  }
  lines.push("この写真の投稿文とハッシュタグを作ってください。");

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(CaptionSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [
      {
        role: "user",
        content: [...images.map((i) => imageBlock(i.file, i.url)), { type: "text", text: lines.join("\n\n") }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("AIがこの写真の文章作成を断りました。別の写真にするか、caption を手で書いてください。");
  }
  const out = response.parsed_output;
  if (!out || !out.caption.trim()) {
    throw new Error(`AIの返事を読み取れませんでした（stop_reason: ${response.stop_reason}）。`);
  }
  const hashtags = [...new Set(out.hashtags.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  return { caption: out.caption.trim(), hashtags };
}

export function loadProfile(dir) {
  const file = path.join(dir, "salon-profile.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
