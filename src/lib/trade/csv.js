import { MANUAL_TYPE_MAP } from './constants.js';
import { collectManualDaysForCsvRebuild, describeTradeType, mergeTradeVersions, normalizeTrade, reindexTrades } from './models.js';
import { cloneActiveRuleSnapshot } from './settings.js';
import {
  compactText,
  compareTradeOrder,
  generateId,
  marketLabelFromKey,
  normalizeAnyDate,
  normalizeMarketKey,
  safeNumber,
  trimText
} from './utils.js';

const CSV_KIND = {
  EXECUTIONS: 'executions',
  MARGIN_SETTLEMENTS: 'marginSettlements',
  TAX_DETAILS: 'taxDetails',
  UNKNOWN: 'unknown'
};

const INVESTMENT_TRUST_PRICE_SCALE = 10000;
const GENBIKI_TRADE_TYPE = '現引';

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const content = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      if (content[index + 1] === '\n') continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => trimText(cell)));
}

function scoreDecodedText(text) {
  const markers = [
    '約定日',
    '決済日',
    '銘柄コード',
    '約定履歴照会',
    '信用決済明細',
    '特定口座損益明細'
  ];
  const markerScore = markers.reduce((score, marker) => score + (text.includes(marker) ? 10 : 0), 0);
  const replacementPenalty = (text.match(/\uFFFD/g) || []).length;
  return markerScore - replacementPenalty;
}

async function decodeCsvFile(file) {
  const buffer = await file.arrayBuffer();

  const tryDecode = (encoding) => {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return '';
    }
  };

  const shiftJisText = tryDecode('shift-jis');
  const utf8Text = tryDecode('utf-8');
  return scoreDecodedText(utf8Text) > scoreDecodedText(shiftJisText)
    ? utf8Text
    : shiftJisText || utf8Text;
}

function findHeaderIndex(rows, firstCell) {
  return rows.findIndex((cells) => trimText(cells[0]) === firstCell);
}

function detectCsvKind(rows) {
  if (findHeaderIndex(rows, '約定日') >= 0) return CSV_KIND.EXECUTIONS;
  if (findHeaderIndex(rows, '決済日') >= 0) return CSV_KIND.MARGIN_SETTLEMENTS;
  if (findHeaderIndex(rows, '銘柄コード') >= 0) return CSV_KIND.TAX_DETAILS;
  return CSV_KIND.UNKNOWN;
}

function getRecordsAfterHeader(rows, firstCell) {
  const headerIndex = findHeaderIndex(rows, firstCell);
  if (headerIndex < 0) return { headers: [], records: [] };

  const headers = rows[headerIndex].map(trimText);
  const records = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => trimText(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, trimText(row[index])])));

  return { headers, records };
}

function toSignedNumber(value) {
  return safeNumber(trimText(value).replace(/^\+/, ''));
}

function numberKey(value) {
  const amount = toSignedNumber(value);
  return amount == null ? '' : String(amount);
}

function quantityKey(value) {
  return numberKey(trimText(value).replace(/[^\d.+-]/g, ''));
}

function optionalNumber(value) {
  const amount = safeNumber(value);
  return amount == null ? '' : amount;
}

function optionalSignedNumber(value) {
  const amount = toSignedNumber(value);
  return amount == null ? '' : amount;
}

function positiveSettlementAmount(record) {
  const amount = toSignedNumber(record['受渡金額/決済損益']);
  return amount == null ? '' : Math.abs(amount);
}

function investmentTrustPrice(record) {
  const price = safeNumber(record['約定単価']);
  return price == null ? '' : price / INVESTMENT_TRUST_PRICE_SCALE;
}

function stableTextHash(value) {
  let hash = 0;
  const text = compactText(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).toUpperCase();
}

function investmentTrustSymbol(record) {
  const code = compactText(record['銘柄コード']);
  if (code) return code;
  return `FUND-${stableTextHash(record['銘柄'] || 'investment-trust')}`;
}

function isGenbikiTradeType(rawTradeType) {
  return trimText(rawTradeType) === GENBIKI_TRADE_TYPE;
}

function inferProductType(manualType, override = '') {
  if (override) return override;
  return manualType.startsWith('fund_') ? 'fund' : 'stock';
}

