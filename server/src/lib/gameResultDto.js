/**
 * Shared result DTO mapping (legacy + event-v1 curve fields).
 */
import { RULE_VERSION } from "../../../shared/engine.js";

export function resultDto(resultRow, sessionRow) {
  const valuation = resultRow.valuation_json
    ? JSON.parse(resultRow.valuation_json)
    : null;
  const returnPpm = resultRow.return_ppm;
  const returnPct = (returnPpm / 10000).toFixed(2);
  const equityCurve = resultRow.equity_curve_json
    ? JSON.parse(resultRow.equity_curve_json)
    : null;
  return {
    gameId: resultRow.game_id,
    ruleVersion: sessionRow?.rule_version || RULE_VERSION,
    datasetVersion: sessionRow?.dataset_version,
    fillMode: sessionRow?.fill_mode,
    returnPpm,
    returnPct,
    tradeCount: resultRow.trade_count,
    equityMultiple: resultRow.equity_multiple_decimal,
    valuation,
    validationStatus: resultRow.validity,
    savedAt: resultRow.created_at,
    finishedAt: sessionRow?.finished_at || resultRow.created_at,
    stockCode: sessionRow?.stock_code,
    stockName: sessionRow?.stock_name,
    actions: JSON.parse(resultRow.actions_json),
    trades: JSON.parse(resultRow.trades_json),
    // B0-PR2: null for legacy rows — do not fake 0
    mddPpm: resultRow.mdd_ppm == null ? null : resultRow.mdd_ppm,
    benchmarkReturnPpm:
      resultRow.benchmark_return_ppm == null ? null : resultRow.benchmark_return_ppm,
    equityCurve,
    scoreVersion: resultRow.score_version ?? null,
    assistClass:
      resultRow.assist_class ?? sessionRow?.assist_class ?? null,
  };
}
