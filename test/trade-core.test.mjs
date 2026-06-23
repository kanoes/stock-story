import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalytics } from '../src/lib/trade/analytics.js';
import { rebuildDaysFromCsvFiles } from '../src/lib/trade/csv.js';
import { mergeDays, normalizeTrade } from '../src/lib/trade/models.js';
import { createDefaultSettings, mergeSettings } from '../src/lib/trade/settings.js';
import { buildHealthReport } from '../src/lib/view-models.js';

function makeCsvFile(name, text) {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

test('normalizeTrade keeps manual name blank until a company lookup fills it', () => {
  const trade = normalizeTrade({
    manualType: 'spot_buy',
    symbol: '1301',
    name: ''
  }, '2026-04-02', 0);

  assert.equal(trade.symbol, '1301');
  assert.equal(trade.name, '');
});

test('buildAnalytics assigns the provided 4/2 -> 4/4 trades to 4/4 profit using FIFO', () => {
  const analytics = buildAnalytics([
    {
      date: '2026-04-02',
      trades: [
        { manualType: 'spot_buy', symbol: '1234', name: 'Test', quantity: 7800, price: 130.3 },
        { manualType: 'spot_buy', symbol: '1234', name: 'Test', quantity: 10000, price: 123 },
        { manualType: 'spot_buy', symbol: '1234', name: 'Test', quantity: 2200, price: 130.4 }
      ]
    },
    {
      date: '2026-04-04',
      trades: [
        { manualType: 'spot_sell', symbol: '1234', name: 'Test', quantity: 7800, price: 129 },
        { manualType: 'spot_sell', symbol: '1234', name: 'Test', quantity: 10000, price: 129 },
        { manualType: 'spot_sell', symbol: '1234', name: 'Test', quantity: 2200, price: 129 }
      ]
    }
  ]);

  const aprilFourth = analytics.daysDesc.find((day) => day.date === '2026-04-04');
  const aprilSecond = analytics.daysDesc.find((day) => day.date === '2026-04-02');

  assert.ok(aprilFourth);
  assert.ok(aprilSecond);
  assert.equal(aprilFourth.scopes.all.profit, 46780);
  assert.equal(aprilSecond.scopes.all.profit, 0);
  assert.equal(analytics.summaries.all.totalProfit, 46780);
});

test('default settings carry import metadata and memos', () => {
  const settings = createDefaultSettings();

  assert.deepEqual(Object.keys(settings).sort(), [
    'lastCsvImportAt',
    'lastCsvImportSummary',
    'memos',
    'updatedAt',
    'version'
  ]);
  assert.deepEqual(settings.memos, []);
});

test('mergeSettings keeps the newest memo version including deletes', () => {
  const local = {
    ...createDefaultSettings(),
    memos: [
      {
        id: 'memo-1',
        title: 'Local',
        body: 'deleted locally',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
        deletedAt: '2026-06-22T00:00:00.000Z'
      }
    ]
  };
  const remote = {
    ...createDefaultSettings(),
    memos: [
      {
        id: 'memo-1',
        title: 'Remote',
        body: 'older remote memo',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
        deletedAt: ''
      },
      {
        id: 'memo-2',
        title: 'Remote New',
        body: 'new memo',
        createdAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
        deletedAt: ''
      }
    ]
  };

  const merged = mergeSettings(local, remote);

  assert.equal(merged.memos.length, 2);
  assert.equal(merged.memos.find((memo) => memo.id === 'memo-1').deletedAt, '2026-06-22T00:00:00.000Z');
  assert.equal(merged.memos.find((memo) => memo.id === 'memo-2').title, 'Remote New');
});

test('rebuildDaysFromCsvFiles imports executions and enriches margin closes from supplemental CSVs', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年03月12日,2026年04月11日,6,1,6
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/04/02,大黒屋ホールディングス,6993,PTS（X）,信用新規買,6ヶ月,特定,--,7800,130.3,--,--,2026/04/06,--
2026/04/02,大黒屋ホールディングス,6993,東証,信用新規買,6ヶ月,特定,--,10000,123,--,--,2026/04/06,--
2026/04/02,大黒屋ホールディングス,6993,PTS（X）,信用新規買,6ヶ月,特定,--,2200,130.4,--,--,2026/04/06,--
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,2200,129,44,--,2026/04/07,-3124
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,10000,129,188,--,2026/04/07,59812
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,7800,129,155,--,2026/04/07,-10295
`;
  const marginCsv = `信用決済明細
取引区分指定,指定銘柄,決済開始年月日,決済終了年月日,明細数,明細指定開始,明細指定終了
指定なし,指定なし,2026年03月12日,2026年04月11日,3,1,3
決済損益合計
+46393
決済日,銘柄,銘柄コード,決済市場,取引,期限,預り,課税,建市場,建日,買/売建,決済数量,建単価,決済単価,建代金,決済代金,新規建手数料,決済手数料,管理費,貸株料,金利,日数,逆日歩,消費税,書換料,諸費用計,受渡日,受渡金額/決済損益
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,東証,2026/04/02,買建,10000,123,129,1230000,1290000,--,--,--,--,188,2,--,--,--,188,2026/04/07,+59812
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,PTS,2026/04/02,買建,2200,130.4,129,286880,283800,--,--,--,--,44,2,--,--,--,44,2026/04/07,-3124
2026/04/03,大黒屋ホールディングス,6993,東証,信用返済売,6ヶ月,特定,申告,PTS,2026/04/02,買建,7800,130.3,129,1016340,1006200,--,--,--,--,155,2,--,--,--,155,2026/04/07,-10295
`;
  const taxCsv = `特定口座損益明細
受渡開始年月日,受渡終了年月日,明細数,明細指定開始,明細指定終了
2026年03月12日,2026年04月15日,4,1,4
銘柄コード,銘柄,譲渡益取消区分,約定日,数量,取引,受渡日,売却/決済金額,費用,取得/新規年月日,取得/新規金額,損益金額/徴収額,地方税
6993,大黒屋ホールディングス,,2026/04/03,2200株,信用返済売,2026/04/07,283756,44,2026/04/06,286880,-3124,
6993,大黒屋ホールディングス,,2026/04/03,7800株,信用返済売,2026/04/07,1006045,155,2026/04/06,1016340,-10295,
6993,大黒屋ホールディングス,,2026/04/03,10000株,信用返済売,2026/04/07,1289812,188,2026/04/06,1230000,+59812,
譲渡益税徴収額,,,,,,2026/04/07,,,,,9424,2319
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv),
    makeCsvFile('信用決済明細.csv', marginCsv),
    makeCsvFile('譲渡益税明細.csv', taxCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const closeDay = result.days.find((day) => day.date === '2026-04-03');

  assert.equal(result.summary.importedRows, 6);
  assert.equal(result.summary.matchedMarginSettlementRows, 3);
  assert.equal(result.summary.marginSettlements.unmatchedRows, 0);
  assert.equal(result.summary.taxDetails[0].totalTax, 11743);
  assert.equal(closeDay.trades.filter((trade) => trade.marginSettlement).length, 3);
  assert.equal(analytics.summaries.all.totalProfit, 46393);
  assert.equal(analytics.summaries.margin.holdingCost, 387);
});

