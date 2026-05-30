# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-page salon product reservation app for "Repeater Fair 2026" — a Japanese-language HTML-only static site with no build step, no framework, and no package manager. The entire application lives in `index.html`.

## Running Locally

```bash
# Any static file server works, e.g.:
python3 -m http.server 8080
# then open http://localhost:8080
```

There are no tests, no linting tools, and no build process configured in this repository.

## Architecture

All application code is inside a single `<script type="module">` block in `index.html`. The architecture is:

- **Firebase Anonymous Auth** — signs in visitors automatically on page load; `currentUser` holds the Firebase `User` object.
- **Firestore real-time listener** — `onSnapshot` on the `reservations` collection keeps the admin view live without page refreshes.
- **State** — plain JS module-scope variables: `quantities` (map of product ID → count), `reservations` (array from Firestore), `adminUnlocked` (boolean), `currentUser`.
- **Rendering** — `renderForm()` and `renderAdmin()` rebuild DOM sections via `innerHTML` assignment; there is no virtual DOM or diffing.
- **Views** — four `div` sections toggled with `.hidden`: `customerView` (wraps `formView` and `thanksView`), `adminView`, `passwordView`. `showTab()` manages visibility and tab button styles.

### Firestore Data Path

```
artifacts/salon-resv-2026/public/data/reservations/{docId}
```

Each reservation document:
```js
{
  customerName: string,
  items: [{ productId, productName, price, quantity, subtotal }],
  totalPrice: number,
  totalItems: number,
  timestamp: serverTimestamp(),
  userId: string  // Firebase anonymous UID
}
```

### Product Catalog

Defined in the `PRODUCTS` array (lines 29–39). Each entry has `id`, `name` (Japanese), `price` (JPY), and `img` (local filename). Quantities are capped at 10 per product per reservation.

### Admin Access

Password-protected via a hardcoded string (`ADMIN_PASSWORD`). Once unlocked, `adminUnlocked` stays `true` for the session. The admin view shows per-product totals and a full reservation ledger sorted by timestamp descending.

## Key Conventions

- **Language**: All UI text is Japanese. Keep new UI strings in Japanese.
- **Styling**: Tailwind CSS loaded from CDN (`cdn.tailwindcss.com`) — no config file. Use Tailwind utility classes directly.
- **No global functions exposed via `window` are typed** — `submitReservation`, `updateQty`, `showTab`, `checkPassword`, `closeThanks` are attached to `window` explicitly because they are called from inline `onclick` attributes in the HTML.
- **Firebase config** is embedded in the HTML (public API key for a client-side Firebase project — this is expected and normal for Firebase).
