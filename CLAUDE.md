# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stock Market Ups and Downs (股海沉浮) — a single-player stock trading simulator game using real Chinese A-share market data. The UI is entirely in Chinese (zh-CN).

## Architecture

Two-phase pipeline with a flat file structure:

1. **Data collection** (`fetch_stock_data.py`): Python script fetches daily K-line data for ~200 A-share stocks (CSI 300 + CSI 500 constituents) via `akshare` (East Money API). Outputs:
   - `data/stocks_data.json` (readable backup)
   - `data/stocks_data.js` (browser-friendly `const STOCKS_DATA = ...;` for direct `<script>` include)
2. **Game runtime** (`index.html` + `js/*.js` + `css/*.css`): Vanilla HTML/CSS/JS app using ES Modules (no framework, no build step). Uses ECharts 5.4.3 for candlestick charts. Loads stock data from `data/stocks_data.js` into `gameState.stocksData`.

Data flows: `akshare API → fetch_stock_data.py → data/stocks_data.js → index.html (browser)`

## Running the Project

### Data fetching (Python)
```bash
pip install akshare pandas
python fetch_stock_data.py
```
This writes `data/stocks_data.json` and `data/stocks_data.js`. Takes several minutes due to rate limiting (0.3s per stock).

### Running the game
Serve the directory with any static file server (ES Modules require HTTP, not file://):
```bash
python -m http.server 8000
# Then open http://localhost:8000
```
The repo includes 2024 data by default. If data is missing, the app alerts and asks you to run `fetch_stock_data.py`.

## No Build/Test/Lint Tooling

There is no build step, test suite, linter, or CI/CD configuration. The frontend is vanilla HTML/CSS/JS with ES Module files under `js/` and styles split across `css/`.

## Key Technical Details

- **Chinese market conventions**: Red = gain (up), green = loss (down) — opposite of US markets. T+1 settlement rule enforced (cannot sell same day as buy).
- **Game state positions**: `'empty'` → `'locked'` (just bought, T+1) → `'holding'` → `'empty'` (after sell). Returns are multiplicative across trades.
- **Chart rendering**: ECharts dual-panel layout (candlestick + volume). Result screen overlays buy/sell pin markers on the full chart.
- **Hindsight (时光档案馆 / 当初买了该多好)**: Optional “what-if” screen where a user picks a stock + date range + buy quantity; the UI presents an “archive”-style results card and a chart annotated with the peak point (implemented as a dedicated scatter series so it lands on the `high` coordinate).
- **Fonts**: Orbitron (headings), JetBrains Mono (numbers), Noto Sans SC (Chinese text) — all via Google Fonts CDN.
- **Visual theme**: Dark cyberpunk/trading terminal aesthetic with glass-morphism, animated grid background, and neon glow effects.