test('rebuildDaysFromCsvFiles imports investment trusts and turns genbiki into a cash position', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年04月01日,2026年04月05日,5,1,5
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/04/01,テスト株,9999,東証,信用新規買,6ヶ月,特定,--,100,100,--,--,2026/04/03,--
2026/04/02,テスト株,9999,東証,現引,6ヶ月,特定,--,100,100,10,--,2026/04/06,-10010
2026/04/03,テスト株,9999,東証,株式現物売,--,特定,申告,100,110,--,--,2026/04/07,11000
2026/04/04,テストファンド,,--,投信金額買付,--,NISA,--,10000,10000,--,--,2026/04/08,10000
2026/04/05,テストファンド,,--,投信金額解約,--,NISA,申告,10000,11000,--,--,2026/04/09,11000
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const trades = result.days.flatMap((day) => day.trades);

  assert.equal(result.summary.totalRows, 5);
  assert.equal(result.summary.importedSourceRows, 5);
  assert.equal(result.summary.importedRows, 6);
  assert.equal(result.summary.importedInvestmentTrustRows, 2);
  assert.equal(result.summary.importedConversionRows, 1);
  assert.equal(result.summary.skippedUnsupported, 0);
  assert.equal(trades.filter((trade) => trade.tradeTypeLabel.includes('現引')).length, 2);
  assert.equal(trades.filter((trade) => trade.productType === 'fund').length, 2);
  assert.equal(analytics.summaries.all.totalProfit, 1990);
  assert.equal(analytics.summaries.margin.holdingCost, 10);
  assert.equal(analytics.positions.all.length, 0);
});

