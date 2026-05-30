# CLAUDE.md

このファイルは、リポジトリ内のコードを扱う際に Claude Code (claude.ai/code) へ提供するガイダンスです。

## 概要

「Repeater Fair 2026」向けのサロン商品予約アプリ。ビルドステップ・フレームワーク・パッケージマネージャーを持たない、日本語UIの静的HTMLシングルページアプリ。アプリ全体が `index.html` 1ファイルに収まっている。

## ローカル起動

```bash
# 任意の静的ファイルサーバーで動作する（例）:
python3 -m http.server 8080
# → http://localhost:8080 をブラウザで開く
```

テスト・リントツール・ビルドプロセスはいずれも存在しない。

## アーキテクチャ

すべてのアプリコードは `index.html` 内の単一の `<script type="module">` ブロックに書かれている。

- **Firebase Anonymous Auth** — ページ読み込み時に自動で匿名サインイン。`currentUser` が Firebase `User` オブジェクトを保持する。
- **Firestore リアルタイムリスナー** — `onSnapshot` で `reservations` コレクションを購読し、管理画面をページリロードなしに即時更新する。
- **状態管理** — モジュールスコープのプレーンJS変数: `quantities`（商品ID→数量のマップ）、`reservations`（Firestoreから取得した配列）、`adminUnlocked`（boolean）、`currentUser`。
- **描画** — `renderForm()` と `renderAdmin()` が `innerHTML` の直接代入でDOM区画を再構築する。仮想DOMや差分検出は使用しない。
- **ビュー** — `.hidden` で切り替える4つの `div`: `customerView`（`formView` と `thanksView` を内包）、`adminView`、`passwordView`。`showTab()` が表示切り替えとタブボタンのスタイルを管理する。

### Firestore データパス

```
artifacts/salon-resv-2026/public/data/reservations/{docId}
```

予約ドキュメントの構造:
```js
{
  customerName: string,
  items: [{ productId, productName, price, quantity, subtotal }],
  totalPrice: number,
  totalItems: number,
  timestamp: serverTimestamp(),
  userId: string  // Firebase 匿名UID
}
```

### 商品カタログ

`PRODUCTS` 配列（29〜39行目）で定義。各エントリは `id`・`name`（日本語）・`price`（円）・`img`（ローカルファイル名）を持つ。1予約あたりの数量上限は商品ごとに10本。

### 管理画面へのアクセス

`ADMIN_PASSWORD` にハードコードされたパスワードで保護。解除後は `adminUnlocked` がセッション中 `true` を維持する。管理画面では商品ごとの合計数とタイムスタンプ降順の予約台帳を表示する。

## 規約

- **言語**: UIテキストはすべて日本語。新しい文言も日本語で記述する。
- **スタイリング**: Tailwind CSS はCDN（`cdn.tailwindcss.com`）から読み込む。設定ファイルは存在しない。Tailwindユーティリティクラスを直接使用する。
- **`window` へのグローバル関数の明示的な登録**: `submitReservation`・`updateQty`・`showTab`・`checkPassword`・`closeThanks` は、HTML内のインライン `onclick` 属性から呼び出されるため、明示的に `window` へ代入している。
- **Firebase設定のHTML埋め込み**: クライアントサイドFirebaseプロジェクトの公開APIキーをHTMLに記載するのは仕様であり問題ない。