function buildImportedTrade({
  record,
  date,
  settings,
  manualType,
  baseSignature,
  ordinal,
  entryKey = '',
  marginDetail = null,
  overrides = {}
}) {
  const config = MANUAL_TYPE_MAP[manualType];
  const productType = inferProductType(manualType, overrides.productType);
  const fingerprintSignature = entryKey ? `${baseSignature}:${entryKey}` : baseSignature;
  const market = normalizeMarketKey(overrides.market ?? record['市場']);

  return normalizeTrade({
    id: generateId(),
    source: 'csv',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manualType,
    assetType: overrides.assetType || config.assetType,
    action: overrides.action || config.action,
    positionEffect: overrides.positionEffect || config.positionEffect,
    positionSide: overrides.positionSide || config.positionSide,
    symbol: overrides.symbol ?? compactText(record['銘柄コード']),
    name: overrides.name ?? trimText(record['銘柄']),
    market,
    marketLabel: trimText(overrides.marketLabel ?? (record['市場'] || marketLabelFromKey(market))),
    productType,
    tradeTypeLabel: overrides.tradeTypeLabel || trimText(record['取引']),
    term: trimText(overrides.term ?? (record['期限'] || '--')),
    custody: trimText(overrides.custody ?? (record['預り'] || '特定')),
    taxCategory: trimText(overrides.taxCategory ?? (record['課税'] || '--')),
    quantity: overrides.quantity ?? optionalNumber(record['約定数量']),
    price: overrides.price ?? (productType === 'fund' ? investmentTrustPrice(record) : optionalNumber(record['約定単価'])),
    fee: overrides.fee ?? optionalNumber(record['手数料/諸経費等']),
    taxAmount: overrides.taxAmount ?? optionalNumber(record['税額']),
    holdingCost: overrides.holdingCost ?? '',
    reportedProfit: overrides.reportedProfit ?? '',
    settlementDate: normalizeAnyDate(overrides.settlementDate ?? record['受渡日']) || marginDetail?.marginSettlement.settlementDate || '',
    settlementAmount: overrides.settlementAmount ?? optionalSignedNumber(record['受渡金額/決済損益']),
    marginSettlement: overrides.marginSettlement ?? marginDetail?.marginSettlement ?? null,
    taxDetail: overrides.taxDetail ?? null,
    notes: overrides.notes || '',
    fingerprint: `${fingerprintSignature}#${ordinal}`,
    csvBaseSignature: fingerprintSignature,
    ratioSnapshot: cloneActiveRuleSnapshot(settings, config.assetType)
  }, date, Number(overrides.order ?? ordinal) || 0, settings);
}

function buildCsvBaseSignature(record, normalizedDate) {
  const columns = [
    normalizedDate,
    compactText(record['銘柄'] || ''),
    compactText(record['銘柄コード'] || ''),
    compactText(record['市場'] || ''),
    compactText(record['取引'] || ''),
    compactText(record['期限'] || ''),
    compactText(record['預り'] || ''),
    compactText(record['課税'] || ''),
    compactText(record['約定数量'] || ''),
    compactText(record['約定単価'] || ''),
    compactText(record['手数料/諸経費等'] || ''),
    compactText(record['税額'] || ''),
    compactText(record['受渡日'] || ''),
    compactText(record['受渡金額/決済損益'] || '')
  ];

  return columns.join('|');
}

function buildExecutionMarginCloseKey(record, date) {
  return [
    date,
    compactText(record['銘柄コード']),
    trimText(record['取引']),
    numberKey(record['約定数量']),
    numberKey(record['約定単価']),
    normalizeAnyDate(record['受渡日']) || '',
    numberKey(record['受渡金額/決済損益'])
  ].join('|');
}

function taxMatchSymbol(record) {
  return compactText(record['銘柄コード']) || compactText(record['銘柄']);
}

function buildExecutionTaxDetailKey(record, date) {
  return [
    date,
    taxMatchSymbol(record),
    trimText(record['取引']),
    quantityKey(record['約定数量']),
    normalizeAnyDate(record['受渡日']) || '',
    numberKey(record['受渡金額/決済損益'])
  ].join('|');
}

function buildTaxDetailKey(record, date) {
  return [
    date,
    taxMatchSymbol(record),
    trimText(record['取引']),
    quantityKey(record['数量']),
    normalizeAnyDate(record['受渡日']) || '',
    numberKey(record['売却/決済金額'])
  ].join('|');
}

