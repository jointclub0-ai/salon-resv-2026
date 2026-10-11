---
name: repeater-fair-campaign
description: joint club（神戸の美容室）の「Repeater Fair」シャンプー・トリートメント予約キャンペーンを準備・開始・締め切りまで進める手順。予約フォーム（reservation/index.html）の季節・割引・日付の書き換え、自動締め切り、Firestore ルール、LINE リッチメニュー画像・配信画像・お知らせ文・自動応答、テスト予約と配信の案内までを扱う。ユーザーが「次のキャンペーン」「フェアの準備」「Spring/Summer/Winter の予約」「リッチメニューを作って」「お知らせ文」「受付を締め切りたい」「予約フォームの日付を変えて」などと言ったら、名前を出さなくても必ずこのスキルを使うこと。
---

# Repeater Fair キャンペーン準備

joint club がリピーター向けに年数回行う、サロン専売品の予約販売フェアを準備する。
オーナー（みや）は美容師で、コードやクラウドの用語には詳しくない。説明は日本語で短く、
「どの画面の・どのボタンを押すか」を具体的に書く。スクリーンショットが送られてきたら、
そこに写っている事実（入力欄の書きかけ文字も含む）を読み取ってから答える。

## システム構成（前提）

| 役割 | 場所 |
|---|---|
| 予約フォーム | `reservation/index.html` → https://jointclub-kobe.com/reservation/（GitHub Pages、main に push すると1〜2分で反映） |
| LINE からの入口 | LIFF `https://liff.line.me/2010337371-g1ra1deL`（エンドポイントは `/reservation/`） |
| 予約データ | Firebase プロジェクト `salon-resv-2026` の Firestore `artifacts/salon-resv-2026/public/data/reservations` |
| 管理画面ログイン | Firebase Auth `staff@jointclub-kobe.com`（パスワードはお店が管理。会話に書かせない） |
| リッチメニュー | 6分割。A・B＝予約(LIFF)、C＝Lupinus LINE `https://lin.ee/29RAl65`、D＝`https://jointclub-kobe.com/`、E＝ホットペッパー `https://beauty.hotpepper.jp/slnH000320550/coupon/`、F＝Instagram `https://www.instagram.com/jointclub_kobe/` |

Firebase と LINE の管理画面は Claude からは操作できない。そこはユーザーに手順を渡す。

## 手順

### 1. 今回の内容を聞く

足りないものだけ聞く（一度にまとめて）:
- 季節名（例: Spring / Summer / Winter）
- 予約受付の締切日
- お渡し開始日
- 割引（例: 全商品20%OFF）と、商品・価格を変えるか
- 商品写真を差し替えるか（なければ `assets/product-photo-w.jpg` を使う）

曜日は自分で計算して確かめる（`date -d 2026-11-30 +%a`）。

### 2. 予約フォームを書き換える（`reservation/index.html`）

`git pull` してから、`grep -n` で次をすべて探して更新する:
- `<title>` とナビの `<h1>`（`Repeater Fair {年} {季節}`）
- フォーム上部のキャンペーン案内ブロック（見出し・受付期限・お渡し日）
- 合計欄下の注意書き「お支払いは…以降」
- 完了画面「…以降のご来店時に」
- LINE 確認メッセージ `msg`（【ご予約確認】の見出しとお渡し日）
- `const DEADLINE = new Date("YYYY-MM-DDT00:00:00+09:00")`（締切日の**翌日** 0:00 JST）
- 受付終了画面 `#closedView` のお渡し日

触らないもの:
- `liff.sendMessages` の2通目 `"予約を確定しました"`。LINE 自動応答はキーワード**完全一致**でしか反応しないので、この固定文をきっかけにしている。
- 価格の考え方: `listPrice` は SalonBoard の定価、`price` は割引後（20%OFF なら定価×0.8 を10円未満切り捨て）。割引率は自動計算で表示される。価格を変えるときはこの規則で両方そろえる。

