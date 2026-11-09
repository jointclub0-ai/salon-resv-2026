// 写真にキャッチコピー（短い文字）を重ねる。
// フォントは instagram/fonts/ に入れたものを使う（GitHub の実行環境には日本語フォントがないため）。

import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(here, "fonts");

// 文字の雰囲気。STYLES のキーを変えると見た目が変わる。
export const STYLES = {
  // 写真の下を暗くぼかして、白い丸文字
  band: {
    font: { file: "ZenMaruGothic-Bold.ttf", name: "Zen Maru Gothic Bold" },
    color: "#ffffff",
    sub: "#ffffffcc",
    backdrop: "gradient",
    shadow: true,
  },
  // 写真の下に白い帯を敷いて、こげ茶の丸文字
  white: {
    font: { file: "ZenMaruGothic-Bold.ttf", name: "Zen Maru Gothic Bold" },
    color: "#4a3b32",
    sub: "#4a3b32b3",
    backdrop: "box",
    shadow: false,
  },
  // 帯なし。上品な明朝体の白文字に、うっすら影
  mincho: {
    font: { file: "ShipporiMincho-Bold.ttf", name: "Shippori Mincho Bold" },
    color: "#ffffff",
    sub: "#ffffffd9",
    backdrop: "soft",
    shadow: true,
  },
};
export const DEFAULT_STYLE = "band";
const SIGNATURE = "JOINT CLUB  KOBE";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function renderText(text, opts) {
  const img = await renderOnce(text, opts);
  if (img.width <= opts.maxWidth) return img;
  // はみ出すときは、収まる大きさまで小さくする（途中で改行しない）
  const size = Math.floor(opts.size * (opts.maxWidth / img.width) * 0.98);
  return renderOnce(text, { ...opts, size, spacing: (opts.spacing * size) / opts.size });
}

async function renderOnce(text, { fontFile, fontName, size, color, spacing = 0 }) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}" letter_spacing="${Math.round(spacing * 1024)}">${esc(text)}</span>`,
      fontfile: fontFile,
      font: `${fontName} ${size}`,
      dpi: 72,
      rgba: true,
      align: "centre",
      spacing: Math.round(size * 0.25),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, size };
}

// 影（黒くぼかした文字）
async function shadowOf(img, blur, opacity) {
  const pad = Math.ceil(blur * 3);
  const { data, info } = await sharp(img.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = Math.round(data[i + 3] * opacity);
  }
  const out = await sharp(data, { raw: info }).blur(blur).png().toBuffer();
  return { data: out, pad };
}

function backdropSvg(kind, w, h, top) {
  if (kind === "gradient") {
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="0.45" stop-color="#000" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.6"/>
      </linearGradient></defs>
      <rect x="0" y="${top}" width="${w}" height="${h - top}" fill="url(#g)"/></svg>`;
  }
  if (kind === "soft") {
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.3"/>
      </linearGradient></defs>
      <rect x="0" y="${top}" width="${w}" height="${h - top}" fill="url(#g)"/></svg>`;
  }
  return null;
}

/**
 * 写真（JPEG）にキャッチコピーを重ねて上書き保存する。
 * @param {string} file   重ねる写真（prepare.mjs で整えたもの）
 * @param {string} text   キャッチコピー（改行で2行まで）
 * @param {string} [styleName]
 */
export async function overlayCatchCopy(file, text, styleName = DEFAULT_STYLE) {
  text = String(text || "").trim();
  if (!text) return false;
  const style = STYLES[styleName] || STYLES[DEFAULT_STYLE];
  const fontFile = path.join(FONT_DIR, style.font.file);
  if (!existsSync(fontFile)) throw new Error(`フォントが見つかりません: ${fontFile}`);

  const src = await sharp(file).toBuffer();
  const { width: W, height: H } = await sharp(src).metadata();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const longest = Math.max(...lines.map((l) => [...l].length));
  const margin = Math.round(W * 0.07);
  const maxWidth = W - margin * 2;
  // 1行の文字数に合わせて大きさを決める（短いほど大きく、最大で幅の 8%）
  const size = Math.round(Math.min(W * 0.08, (maxWidth / Math.max(longest, 1)) * 0.9));

  const main = await renderText(lines.join("\n"), {
    fontFile, fontName: style.font.name, size, color: style.color, maxWidth, spacing: size * 0.04,
  });
  const subSize = Math.round(W * 0.026);
  const sub = await renderText(SIGNATURE, {
    fontFile, fontName: style.font.name, size: subSize, color: style.sub, maxWidth, spacing: subSize * 0.25,
  });

  const gap = Math.round(subSize * 1.4);
  const bottom = Math.round(H * 0.06);
  const subTop = H - bottom - sub.height;
  const mainTop = subTop - gap - main.height;
  const layers = [];

  if (style.backdrop === "box") {
    const padY = Math.round(main.size * 0.55);
    const boxTop = Math.max(0, mainTop - padY);
    const boxH = H - boxTop;
    layers.push({
      input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="${boxTop}" width="${W}" height="${boxH}" fill="#fffaf3" fill-opacity="0.88"/></svg>`),
      top: 0, left: 0,
    });
  } else {
    const svg = backdropSvg(style.backdrop, W, H, Math.max(0, mainTop - Math.round(H * 0.18)));
    if (svg) layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }

  for (const [img, top, blur] of [[main, mainTop, main.size * 0.12], [sub, subTop, subSize * 0.2]]) {
    const left = Math.round((W - img.width) / 2);
    if (style.shadow) {
      const sh = await shadowOf(img, Math.max(1, blur), 0.55);
      layers.push({ input: sh.data, top: Math.max(0, top - sh.pad + Math.round(blur * 0.3)), left: Math.max(0, left - sh.pad) });
    }
    layers.push({ input: img.data, top, left });
  }

  await sharp(src).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toFile(file);
  return true;
}