function buildMarginSettlementKey(record, date) {
  return [
    date,
    compactText(record['銘柄コード']),
    trimText(record['取引']),
    numberKey(record['決済数量']),
    numberKey(record['決済単価']),
    normalizeAnyDate(record['受渡日']) || '',
    numberKey(record['受渡金額/決済損益'])
  ].join('|');
}

function parseMarginSettlementRecord(record) {
  const date = normalizeAnyDate(record['決済日']);
  const settlementAmount = toSignedNumber(record['受渡金額/決済損益']);
  if (!date || !trimText(record['取引']) || settlementAmount == null) return null;

  return {
    key: buildMarginSettlementKey(record, date),
    settlementAmount,
    marginSettlement: {
      source: CSV_KIND.MARGIN_SETTLEMENTS,
      settlementDate: normalizeAnyDate(record['受渡日']) || '',
      closeMarket: trimText(record['決済市場'] || ''),
      openMarket: trimText(record['建市場'] || ''),
      openDate: normalizeAnyDate(record['建日']) || '',
      openSide: trimText(record['買/売建'] || ''),
      openPrice: safeNumber(record['建単価']) ?? '',
      closePrice: safeNumber(record['決済単価']) ?? '',
      openAmount: safeNumber(record['建代金']) ?? '',
      closeAmount: safeNumber(record['決済代金']) ?? '',
      openFee: safeNumber(record['新規建手数料']) ?? '',
      closeFee: safeNumber(record['決済手数料']) ?? '',
      managementFee: safeNumber(record['管理費']) ?? '',
      lendingFee: safeNumber(record['貸株料']) ?? '',
      interestAmount: safeNumber(record['金利']) ?? '',
      holdingDays: safeNumber(record['日数']) ?? '',
      reverseDailyFee: safeNumber(record['逆日歩']) ?? '',
      consumptionTax: safeNumber(record['消費税']) ?? '',
      rewritingFee: safeNumber(record['書換料']) ?? '',
      totalExpenses: safeNumber(record['諸費用計']) ?? ''
    }
  };
}

function parseMarginSettlementCsv(rows) {
  const { records } = getRecordsAfterHeader(rows, '決済日');
  const details = records.map(parseMarginSettlementRecord).filter(Boolean);
  const totalPnl = details.reduce((sum, detail) => sum + (Number(detail.settlementAmount) || 0), 0);
  const totalInterest = details.reduce((sum, detail) => sum + (Number(detail.marginSettlement.interestAmount) || 0), 0);
  const totalExpenses = details.reduce((sum, detail) => sum + (Number(detail.marginSettlement.totalExpenses) || 0), 0);

  return {
    details,
    summary: {
      rows: records.length,
      importedRows: details.length,
      totalPnl,
      totalInterest,
      totalExpenses
    }
  };
}

function buildMarginSettlementQueues(details) {
  const queues = new Map();

  details.forEach((detail) => {
    const queue = queues.get(detail.key) || [];
    queue.push(detail);
    queues.set(detail.key, queue);
  });

  return queues;
}

function consumeMarginSettlement(queues, record, date) {
  const key = buildExecutionMarginCloseKey(record, date);
  const queue = queues.get(key);
  if (!queue?.length) return null;
  return queue.shift();
}

function parseTaxPeriod(rows) {
  const headerIndex = findHeaderIndex(rows, '受渡開始年月日');
  if (headerIndex < 0) return { settlementStartDate: '', settlementEndDate: '' };

  const row = rows[headerIndex + 1] || [];
  return {
    settlementStartDate: normalizeAnyDate(row[0]) || '',
    settlementEndDate: normalizeAnyDate(row[1]) || ''
  };
}

