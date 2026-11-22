// 写真を Instagram に投稿できる形に整える。
// - iPhone の向き情報どおりに回転
// - 縦横比を Instagram の範囲（縦長 4:5 〜 横長 1.91:1）に中央で切り抜く
// - 幅を最大 1440px に縮小
// - 位置情報などの撮影データ（EXIF）を消す
// 出来上がりは instagram/processed/ に保存する。

import sharp from "sharp";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

// ---- 動画（リール） ----
// iPhone の .mov なども、Instagram が受け付ける形（H.264 / AAC の .mp4）に作り直す。
// - 長い辺を最大 1920px、30fps に
// - ファイルが大きくなりすぎないよう（GitHub に置けるのは 100MB まで）ビットレートを調整
// - 表紙用の画像（.cover.jpg）を1枚切り出す（AI の文章づくり・朝のお知らせ・リールの表紙に使う）


export const VIDEO_RE = /\.(mp4|mov|m4v)$/i;
export const isVideoName = (name) => VIDEO_RE.test(name);
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 15 * 60;
const TARGET_BYTES = 90 * 1024 * 1024;

export function probeVideo(src) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration", "-of", "json", src,
  ], { encoding: "utf8" });
  const j = JSON.parse(out);
  const s = (j.streams || [])[0] || {};
  return { duration: Number(j.format?.duration) || 0, width: s.width || 0, height: s.height || 0 };
}

// 動画の長さから、ファイルが約90MBに収まるビットレート（kbps、最大 8000）を決める
export function videoBitrate(seconds) {
  const total = Math.floor((TARGET_BYTES * 8) / 1000 / Math.max(seconds, 1));
  return Math.max(500, Math.min(8000, total - 128));
}

/**
 * @returns {Promise<{video: string, cover: string, duration: number}>}
 */
export async function prepareVideo(src, outDir) {
  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, path.basename(src).replace(/\.[^.]+$/, ""));
  const video = base + ".mp4";
  const cover = base + ".cover.jpg";
  const { duration } = probeVideo(src);
  if (duration && duration < MIN_SECONDS) {
    throw new Error(`${path.basename(src)}: 動画が短すぎます（${MIN_SECONDS}秒以上にしてください）`);
  }
  const seconds = Math.min(duration || MAX_SECONDS, MAX_SECONDS);
  const kbps = videoBitrate(seconds);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", src,
    "-map", "0:v:0", "-map", "0:a:0?", "-t", String(MAX_SECONDS),
    "-vf", "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-crf", "21",
    "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-map_metadata", "-1", "-movflags", "+faststart", video,
  ], { stdio: "inherit" });
  if (statSync(video).size > 95 * 1024 * 1024) {
    throw new Error(`${path.basename(src)}: 動画が長すぎて大きくなりました。短くしてください。`);
  }
  // 表紙：1秒目あたり（短い動画は真ん中あたり）の1コマ
  const at = Math.min(1, seconds / 3).toFixed(2);
  const raw = base + ".frame.jpg";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", at, "-i", video, "-frames:v", "1", "-q:v", "2", raw]);
  await sharp(raw).resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toFile(cover);
  rmSync(raw, { force: true });
  return { video, cover, duration: seconds };
}
