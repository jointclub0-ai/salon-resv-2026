# Instagram 自動投稿

joint club の Instagram（@jointclub_kobe）に、**月・水・金・日の19時**に自動で投稿します。
**写真を `instagram/images/` に入れておくだけ**で、AI（Claude）が写真を見て投稿文とハッシュタグを考え、1回1枚ずつ投稿します。

## ふだんの使い方：写真を入れるだけ

1. GitHub でこのリポジトリを開き、`instagram/images` フォルダを開く
2. 右上の **Add file → Upload files** で写真（JPEG）をアップロードして **Commit changes** を押す
3. あとは自動です。名前順に1枚ずつ投稿されます（例：`01.jpg`, `02.jpg` … と付けると順番がわかりやすい）

**AIへのメモ（任意）**：写真と同じ名前の `.txt` を置くと、AIがその内容を文章に反映します。
例：`03.jpg` と一緒に `03.txt` に「ブリーチなしのダブルカラー。うねりが気になっていたお客様」と書く。

写真の注意：
- JPEG（.jpg）だけ投稿できます。iPhone は「設定 → カメラ → フォーマット → 互換性優先」にするとJPEGで撮れます
- 縦横比は 4:5（縦長）〜 1.91:1（横長）、8MB まで
- 一度投稿した写真は二度と投稿されません（記録は `posted.json`）
- 写真がなくなると投稿はお休みになります

## AIの文章の雰囲気を変える

`salon-profile.md` にお店の情報と文章の雰囲気が書いてあります。ここを書き換えると、AIの文章が変わります。
AIは、写真・メモ・このファイルに書かれていないこと（価格、キャンペーン、日付など）は書かないようにしてあります。

## 特別な投稿を予約する（上級者向け）

日付を決めたい投稿や、文章を自分で書きたい投稿は `queue.json` に書きます。`queue.json` の投稿は、フォルダの写真より先に投稿されます。

```json
{
  "id": "2026-12-campaign",
  "image": "instagram/images/xmas.jpg",
  "notBefore": "2026-12-01",
  "caption": "自分で書いた本文（書かなければAIが作ります）",
  "hashtags": ["jointclub", "神戸西区美容室"]
}
```

| 項目 | 内容 |
|---|---|
| `id` | 投稿ごとに違う名前（英数字とハイフン） |
| `image` | 画像の場所。2〜10枚を `["a.jpg", "b.jpg"]` と並べるとスワイプ投稿（カルーセル） |
| `caption` | 任意。本文。書かなければAIが作る |
| `memo` | 任意。AIへのメモ |
| `hashtags` | 任意。必ず入れたいハッシュタグ（30個まで） |
| `notBefore` | 任意。この日より前は投稿しない |
| `draft` | 任意。`true` の間は投稿しない（下書き） |

※ このフォルダの中身はホームページ上から見える場所にあります。公開前の秘密の内容は書かないでください。

## 最初の設定（1回だけ）

Instagram が「プロアカウント（ビジネス or クリエイター）」になっている必要があります。
（Instagramアプリのプロフィールに「プロフェッショナルダッシュボード」と出ていればOK）

GitHub のこのリポジトリで **Settings → Secrets and variables → Actions → New repository secret** から、次の3つを登録します。

| 名前 | 中身 | どこで手に入れるか |
|---|---|---|
| `IG_USER_ID` | Instagram アカウントのID | Meta for Developers（developers.facebook.com）でアプリを作って確認 |
| `IG_ACCESS_TOKEN` | Instagram の長期アクセストークン | 同上（投稿の権限 `instagram_business_content_publish` を付けて発行） |
| `ANTHROPIC_API_KEY` | AI（Claude）のAPIキー | platform.claude.com でキーを作成 |

「Instagramでログイン」方式でトークンを作った場合は、同じ画面の **Variables** タブで `IG_GRAPH_HOST` = `graph.instagram.com` も登録します。

Instagram の長期アクセストークンは約60日で切れます。切れると投稿が失敗し、GitHub からメールが届きます。

## 試しに動かす

GitHub の **Actions → Instagram 自動投稿 → Run workflow** を押します。
「ドライラン」にチェックが入ったままなら、次に投稿される写真と、AIが作った文章が表示されるだけで、実際には投稿されません。
チェックを外して実行すると、その場で1件投稿されます。

## 曜日・時間を変える

`.github/workflows/instagram-post.yml` の `cron` の行を変えます（時刻は日本時間−9時間）。
例：火・木・土・日の12時 → `0 3 * * 0,2,4,6`