test('tax detail CSV can provide reported cash profit when opening history is missing', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年05月01日,2026年05月01日,1,1,1
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/05/01,古い持株,1111,東証,株式現物売,--,特定,申告,100,1000,10,--,2026/05/05,99990
`;
  const taxCsv = `特定口座損益明細
受渡開始年月日,受渡終了年月日,明細数,明細指定開始,明細指定終了
2026年05月01日,2026年05月05日,2,1,2
銘柄コード,銘柄,譲渡益取消区分,約定日,数量,取引,受渡日,売却/決済金額,費用,取得/新規年月日,取得/新規金額,損益金額/徴収額,地方税
1111,古い持株,,2026/05/01,100株,株式現物売,2026/05/05,99990,10,2025/01/01,80000,+19990,
譲渡益税徴収額,,,,,,2026/05/05,,,,,3045,995
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv),
    makeCsvFile('譲渡益税明細.csv', taxCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const healthReport = buildHealthReport(result.days);
  const closeTrade = analytics.trades.find((trade) => trade.symbol === '1111');

  assert.equal(result.summary.matchedTaxDetailRows, 1);
  assert.equal(result.summary.unmatchedTaxDetailRows, 0);
  assert.equal(result.summary.taxDetails[0].totalTax, 4040);
  assert.equal(closeTrade.profitSource, 'reported');
  assert.equal(closeTrade.realizedProfit, 19990);
  assert.equal(analytics.summaries.cash.totalProfit, 19990);
  assert.equal(analytics.summaries.cash.holdingCost, 10);
  assert.equal(healthReport.orphanCloseCount, 0);
});

test('tax detail CSV matches cash sells with broker short trade labels', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年05月01日,2026年05月01日,1,1,1
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/05/01,古い持株,1111,東証,株式現物売,--,特定,申告,100,1000,10,--,2026/05/05,99990
`;
  const taxCsv = `特定口座損益明細
受渡開始年月日,受渡終了年月日,明細数,明細指定開始,明細指定終了
2026年05月01日,2026年05月05日,1,1,1
銘柄コード,銘柄,譲渡益取消区分,約定日,数量,取引,受渡日,売却/決済金額,費用,取得/新規年月日,取得/新規金額,損益金額/徴収額,地方税
1111,古い持株,,2026/04/30,100株,現物売,2026/05/05,99990,10,2025/01/01,80000,+19990,
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv),
    makeCsvFile('譲渡益税明細.csv', taxCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const closeTrade = analytics.trades.find((trade) => trade.symbol === '1111');

  assert.equal(result.summary.matchedTaxDetailRows, 1);
  assert.equal(result.summary.unmatchedTaxDetailRows, 0);
  assert.equal(closeTrade.profitSource, 'reported');
  assert.equal(closeTrade.realizedProfit, 19990);
});

