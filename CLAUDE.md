# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stock Market Ups and Downs (股海沉浮) — a single-player stock trading simulator game using real Chinese A-share market data. The UI is entirely in Chinese (zh-CN).

## Architecture

Two-phase pipeline with a flat file structure:

1. **Data collection** (`fetch_stock_data.py`): Python script fetches daily K-line data for ~200 A-share stocks (CSI 300 + CSI 500 constituents) via `akshare` (East Money API). Outputs to `data/stocks_data.json`.
2. **Game runtime** (`index.html`): Self-contained single-page app (no framework, no build step). Loads stock data from JSON, falls back to built-in mock data if unavailable. Uses ECharts 5.4.3 for candlestick charts.

Data flows: `akshare API → fetch_stock_data.py → data/stocks_data.json → index.html (browser)`

## Running the Project

### Data fetching (Python)
```bash
pip install akshare pandas
python fetch_stock_data.py
```
This writes `data/stocks_data.json`. Takes several minutes due to rate limiting (0.3s per stock).

### Running the game
Serve the directory with any static file server (fetch of local JSON requires HTTP, not file://):
```bash
python -m http.server 8000
# Then open http://localhost:8000
```
The game works without stock data (uses mock fallback), but real data provides a better experience.

## No Build/Test/Lint Tooling

There is no build step, test suite, linter, or CI/CD configuration. The frontend is vanilla HTML/CSS/JS in a single file.

## Key Technical Details

- **Chinese market conventions**: Red = gain (up), green = loss (down) — opposite of US markets. T+1 settlement rule enforced (cannot sell same day as buy).
- **Game state positions**: `'empty'` → `'locked'` (just bought, T+1) → `'holding'` → `'empty'` (after sell). Returns are multiplicative across trades.
- **Chart rendering**: ECharts dual-panel layout (candlestick + volume). Result screen overlays buy/sell pin markers on the full chart.
- **Fonts**: Orbitron (headings), JetBrains Mono (numbers), Noto Sans SC (Chinese text) — all via Google Fonts CDN.
- **Visual theme**: Dark cyberpunk/trading terminal aesthetic with glass-morphism, animated grid background, and neon glow effects.
