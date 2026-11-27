# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini and others) working with Tameio, either to **install it for a user** or to **change its code**.

Tameio is a local dashboard for a person's own e-food, Wolt and Box order history. It is a single Node.js server (`server.js`) on `127.0.0.1` that serves a static front end from `public/`. It has **no dependencies**, no build step, no database and no cloud. The interface is in Greek; code and comments are in English.

Talk to the user in their own language (most users write Greek).

## Install Tameio for a user

Follow these steps in order. Each one has a check, so you know it worked before you move on.

1. **Check Node.js.** Run `node --version`. It must be **v20 or newer**.
   - If Node is missing or older, don't install it yourself without asking. Tell the user to install the LTS version from https://nodejs.org (on macOS with Homebrew, `brew install node` also works), then continue.
2. **Get the code.** Ask the user where they want it, or use `~/tameio` if they don't mind.
   - With git: `git clone https://github.com/yanispap/tameio.git ~/tameio`
   - Without git: download https://github.com/yanispap/tameio/archive/refs/heads/main.zip, unzip it, and use the `tameio-main` folder.
   - If the folder already exists and is a clone, update it with `git -C ~/tameio pull` instead.
3. **Don't run `npm install`.** There is nothing to install. `package.json` has no dependencies on purpose.
4. **Check that it works.** Run `npm test` in the project folder. The last lines should end in `ok`.
5. **Start it.** Run `npm start` in the project folder **as a background process**, because the server keeps running until it is stopped. It prints `Tameio: http://127.0.0.1:4321/#token=…` when it is ready.
   - If port 4321 is taken (`EADDRINUSE`), start it with `PORT=5000 npm start` and use that port from then on.
6. **Confirm it's up.** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/` should print `200`. Then open **the exact address it printed, with its `#token=…`**, in the user's browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows).

### What to tell the user afterwards

Tell them these things, briefly and in their language:

- Tameio is running at **http://127.0.0.1:4321**, only on their computer. Nothing is uploaded anywhere. The first time in each browser it has to be opened from the address with `#token=…` that the terminal printed; the token is a key for this install only, so open it but don't paste it into the chat.
- To bring in their orders, click **Συνδέσεις** (Connections) at the top right:
  - **e-food:** they type their email and password into Tameio's own form themselves.
  - **Wolt and Box:** they drag the **Tameio sync** button to their bookmarks bar, open wolt.com or box.gr while logged in, and click the bookmark.
  - **Any platform:** they can upload a JSON file of their order list instead.
- To stop it: `Ctrl+C` in the terminal where it runs, or ask you to stop the process. To start it again later: `npm start` in the same folder.
- Their data lives only in the `data/` folder inside the project. Deleting that folder deletes everything.
- Tameio isn't affiliated with e-food, Wolt or Box. Some of these services' terms restrict automated access (see the README's Privacy section), so whether to use it with their account is their call.

### Rules while installing

- **Never ask for, type or handle the user's passwords, tokens or cookies.** The user enters their e-food login into Tameio's form themselves, and the Wolt/Box sync runs in their own browser. Don't log in on their behalf, and don't read session cookies out of their browser.
- **Don't open or print files in `data/`.** They hold the user's orders and sessions. Read them only if the user asks you to, for a specific reason.
- Don't change the code to get past an error during install. If something fails, show the user the error and check **Troubleshooting** below.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `node: command not found`, or a version below 20 | Install Node.js LTS from https://nodejs.org |
| `EADDRINUSE` on start | Another program uses port 4321: `PORT=5000 npm start` |
| The page loads but shows no orders | Normal on first run: connect an account under **Συνδέσεις** |
| `Forbidden` (403) in the browser | Open it as `http://127.0.0.1:4321`, not through another hostname or a proxy |
| «Άνοιξε το Tameio από το τερματικό» (401) | The browser doesn't have this install's key yet. Open the address with `#token=…` that `npm start` printed (the key is also in `data/token`) |
| An account stops syncing | The platform changed something. Click **Ανανέωση** (Refresh) under Connections; if it still fails, open an issue with the error message and no personal data |

## Change the code

### Commands

```bash
npm start   # run the server (http://127.0.0.1:4321, prints the address with its key)
npm test    # run the tests (no framework, plain asserts)
```

There is no build, lint or format step. Reload the browser to see front-end changes; restart the server after changing `server.js`.

### Layout

```
server.js                  local server: logins, orders, shops, menus, storage (data/)
public/index.html          the dashboard
public/app.js, app.css     Spending page, Connections, shared styles
public/stores.js           Stores page
public/compare-ui.js       Compare page
public/wrapped-ui.js       Wrapped page
public/lib/normalize.js    turns each platform's orders into one shared format
public/lib/stats.js        stats for the Spending page
public/lib/prices.js       price history of dishes
public/lib/compare.js      cost of an order on each platform (Compare page)
public/lib/dishmatch.js    matching the same dish across platforms
public/lib/wrapped.js      numbers for the Wrapped cards
public/lib/bookmarklet.js  the "Tameio sync" bookmarklet
public/fonts/, logos/      bundled fonts and platform logos
test.mjs                   tests
```

### Conventions

- **Zero dependencies.** Use Node's standard library on the server and plain browser JavaScript (ES modules) in `public/`. Don't add packages, a bundler or a framework.
- **Nothing leaves the machine except calls to the platforms themselves.** No analytics, telemetry, CDNs or web fonts from other hosts. Fonts and logos are bundled.
- **Money is in integer cents** everywhere (`total: 1250` is 12,50 €). Format it only when rendering, with the `el-GR` locale.
- **One order shape.** Every platform's orders go through `public/lib/normalize.js`. To add a platform: a way to fetch its orders, plus one normalizer, plus a test in `test.mjs`.
- **User-facing text is Greek**, in short, plain sentences. Code, comments and commit messages are in English.
- The server listens on `127.0.0.1` (and holds `::1`, so nothing else can answer at `localhost`). It rejects other hosts, other origins and requests that other websites trigger, and every `/api` call needs this install's key (`data/token`, sent as `X-Tameio-Token` by `public/lib/api.js`). Keep all of these checks.
- Requests to the platforms say what they are (`User-Agent: Tameio (+https://github.com/yanispap/tameio)`) and pause between groups. Never send a browser's user agent.
- `data/` is gitignored and must stay that way. Never commit orders, sessions, tokens or real personal data. Test fixtures use made-up names and numbers.
- Don't impersonate the platforms' apps, spoof their clients, or work around their bot protection. Tameio reads only the user's own history, through the user's own session.

### Before you finish a change

1. `npm test` passes.
2. The page you touched works at phone width (390px) and desktop width, in light and dark mode.
3. `git status` shows nothing from `data/` and no secrets.

More detail for human contributors is in [CONTRIBUTING.md](CONTRIBUTING.md).
