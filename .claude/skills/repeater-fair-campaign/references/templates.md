# 文面・ルールのひな形

`{季節}` `{締切}` などを今回の値に置き換えて使う。曜日は `date -d 2026-11-30 +%a` などで必ず確かめる。

## 1. LINE お知らせ配信文（画像の下に付けるテキスト）

```
【Repeater Fair {年} {季節} 開催のお知らせ】

いつもjoint clubをご利用いただきありがとうございます✨
サロン専売のシャンプー・トリートメント・アウトバスが
{割引の対象}{割引}でご予約いただけるフェアを開催します！

📅 予約受付：{締切の月日（曜）}まで
🛍 お渡し：{お渡し開始の月日（曜）}以降のご来店時
💳 お支払い：店頭でのお受け取り時

▼ご予約はこちら
https://liff.line.me/2010337371-g1ra1deL

トーク画面下のメニュー「LINEで予約する」からもご予約いただけます。
乾燥が気になる方は［W］、うねり・広がりが気になる方は［オイルK］がおすすめです{季節の絵文字}

joint club
```

## 2. 自動応答（応答メッセージ）

- 応答タイプ: キーワード応答
- キーワード: `予約を確定しました`（予約フォームが2通目に送る固定文。完全一致でしか反応しない）
- メッセージ:

```
ご予約ありがとうございます😊
ご注文内容を確認いたしました。

{お渡し開始の月日（曜）}以降のご来店時にお渡しいたします。
お支払いは店頭でのお受け取り時となります。

ご変更・キャンセルはお電話にて承ります。
お会いできるのを楽しみにしております！

joint club
```

前回の自動応答が残っていれば、新しく作らずにお渡し日だけ書き換えてもらう。

## 3. Firestore ルール（Firebase コンソールに貼る全文）

`{締切ミリ秒}` は「締切日の翌日 0:00 JST」のエポックミリ秒。
`node -e 'console.log(new Date("2026-12-01T00:00:00+09:00").getTime())'` で出す。
リポジトリの `firestore.rules` も同じ内容に更新する。

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null
        && request.auth.token.email == 'staff@jointclub-kobe.com';
    }

    match /artifacts/salon-resv-2026/public/data/reservations/{reservationId} {
      // 受付期限：{締切の翌日} 00:00 JST まで
      allow create: if request.auth != null
        && request.time < timestamp.value({締切ミリ秒})
        && request.resource.data.customerName is string
        && request.resource.data.customerName.size() > 0
        && request.resource.data.customerName.size() <= 100
        && request.resource.data.items is list
        && request.resource.data.items.size() <= 20;

      allow read, update, delete: if isAdmin();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## 4. Obsidian（Projects/joint-club.md）に貼る更新文

```
### ✅ Repeater Fair {年} 予約フォーム（稼働中）
- リピーター向けフェアの予約＋商品販売（{季節}：{割引の対象}{割引}・受付〜{締切}・お渡し{お渡し}〜）
- Firebase（Blazeプラン）+ Tailwind CSS + LINE LIFF
- 公開URL: https://jointclub-kobe.com/reservation/
- LIFF: https://liff.line.me/2010337371-g1ra1deL
- GitHub: jointclub0-ai/salon-resv-2026（Mac: GitHub Desktop でClone済み）
- 管理画面ログイン: staff@jointclub-kobe.com（パスワードは別管理）
```