test('tax detail CSV can combine split rows into one cash sell', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年05月01日,2026年05月01日,1,1,1
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/05/01,分割明細株,2222,東証,株式現物売,--,特定,申告,1200,374,--,--,2026/05/05,448800
`;
  const taxCsv = `特定口座損益明細
受渡開始年月日,受渡終了年月日,明細数,明細指定開始,明細指定終了
2026年05月01日,2026年05月05日,2,1,2
銘柄コード,銘柄,譲渡益取消区分,約定日,数量,取引,受渡日,売却/決済金額,費用,取得/新規年月日,取得/新規金額,損益金額/徴収額,地方税
2222,分割明細株,,2026/04/29,400株,現物売,2026/05/05,149600,0,2025/01/01,143600,+6000,
2222,分割明細株,,2026/04/30,800株,現物売,2026/05/05,299200,0,2025/02/01,287200,+12000,
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv),
    makeCsvFile('譲渡益税明細.csv', taxCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const closeTrade = analytics.trades.find((trade) => trade.symbol === '2222');

  assert.equal(result.summary.matchedTaxDetailRows, 2);
  assert.equal(result.summary.unmatchedTaxDetailRows, 0);
  assert.equal(closeTrade.profitSource, 'reported');
  assert.equal(closeTrade.realizedProfit, 18000);
  assert.equal(closeTrade.taxDetail.sellAmount, 448800);
});

test('tax detail CSV derives zero profit when broker omits the profit amount', async () => {
  const executionCsv = `約定履歴照会
商品指定,約定開始年月日,約定終了年月日,明細数,明細指定開始,明細指定終了
すべての商品,2026年05月01日,2026年05月01日,1,1,1
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
2026/05/01,同額移管株,3333,東証,株式現物売,--,特定,申告,100,257,--,--,2026/05/05,25700
`;
  const taxCsv = `特定口座損益明細
受渡開始年月日,受渡終了年月日,明細数,明細指定開始,明細指定終了
2026年05月01日,2026年05月05日,1,1,1
銘柄コード,銘柄,譲渡益取消区分,約定日,数量,取引,受渡日,売却/決済金額,費用,取得/新規年月日,取得/新規金額,損益金額/徴収額,地方税
3333,同額移管株,,2026/05/01,100株,現物売,2026/05/05,25700,--,2026/05/01,25700,--,
`;

  const result = await rebuildDaysFromCsvFiles([
    makeCsvFile('約定履歴.csv', executionCsv),
    makeCsvFile('譲渡益税明細.csv', taxCsv)
  ], [], createDefaultSettings());
  const analytics = buildAnalytics(result.days);
  const healthReport = buildHealthReport(result.days);
  const closeTrade = analytics.trades.find((trade) => trade.symbol === '3333');

  assert.equal(result.summary.matchedTaxDetailRows, 1);
  assert.equal(result.summary.unmatchedTaxDetailRows, 0);
  assert.equal(closeTrade.profitSource, 'reported');
  assert.equal(closeTrade.realizedProfit, 0);
  assert.equal(healthReport.orphanCloseCount, 0);
});

test('mergeDays keeps distinct CSV rows with identical visible trade fields', () => {
  const settings = createDefaultSettings();
  const day = {
    date: '2026-04-01',
    trades: [
      normalizeTrade({
        id: 'csv-open-1',
        source: 'csv',
        fingerprint: 'same-visible-open#1',
        manualType: 'spot_buy',
        symbol: '1234',
        name: 'Test',
        quantity: 100,
        price: 10,
        settlementDate: '2026-04-03'
      }, '2026-04-01', 0, settings),
      normalizeTrade({
        id: 'csv-open-2',
        source: 'csv',
        fingerprint: 'same-visible-open#2',
        manualType: 'spot_buy',
        symbol: '1234',
        name: 'Test',
        quantity: 100,
        price: 10,
        settlementDate: '2026-04-03'
      }, '2026-04-01', 1, settings),
      normalizeTrade({
        id: 'csv-close',
        source: 'csv',
        fingerprint: 'close#1',
        manualType: 'spot_sell',
        symbol: '1234',
        name: 'Test',
        quantity: 200,
        price: 11,
        settlementDate: '2026-04-03'
      }, '2026-04-01', 2, settings)
    ]
  };

  const merged = mergeDays([day], [structuredClone(day)], settings);
  const analytics = buildAnalytics(merged);

  assert.equal(merged[0].trades.length, 3);
  assert.equal(analytics.summaries.all.totalProfit, 200);
});

