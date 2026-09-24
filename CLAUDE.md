# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stock Market Ups and Downs (股海沉浮 / 早知道当初不炒了) — an A-share stock trading simulator mini-game using real Chinese market data. The UI is entirely in Chinese (zh-CN). Live site: https://stockgame.xieyw.top

## Architecture

1. **Data collection** (`fetch_stock_data.py`): Python fetches daily K-line data for ~200 A-share stocks (CSI 300 + CSI 500) via `akshare`. Writes `data/stocks_data.json` / versioned packs + `pack-meta.json`.
2. **Static game client** (`index.html` + `js/*.js` + `css/*.css`): Vanilla ES Modules (no bundler). ECharts 5.4 is loaded asynchronously via `js/echarts-loader.js`.
3. **API server** (`server/`): Node.js + Express + SQLite. Auth, cloud games, 韭币, daily challenge, puzzle chapters, quiz rewards, leaderboards, etc. Production static deploy workflow does **not** deploy the API — ship API separately.

Shared settlement / T+1 rules live in `shared/engine.js` (and puzzle/oneshot/survival helpers under `shared/`).

## Running

### Static client
```bash
python -m http.server 8000
# http://localhost:8000
```

### API (local)
```bash
npm run server:install
npm run server:migrate
npm run server:dev
```

### Data refresh
```bash
pip install akshare pandas
python fetch_stock_data.py
```

## Tests

```bash
npm install && npm run server:install
npm test
```

`scripts/run-tests.mjs` runs client unit tests then server integration suites. Injectable clock: `STOCKGAME_NOW_MS` (see `challengeNow` in `server/src/lib/dailyChallenge.js`).

## Key Technical Details

- **Chinese market conventions**: Red = gain (up), green = loss (down). T+1: sell fill day must be strictly after buy fill day (`shared/engine.js`). Client `validatePlayAction` / HUD must mirror that for classic modes; puzzle uses `firstSellableDay`.
- **Game state positions**: `'empty'` → `'locked'` (display after buy) → `'holding'` → `'empty'`. Engine unlocks `locked→holding` at the start of each new decision day.
- **Modes**: classic practice, daily challenge, oneshot (1 buy / 1 sell), survival (−20% stop-out), ghost duel, puzzle chapters.
- **Fonts**: system stacks only — CSS vars `--sans`, `--kaiti`, `--mono` in `css/base.css`. No Google Fonts CDN.
- **Visual theme**: paper / ink sketchbook (`纸` / `墨`), not cyberpunk. Theme tokens in `css/base.css`; toggle via `js/theme.js`.
- **Economy**: 韭币 (`jiu-coin`) for create costs, daily claim, quiz rewards, rewind, etc.
