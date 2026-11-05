// 写真を Instagram に投稿できる形に整える。
// - iPhone の向き情報どおりに回転
// - 縦横比を Instagram の範囲（縦長 4:5 〜 横長 1.91:1）に中央で切り抜く
// - 幅を最大 1440px に縮小
// - 位置情報などの撮影データ（EXIF）を消す
// 出来上がりは instagram/processed/ に保存する。

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const MIN_RATIO = 4 / 5; // これより縦長はダメ
const MAX_RATIO = 1.91; // これより横長はダメ
const MAX_WIDTH = 1440;

export function cropBox(width, height) {
  const ratio = width / height;
  if (ratio < MIN_RATIO) {
    const h = Math.floor(width / MIN_RATIO);
    return { left: 0, top: Math.floor((height - h) / 2), width, height: h };
  }
  if (ratio > MAX_RATIO) {
    const w = Math.floor(height * MAX_RATIO);
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  return null;
}

/**
 * @param {string} src     元の写真のパス
 * @param {string} outDir  保存先フォルダ
 * @returns {Promise<string>} 整えた写真のパス
 */
export async function prepareImage(src, outDir) {
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, path.basename(src).replace(/\.[^.]+$/, "") + ".jpg");

  // 向きを直した後の大きさを知るため、一度回転だけした画像を作る
  const rotated = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;

  let img = sharp(rotated.data);
  const box = cropBox(width, height);
  if (box) img = img.extract(box);
  await img
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(out);
  return out;
}