test('mergeDays treats the latest CSV import side as a full reset source', () => {
  const settings = createDefaultSettings();
  const localStaleDay = {
    date: '2026-04-02',
    trades: [
      normalizeTrade({
        id: 'old-open',
        source: 'csv',
        fingerprint: 'old-open#1',
        manualType: 'spot_buy',
        symbol: '1111',
        name: 'Old Csv',
        quantity: 100,
        price: 10
      }, '2026-04-02', 0, settings),
      normalizeTrade({
        id: 'old-close',
        source: 'csv',
        fingerprint: 'old-close#1',
        manualType: 'spot_sell',
        symbol: '1111',
        name: 'Old Csv',
        quantity: 100,
        price: 30
      }, '2026-04-02', 1, settings),
      normalizeTrade({
        id: 'manual-note',
        source: 'manual',
        manualType: 'spot_buy',
        symbol: '9999',
        name: 'Manual',
        quantity: 1,
        price: 1
      }, '2026-04-02', 2, settings)
    ]
  };
  const remoteFreshDay = {
    date: '2026-04-02',
    trades: [
      normalizeTrade({
        id: 'new-open',
        source: 'csv',
        fingerprint: 'new-open#1',
        manualType: 'spot_buy',
        symbol: '2222',
        name: 'Fresh Csv',
        quantity: 100,
        price: 10
      }, '2026-04-02', 0, settings),
      normalizeTrade({
        id: 'new-close',
        source: 'csv',
        fingerprint: 'new-close#1',
        manualType: 'spot_sell',
        symbol: '2222',
        name: 'Fresh Csv',
        quantity: 100,
        price: 12
      }, '2026-04-02', 1, settings)
    ]
  };

  const merged = mergeDays([localStaleDay], [remoteFreshDay], settings, { csvSource: 'remote' });
  const analytics = buildAnalytics(merged);

  assert.equal(merged[0].trades.length, 2);
  assert.equal(merged[0].trades.some((trade) => trade.symbol === '1111'), false);
  assert.equal(merged[0].trades.some((trade) => trade.symbol === '9999'), false);
  assert.equal(analytics.summaries.all.totalProfit, 200);
});

test('buildAnalytics closes same-day margin lots even when broker CSV lists closes first', () => {
  const days = [
    {
      date: '2026-04-10',
      trades: [
        normalizeTrade({
          manualType: 'margin_close_long',
          symbol: '5016',
          name: 'JX',
          quantity: 100,
          price: 4564,
          settlementAmount: -995,
          marginSettlement: {
            source: 'marginSettlements',
            openDate: '2026-04-10',
            openSide: '買建',
            openPrice: 4573.6,
            closePrice: 4564
          }
        }, '2026-04-10', 0),
        normalizeTrade({
          manualType: 'margin_open_long',
          symbol: '5016',
          name: 'JX',
          quantity: 100,
          price: 4573.6
        }, '2026-04-10', 1),
        normalizeTrade({
          manualType: 'margin_close_short',
          symbol: '9984',
          name: 'SoftBank',
          quantity: 100,
          price: 990,
          settlementAmount: 450,
          marginSettlement: {
            source: 'marginSettlements',
            openDate: '2026-04-10',
            openSide: '売建',
            openPrice: 995,
            closePrice: 990
          }
        }, '2026-04-10', 2),
        normalizeTrade({
          manualType: 'margin_open_short',
          symbol: '9984',
          name: 'SoftBank',
          quantity: 100,
          price: 995
        }, '2026-04-10', 3)
      ]
    }
  ];
  const analytics = buildAnalytics(days);
  const healthReport = buildHealthReport(days);

  assert.equal(analytics.summaries.all.totalProfit, -545);
  assert.equal(analytics.summaries.all.positionsCount, 0);
  assert.equal(analytics.summaries.margin.positionsCount, 0);
  assert.equal(healthReport.orphanCloseCount, 0);
});

