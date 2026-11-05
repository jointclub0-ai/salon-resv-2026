# Instagram 自動投稿

joint club の Instagram（@jointclub_kobe）に、**月・水・金・日の19時**に自動で投稿します。
投稿したい画像と文章を `queue.json` に並べておくと、上から順に1回1件ずつ投稿されます。

## しくみ

1. 画像をこのリポジトリに置く → ホームページ（jointclub-kobe.com）で公開される
2. 決まった曜日・時間に GitHub が `post.mjs` を動かす
3. Instagram の公式API（Graph API）で投稿し、結果を `posted.json` に記録する
   （一度投稿したものは二度と投稿されません）

## 投稿を追加する

1. 画像（JPEG、縦横比は 4:5〜1.91:1）を `instagram/images/` に入れる
2. `queue.json` に1件追加する

```json
{
  "id": "2026-11-ombre",
  "image": "instagram/images/ombre.jpg",
  "caption": "本文をここに。\n改行は \\n と書きます。",
  "hashtags": ["jointclub", "神戸西区美容室", "髪質改善"]
}
```

| 項目 | 内容 |
|---|---|
| `id` | 投稿ごとに違う名前（英数字とハイフン） |
| `image` | 画像の場所。2〜10枚を `["a.jpg", "b.jpg"]` と並べるとスワイプ投稿（カルーセル） |
| `caption` | 本文 |
| `hashtags` | ハッシュタグ（30個まで、`#` はなくてもOK） |
| `notBefore` | 任意。この日（例 `2026-12-01`）より前は投稿しない |
| `draft` | 任意。`true` の間は投稿しない（下書き） |

`queue.json` を保存して main に入ると、自動でチェックが走り、書き間違いがあれば教えてくれます。
※ `queue.json` はホームページ上から見える場所にあります。公開前の秘密の内容は書かないでください。

## 最初の設定（1回だけ）

Instagram が「プロアカウント（ビジネス or クリエイター）」になっている必要があります。

1. Meta for Developers（developers.facebook.com）でアプリを作り、Instagram の投稿権限
   （`instagram_business_content_publish` など）を付けて**長期アクセストークン**を発行する
2. Instagram アカウントの **ID** を確認する
3. GitHub のこのリポジトリで **Settings → Secrets and variables → Actions → New repository secret** から次の2つを登録する
   - `IG_USER_ID` … Instagram アカウントのID
   - `IG_ACCESS_TOKEN` … 長期アクセストークン
4. 「Instagramでログイン」方式でトークンを作った場合だけ、同じ画面の **Variables** タブで
   `IG_GRAPH_HOST` = `graph.instagram.com` を登録する

長期アクセストークンは約60日で切れます。切れると投稿が失敗し、GitHub からメールが届きます。

## 試しに動かす

GitHub の **Actions → Instagram 自動投稿 → Run workflow** を押します。
「ドライラン」にチェックが入ったままなら、次に投稿される内容が表示されるだけで、実際には投稿されません。
チェックを外して実行すると、その場で1件投稿されます。

## 曜日・時間を変える

`.github/workflows/instagram-post.yml` の `cron` の行を変えます（時刻は日本時間−9時間）。
例：火・木・土・日の12時 → `0 3 * * 0,2,4,6`
