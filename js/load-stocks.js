/** Compatibility barrel — prefer pack-store.js / start-flow.js for new code.
 * Architecture Phase 1 split of the former monolithic load-stocks.js.
 */
export { ensureStocksLoaded, prefetchStocksPack, packReady, scheduleDeferredPrefetch } from './pack-store.js';
export { attachDeferredStart } from './start-flow.js';