test('buildAnalytics preserves manual same-day margin order without settlement detail', () => {
  const analytics = buildAnalytics([
    {
      date: '2026-04-11',
      trades: [
        normalizeTrade({
          manualType: 'margin_open_long',
          symbol: '7777',
          name: 'Manual Day Trade',
          quantity: 100,
          price: 1000
        }, '2026-04-11', 0),
        normalizeTrade({
          manualType: 'margin_close_long',
          symbol: '7777',
          name: 'Manual Day Trade',
          quantity: 100,
          price: 1010
        }, '2026-04-11', 1)
      ]
    }
  ]);

  assert.equal(analytics.summaries.all.positionsCount, 0);
  assert.equal(analytics.summaries.margin.positionsCount, 0);
});

test('buildAnalytics uses margin settlement details to close the matching lot', () => {
  const analytics = buildAnalytics([
    {
      date: '2026-04-09',
      trades: [
        normalizeTrade({
          manualType: 'margin_open_long',
          symbol: '5016',
          name: 'JX',
          quantity: 100,
          price: 100
        }, '2026-04-09', 0),
        normalizeTrade({
          manualType: 'margin_open_short',
          symbol: '9984',
          name: 'SoftBank',
          quantity: 100,
          price: 300
        }, '2026-04-09', 1)
      ]
    },
    {
      date: '2026-04-10',
      trades: [
        normalizeTrade({
          manualType: 'margin_close_long',
          symbol: '5016',
          name: 'JX',
          quantity: 100,
          price: 205,
          settlementAmount: 500,
          marginSettlement: {
            source: 'marginSettlements',
            openDate: '2026-04-10',
            openSide: '買建',
            openPrice: 200,
            closePrice: 205
          }
        }, '2026-04-10', 0),
        normalizeTrade({
          manualType: 'margin_open_long',
          symbol: '5016',
          name: 'JX',
          quantity: 100,
          price: 200
        }, '2026-04-10', 1),
        normalizeTrade({
          manualType: 'margin_close_short',
          symbol: '9984',
          name: 'SoftBank',
          quantity: 100,
          price: 395,
          settlementAmount: 500,
          marginSettlement: {
            source: 'marginSettlements',
            openDate: '2026-04-10',
            openSide: '売建',
            openPrice: 400,
            closePrice: 395
          }
        }, '2026-04-10', 2),
        normalizeTrade({
          manualType: 'margin_open_short',
          symbol: '9984',
          name: 'SoftBank',
          quantity: 100,
          price: 400
        }, '2026-04-10', 3)
      ]
    }
  ]);
  const remainingLongPosition = analytics.summaries.margin.positions.find((position) => position.symbol === '5016');
  const remainingShortPosition = analytics.summaries.margin.positions.find((position) => position.symbol === '9984');

  assert.equal(analytics.summaries.all.totalProfit, 1000);
  assert.equal(analytics.summaries.margin.positionsCount, 2);
  assert.equal(remainingLongPosition.quantity, 100);
  assert.equal(remainingLongPosition.avgPrice, 100);
  assert.equal(remainingShortPosition.quantity, 100);
  assert.equal(remainingShortPosition.avgPrice, 300);
});