画像ファイルを追加するときは、ファイル名を NFC に正規化する（Mac からのアップロードで「ぐ」が「く＋゛」になり、HTML と一致せず画像が出なかった前例がある）。

確認: `<script type="module">` 部分を取り出して `node --check` で文法チェックする。
コミットして `git push origin main`。

### 3. Firestore ルールを更新する

`references/templates.md` の「3. Firestore ルール」に新しい締切ミリ秒を入れ、
リポジトリの `firestore.rules` も同じ内容にしてコミットする。
ユーザーには「Firebase → Firestore → ルール → ⌘A で全消し → 貼り付け → 公開」を案内する。
締切日はフォームの `DEADLINE` とルールの2か所にあり、両方そろって初めて確実に締め切れる。

### 4. 画像を作る

```bash
python3 .claude/skills/repeater-fair-campaign/scripts/make_images.py \
  --season WINTER --headline 全商品 --discount 20%OFF \
  --deadline "11/30（月）" --handover "12/5（土）" \
  --out <scratchpad>/campaign-images
```

できるもの（すべて LINE の上限 1MB 以内）:
- `richmenu.png` 2500×1686 リッチメニュー
- `broadcast.jpg` 1080×1350 お知らせ配信用（画像内のボタンは飾り。リンクはテキストで付ける）
- `richmessage.jpg` 1040×1040 リッチメッセージ用（画像全体を予約リンクにできる）

生成したら縮小版を自分で見て崩れがないか確かめてから、SendUserFile で渡す。
Lupinus の「初回20%OFF」帯は、続いているか分からなければユーザーに確認する（`--lupinus-badge ""` で消せる）。

### 5. LINE 側の作業を案内する

順番に、1つずつ画面を確認しながら進める:
1. **前回の予約データをリセット**: 予約フォームの「管理」タブ →「次のキャンペーンにリセット」。前回分と混ざらないように、開始前に必ず。
2. **リッチメニュー**: 前回のものを「コピー」→ 画像を差し替え → タイトル・表示期間（開始日〜締切日）を設定 → A〜F のリンクが上の表どおりか確認。表示期間に入った時点でお客様に見えるので、準備が整ってから開始日にする。
3. **自動応答**: `references/templates.md` の 2。前回分があればお渡し日だけ直す。
   - 設定 → 応答設定で、応答時間内も「手動チャット＋応答メッセージ」になっているか。
   - Default（一律応答「個別のお問い合わせは受け付けておりません」）が**利用停止**か。オンだと営業時間内のお客様にも返ってしまう。
4. **テスト予約**: iPhone の LINE で、お店のトークの**リッチメニューから**予約する（Keep メモから開くと確認メッセージが Keep メモに送られてしまう）。自分の吹き出し2通＋お店からの自動返信が届けば成功。終わったら管理画面で削除。
5. **お知らせ配信**: 文面は `references/templates.md` の 1。配信先は「すべての友だち」（「絞り込み」のままになっていないか確認）。テスト配信の送り先に本人が出ない場合は、右下の「プレビュー」と Keep メモでのリンク確認で代用してよい。

### 6. 記録を残す

- Obsidian の `Projects/joint-club.md` 用の更新文を `references/templates.md` の 4 から作って渡す（Vault は Mac 本体が正本。Drive のバックアップは書き換えない）。
- GitHub Desktop で「Fetch origin → Pull origin」して Mac を最新にするよう伝える。

## つまずきやすい点

- Safari の **⌘+Shift+R はリーダー表示** の切り替え。キャッシュ無視の再読み込みは **⌘+Option+R**。
- Firestore ルールは Claude からは反映できない。push しただけでは締め切りはフォーム側だけになる。
- 管理画面は Firebase ログインなので、パスワードをコードや会話に書かない。
- お店のアカウントから予約内容入りのメッセージを送りたいと言われたら、Messaging API ＋ Cloud Functions が必要（Messaging API の有効化は元に戻せない）。進める前に必ずユーザーの判断を仰ぐ。
