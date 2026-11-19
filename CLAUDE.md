# CLAUDE.md

joint club（神戸市西区の美容室）のホームページ・予約フォーム・Instagram 自動投稿をまとめたリポジトリ。
Claude が作業するときの引き継ぎメモ。**仕組みを変えたら、このファイルも同じ変更の中で直すこと。**

## オーナーへの説明のしかた

- オーナー（みや）は美容師で、プログラムや GitHub の用語には詳しくない。説明は日本語で短く、「どの画面の・どのボタンを押すか」まで書く。
- ブラウザの自動翻訳で GitHub の画面が日本語になっていることがある（例：Closed →「閉店」）。スクリーンショットはその前提で読む。

## 公開と注意

- GitHub Pages で https://jointclub-kobe.com/ に公開（`CNAME`）。`main` に入ると1〜2分で反映される。ビルドはなく、HTML をそのまま配信する。
- **このリポジトリは公開設定。** パスワード、トークン、売上や委託料などお店の内部情報はファイルにもコミットメッセージにも書かない。鍵類は GitHub の Secrets にだけ置く。
- `main` には Instagram の自動実行（instagram-bot）が1日に何度もコミットする。push の前に必ず `git pull --rebase`。

## 配置

| 場所 | 中身 |
|---|---|
| `index.html` | お店のホームページ（トップ） |
| `access/` `menu/` `stylist/` `blog/` | ホームページの各ページ（トップからのリンク先はこちら） |
| `stylist/photos/`、ルートの `*.jpg` | ページで使う写真 |
| `reservation/index.html` | Repeater Fair（専売品の予約販売フェア）の予約フォーム。LINE（LIFF）から開く |
| `firestore.rules` | 予約フォーム用の Firestore ルール。**ファイルを変えても反映されない**。Firebase コンソールに貼り付けて「公開」する必要がある |
| `instagram/` | Instagram・Facebook 自動投稿のプログラムと写真（詳しくは `instagram/README.md`） |
| `.github/workflows/instagram-*.yml` | 自動投稿・朝の確認・チェックの自動実行 |
| `.claude/skills/repeater-fair-campaign/` | フェアの準備手順（予約フォームの日付・割引の書き換え、LINE 用画像など）。フェア関連の作業ではこのスキルを使う |

`reservation/` の中にある `access/` `menu/` `stylist/` `blog/` と画像は、ルートの同名ファイルと同じ内容の複製（2026-11 時点）。
サイトのリンクはルート側を指しているので、ホームページを直すときはルート側を直す。複製を消すかどうかはオーナーに確認してから。

## 予約フォーム（`reservation/index.html`）

- 1ファイルで完結する静的ページ。Firebase の匿名ログインで予約を送り、Firestore の `artifacts/salon-resv-2026/public/data/reservations` に保存する。
- 管理画面は Firebase Authentication のスタッフ用アカウントでログインする。パスワードはページに書かない（書かせない）。
- 受付の締め切りは、フォーム側の表示と `firestore.rules` の期限の両方で管理している。片方だけ変えない。

## Instagram 自動投稿（`instagram/`）

- 月・水・金・日の19時に、`instagram/images/` の写真を1件ずつ投稿し、同じ内容を Facebook ページにも投稿する。投稿文とキャッチコピーは Claude（API）が作る。
- 投稿日の朝8時に、その日の予定を GitHub の Issue でお知らせする。オーナーはそこで `投稿文.txt`・`キャッチコピー.txt` を直せる。
- 日付フォルダ（例 `images/2026-11-20(金)/`）は自動で約4か月先まで作られ、過ぎた日の空フォルダは自動で消える。手で作り直さない。
- `instagram/posted.json` は投稿済みの記録。手で書き換えると二重投稿や投稿漏れになるので触らない。
- AI の文章の雰囲気とお店の情報は `instagram/salon-profile.md`。AI はここに書いていない価格・キャンペーン・日付は書かない決まり。
- GitHub の自動実行は遅れるため、外部タイマー（cron-job.org）からも起動している。曜日・時刻を変えるときは workflow の `cron` と外部タイマーの両方を見直す。
- 使う Secrets：`IG_USER_ID`、`IG_ACCESS_TOKEN`、`ANTHROPIC_API_KEY`（任意で `FB_PAGE_ACCESS_TOKEN`）。Variables：`IG_CATCH_STYLE`、`FB_PAGE_ID`、`IG_GRAPH_HOST`。

### 確認のしかた

```bash
cd instagram && npm ci
node validate.mjs                 # queue.json のチェック
DRY_RUN=1 node post.mjs           # 次に投稿される内容の確認（実際には投稿しない）
```

`instagram/` を変える PR では「Instagram 投稿予約のチェック」が自動で走る。実際に投稿される操作（`DRY_RUN` なしの実行、Actions の手動実行でドライランを外す）は、オーナーに確認してから。

## 決まりごと

- 画面の文字、コメント、コミットメッセージは日本語。
- ビルドや外部フレームワークは入れない（HTML・CSS・JavaScript をそのまま書く。Instagram 用の Node.js スクリプトだけ npm を使う）。
- お店の情報（店名・場所・予約先など）を変えるときは、ホームページ・予約フォーム・`instagram/salon-profile.md` の該当箇所をそろえる。