function parseTaxCsv(rows) {
  const { records } = getRecordsAfterHeader(rows, '銘柄コード');
  const tradeRows = records.filter((record) => {
    const code = trimText(record['銘柄コード']);
    if (code === '譲渡益税徴収額') return false;
    return Boolean(code || trimText(record['銘柄'])) && Boolean(trimText(record['取引']));
  });
  const taxRows = records.filter((record) => trimText(record['銘柄コード']) === '譲渡益税徴収額');
  const period = parseTaxPeriod(rows);
  const details = tradeRows.map((record) => {
    const date = normalizeAnyDate(record['約定日']);
    const profit = toSignedNumber(record['損益金額/徴収額']);
    if (!date || !trimText(record['取引']) || profit == null) return null;

    return {
      key: buildTaxDetailKey(record, date),
      reportedProfit: profit,
      taxDetail: {
        source: CSV_KIND.TAX_DETAILS,
        settlementDate: normalizeAnyDate(record['受渡日']) || '',
        sellAmount: safeNumber(record['売却/決済金額']) ?? '',
        fee: safeNumber(record['費用']) ?? '',
        acquisitionDate: normalizeAnyDate(record['取得/新規年月日']) || '',
        acquisitionAmount: safeNumber(record['取得/新規金額']) ?? '',
        profit
      }
    };
  }).filter(Boolean);

  const totalProfit = tradeRows.reduce((sum, record) => sum + (toSignedNumber(record['損益金額/徴収額']) || 0), 0);
  const incomeTax = taxRows.reduce((sum, record) => sum + (toSignedNumber(record['損益金額/徴収額']) || 0), 0);
  const localTax = taxRows.reduce((sum, record) => sum + (toSignedNumber(record['地方税']) || 0), 0);

  return {
    details,
    summary: {
      ...period,
      rows: records.length,
      importedRows: details.length,
      tradeRows: tradeRows.length,
      taxRows: taxRows.length,
      totalProfit,
      incomeTax,
      localTax,
      totalTax: incomeTax + localTax
    }
  };
}

function buildTaxDetailQueues(details) {
  const queues = new Map();

  details.forEach((detail) => {
    const queue = queues.get(detail.key) || [];
    queue.push(detail);
    queues.set(detail.key, queue);
  });

  return queues;
}

function consumeTaxDetail(queues, record, date) {
  const key = buildExecutionTaxDetailKey(record, date);
  const queue = queues.get(key);
  if (!queue?.length) return null;
  return queue.shift();
}

function parseExecutionRecords(records, settings, marginSettlementQueues, taxDetailQueues, sharedSeen) {
  const trades = [];
  const summary = {
    totalRows: records.length,
    importedRows: 0,
    importedSourceRows: 0,
    importedInvestmentTrustRows: 0,
    importedConversionRows: 0,
    generatedConversionTrades: 0,
    skippedInvestmentTrust: 0,
    skippedUnsupported: 0,
    skippedEmpty: 0,
    matchedMarginSettlementRows: 0,
    matchedTaxDetailRows: 0
  };

  records.forEach((record) => {
    const rawTradeType = trimText(record['取引']);
    const rawDate = trimText(record['約定日']);

    if (!rawDate || !rawTradeType) {
      summary.skippedEmpty += 1;
      return;
    }

    const descriptor = describeTradeType(rawTradeType);
    const isGenbiki = isGenbikiTradeType(rawTradeType);
    if (!descriptor.supported && !isGenbiki) {
      if (rawTradeType.includes('投信')) {
        summary.skippedInvestmentTrust += 1;
        return;
      }
      summary.skippedUnsupported += 1;
      return;
    }

    const date = normalizeAnyDate(rawDate);
    if (!date) {
      summary.skippedEmpty += 1;
      return;
    }

    const baseSignature = buildCsvBaseSignature(record, date);
    const ordinal = (sharedSeen.get(baseSignature) || 0) + 1;
    sharedSeen.set(baseSignature, ordinal);

    if (isGenbiki) {
      const transferCost = positiveSettlementAmount(record)
        || ((optionalNumber(record['約定数量']) || 0) * (optionalNumber(record['約定単価']) || 0))
          + (optionalNumber(record['手数料/諸経費等']) || 0)
          + (optionalNumber(record['税額']) || 0);
      const fee = optionalNumber(record['手数料/諸経費等']);

      trades.push({
        date,
        trade: buildImportedTrade({
          record,
          date,
          settings,
          manualType: 'margin_close_long',
          baseSignature,
          ordinal,
          entryKey: 'genbiki-margin-close',
          overrides: {
            tradeTypeLabel: '現引（信用決済）',
            settlementAmount: 0,
            marginSettlement: fee === ''
              ? null
              : {
                  source: CSV_KIND.EXECUTIONS,
                  settlementDate: normalizeAnyDate(record['受渡日']) || '',
                  totalExpenses: fee,
                  interestAmount: fee
                },
            notes: '現引转换：减少信用买建，不确认交易损益。',
            order: ordinal * 2 - 1
          }
        })
      });
      trades.push({
        date,
        trade: buildImportedTrade({
          record,
          date,
          settings,
          manualType: 'spot_buy',
          baseSignature,
          ordinal,
          entryKey: 'genbiki-cash-open',
          overrides: {
            tradeTypeLabel: '現引（現物化）',
            settlementAmount: transferCost,
            notes: '現引转换：以受渡金额作为现物取得成本。',
            order: ordinal * 2
          }
        })
      });

      summary.importedSourceRows += 1;
      summary.importedConversionRows += 1;
      summary.generatedConversionTrades += 2;
      return;
    }

    const manualType = descriptor.manualType;
    const config = MANUAL_TYPE_MAP[manualType];
    const market = normalizeMarketKey(record['市場']);
    const marginDetail = config.assetType === 'margin' && config.positionEffect === 'close'
      ? consumeMarginSettlement(marginSettlementQueues, record, date)
      : null;
    const taxDetail = config.assetType === 'cash' && config.positionEffect === 'close'
      ? consumeTaxDetail(taxDetailQueues, record, date)
      : null;
    const settlementAmount = safeNumber(record['受渡金額/決済損益'])
      ?? marginDetail?.settlementAmount
      ?? '';

    if (marginDetail) {
      summary.matchedMarginSettlementRows += 1;
    }
    if (taxDetail) {
      summary.matchedTaxDetailRows += 1;
    }

    trades.push({
      date,
      trade: buildImportedTrade({
        record,
        date,
        settings,
        manualType,
        baseSignature,
        ordinal,
        marginDetail,
        overrides: manualType.startsWith('fund_')
          ? {
              symbol: investmentTrustSymbol(record),
              productType: 'fund',
              price: investmentTrustPrice(record),
              settlementAmount: positiveSettlementAmount(record),
              reportedProfit: taxDetail?.reportedProfit ?? '',
              taxDetail: taxDetail?.taxDetail ?? null
            }
          : {
              market,
              settlementAmount,
              reportedProfit: taxDetail?.reportedProfit ?? '',
              taxDetail: taxDetail?.taxDetail ?? null
            }
      })
    });

    summary.importedSourceRows += 1;
    if (manualType.startsWith('fund_')) {
      summary.importedInvestmentTrustRows += 1;
    }
  });

  summary.importedRows = trades.length;
  return { trades, summary };
}

async function readCsvFile(file) {
  const text = await decodeCsvFile(file);
  const rows = parseCsvRows(text);
  return {
    name: file?.name || 'CSV',
    kind: detectCsvKind(rows),
    rows
  };
}

function mergeSummaries(left, right) {
  return {
    totalRows: left.totalRows + right.totalRows,
    importedRows: left.importedRows + right.importedRows,
    importedSourceRows: (left.importedSourceRows || 0) + (right.importedSourceRows || 0),
    importedInvestmentTrustRows: (left.importedInvestmentTrustRows || 0) + (right.importedInvestmentTrustRows || 0),
    importedConversionRows: (left.importedConversionRows || 0) + (right.importedConversionRows || 0),
    generatedConversionTrades: (left.generatedConversionTrades || 0) + (right.generatedConversionTrades || 0),
    skippedInvestmentTrust: left.skippedInvestmentTrust + right.skippedInvestmentTrust,
    skippedUnsupported: left.skippedUnsupported + right.skippedUnsupported,
    skippedEmpty: left.skippedEmpty + right.skippedEmpty,
    matchedMarginSettlementRows: left.matchedMarginSettlementRows + right.matchedMarginSettlementRows,
    matchedTaxDetailRows: (left.matchedTaxDetailRows || 0) + (right.matchedTaxDetailRows || 0)
  };
}

export async function rebuildDaysFromCsvFiles(files, currentDays, settings) {
  const fileList = Array.from(files || []).filter(Boolean);
  if (!fileList.length) {
    throw new Error('请选择至少一个 CSV 文件。');
  }

  const parsedFiles = await Promise.all(fileList.map(readCsvFile));
  const executionFiles = parsedFiles.filter((file) => file.kind === CSV_KIND.EXECUTIONS);
  const marginSettlementFiles = parsedFiles.filter((file) => file.kind === CSV_KIND.MARGIN_SETTLEMENTS);
  const taxFiles = parsedFiles.filter((file) => file.kind === CSV_KIND.TAX_DETAILS);
  const unknownFiles = parsedFiles.filter((file) => file.kind === CSV_KIND.UNKNOWN);

  if (!executionFiles.length) {
    throw new Error('没有找到“約定履歴.csv”。请至少上传约定履历，信用决済和税务明细只能作为辅助文件。');
  }

  const marginSettlementResults = marginSettlementFiles.map((file) => parseMarginSettlementCsv(file.rows));
  const marginSettlementDetails = marginSettlementResults.flatMap((result) => result.details);
  const marginSettlementQueues = buildMarginSettlementQueues(marginSettlementDetails);
  const taxResults = taxFiles.map((file) => parseTaxCsv(file.rows));
  const taxDetails = taxResults.flatMap((result) => result.details);
  const taxDetailQueues = buildTaxDetailQueues(taxDetails);
  const sharedSeen = new Map();

  let parsed = {
    trades: [],
    summary: {
      totalRows: 0,
      importedRows: 0,
      importedSourceRows: 0,
      importedInvestmentTrustRows: 0,
      importedConversionRows: 0,
      generatedConversionTrades: 0,
      skippedInvestmentTrust: 0,
      skippedUnsupported: 0,
      skippedEmpty: 0,
      matchedMarginSettlementRows: 0,
      matchedTaxDetailRows: 0
    }
  };

  executionFiles.forEach((file) => {
    const { records } = getRecordsAfterHeader(file.rows, '約定日');
    const result = parseExecutionRecords(records, settings, marginSettlementQueues, taxDetailQueues, sharedSeen);
    parsed = {
      trades: [...parsed.trades, ...result.trades],
      summary: mergeSummaries(parsed.summary, result.summary)
    };
  });

  if (!parsed.trades.length) {
    throw new Error('CSV 里没有可导入的现物或信用交易。');
  }

  const taxSummaries = taxResults.map((result) => result.summary);
  const marginSettlementSummary = marginSettlementResults.reduce((accumulator, result) => ({
    rows: accumulator.rows + result.summary.rows,
    importedRows: accumulator.importedRows + result.summary.importedRows,
    totalPnl: accumulator.totalPnl + result.summary.totalPnl,
    totalInterest: accumulator.totalInterest + result.summary.totalInterest,
    totalExpenses: accumulator.totalExpenses + result.summary.totalExpenses
  }), {
    rows: 0,
    importedRows: 0,
    totalPnl: 0,
    totalInterest: 0,
    totalExpenses: 0
  });

  const now = new Date().toISOString();
  const workingDays = collectManualDaysForCsvRebuild(currentDays, settings);

  parsed.trades.forEach(({ date, trade }) => {
    const day = workingDays.get(date) || {
      id: generateId(),
      date,
      trades: [],
      updatedAt: now
    };

    const matchIndex = day.trades.findIndex((existingTrade) => {
      if (existingTrade.fingerprint && trade.fingerprint) {
        return existingTrade.fingerprint === trade.fingerprint;
      }
      if (!existingTrade.fingerprint) {
        return existingTrade.csvBaseSignature
          ? existingTrade.csvBaseSignature === trade.csvBaseSignature
          : false;
      }
      return false;
    });

    if (matchIndex >= 0) {
      day.trades[matchIndex] = mergeTradeVersions(day.trades[matchIndex], {
        ...trade,
        updatedAt: now,
        ratioSnapshot: day.trades[matchIndex].ratioSnapshot || trade.ratioSnapshot
      }, date, settings);
    } else {
      day.trades.push(normalizeTrade({
        ...trade,
        updatedAt: now,
        order: day.trades.length
      }, date, day.trades.length, settings));
    }

    day.trades = reindexTrades(day.trades.sort(compareTradeOrder), date, settings);
    day.updatedAt = now;
    workingDays.set(date, day);
  });

  const days = Array.from(workingDays.values())
    .filter((day) => day.trades.length > 0)
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    days,
    summary: {
      ...parsed.summary,
      fileCount: fileList.length,
      fileTypes: {
        executions: executionFiles.length,
        marginSettlements: marginSettlementFiles.length,
        taxDetails: taxFiles.length,
        unknown: unknownFiles.length
      },
      marginSettlements: {
        ...marginSettlementSummary,
        unmatchedRows: Math.max(0, marginSettlementSummary.importedRows - parsed.summary.matchedMarginSettlementRows)
      },
      taxDetailRows: taxDetails.length,
      unmatchedTaxDetailRows: Math.max(0, taxDetails.length - parsed.summary.matchedTaxDetailRows),
      taxDetails: taxSummaries
    }
  };
}

export async function rebuildDaysFromCsv(file, currentDays, settings) {
  return rebuildDaysFromCsvFiles([file], currentDays, settings);
}
