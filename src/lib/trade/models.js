import { MANUAL_TYPE_MAP } from './constants.js';
import { cloneActiveRuleSnapshot, createDefaultSettings, normalizeRuleSnapshot } from './settings.js';
import {
  compactText,
  compareByDateAsc,
  compareTradeOrder,
  generateId,
  marketLabelFromKey,
  normalizeAnyDate,
  normalizeMarketKey,
  safeNumber,
  todayStr,
  trimText
} from './utils.js';

function resolveSettings(settings) {
  return settings || createDefaultSettings();
}

function normalizeOptionalNumber(value) {
  return value === '' ? '' : (safeNumber(value) ?? '');
}

function normalizeMarginSettlement(rawDetail) {
  if (!rawDetail || typeof rawDetail !== 'object') return null;

  const detail = {
    source: trimText(rawDetail.source || ''),
    settlementDate: normalizeAnyDate(rawDetail.settlementDate) || '',
    closeMarket: trimText(rawDetail.closeMarket || ''),
    openMarket: trimText(rawDetail.openMarket || ''),
    openDate: normalizeAnyDate(rawDetail.openDate) || '',
    openSide: trimText(rawDetail.openSide || ''),
    openPrice: normalizeOptionalNumber(rawDetail.openPrice),
    closePrice: normalizeOptionalNumber(rawDetail.closePrice),
    openAmount: normalizeOptionalNumber(rawDetail.openAmount),
    closeAmount: normalizeOptionalNumber(rawDetail.closeAmount),
    openFee: normalizeOptionalNumber(rawDetail.openFee),
    closeFee: normalizeOptionalNumber(rawDetail.closeFee),
    managementFee: normalizeOptionalNumber(rawDetail.managementFee),
    lendingFee: normalizeOptionalNumber(rawDetail.lendingFee),
    interestAmount: normalizeOptionalNumber(rawDetail.interestAmount),
    holdingDays: normalizeOptionalNumber(rawDetail.holdingDays),
    reverseDailyFee: normalizeOptionalNumber(rawDetail.reverseDailyFee),
    consumptionTax: normalizeOptionalNumber(rawDetail.consumptionTax),
    rewritingFee: normalizeOptionalNumber(rawDetail.rewritingFee),
    totalExpenses: normalizeOptionalNumber(rawDetail.totalExpenses)
  };

  return Object.values(detail).some((value) => value !== '' && value != null) ? detail : null;
}

function normalizeTaxDetail(rawDetail) {
  if (!rawDetail || typeof rawDetail !== 'object') return null;

  const detail = {
    source: trimText(rawDetail.source || ''),
    settlementDate: normalizeAnyDate(rawDetail.settlementDate) || '',
    sellAmount: normalizeOptionalNumber(rawDetail.sellAmount),
    fee: normalizeOptionalNumber(rawDetail.fee),
    acquisitionDate: normalizeAnyDate(rawDetail.acquisitionDate) || '',
    acquisitionAmount: normalizeOptionalNumber(rawDetail.acquisitionAmount),
    profit: normalizeOptionalNumber(rawDetail.profit)
  };

  return Object.values(detail).some((value) => value !== '' && value != null) ? detail : null;
}

export function inferManualTypeFromFields(assetType, action, positionEffect, positionSide) {
  return Object.keys(MANUAL_TYPE_MAP).find((key) => {
    const item = MANUAL_TYPE_MAP[key];
    return item.assetType === assetType
      && item.action === action
      && item.positionEffect === positionEffect
      && item.positionSide === positionSide;
  }) || (assetType === 'margin' ? 'margin_open_long' : 'spot_buy');
}

export function getManualTypeOptions(assetType) {
  if (assetType === 'margin') {
    return ['margin_open_long', 'margin_close_long', 'margin_open_short', 'margin_close_short'];
  }
  return ['spot_buy', 'spot_sell'];
}

export function describeTradeType(rawTradeType = '') {
  const value = trimText(rawTradeType);
  if (!value) return { supported: false };

  if (value === '株式現物買') return { supported: true, manualType: 'spot_buy' };
  if (value === '株式現物売') return { supported: true, manualType: 'spot_sell' };
  if (value === '投信金額買付') return { supported: true, manualType: 'fund_buy' };
  if (value === '投信金額解約') return { supported: true, manualType: 'fund_sell' };
  if (value === '信用新規買') return { supported: true, manualType: 'margin_open_long' };
  if (value === '信用返済売') return { supported: true, manualType: 'margin_close_long' };
  if (value === '信用新規売') return { supported: true, manualType: 'margin_open_short' };
  if (value === '信用返済買') return { supported: true, manualType: 'margin_close_short' };

  if (value.includes('株式現物') && value.includes('買')) return { supported: true, manualType: 'spot_buy' };
  if (value.includes('株式現物') && value.includes('売')) return { supported: true, manualType: 'spot_sell' };
  if (value.includes('投信') && value.includes('買付')) return { supported: true, manualType: 'fund_buy' };
  if (value.includes('投信') && value.includes('解約')) return { supported: true, manualType: 'fund_sell' };
  if (value.includes('信用') && value.includes('新規') && value.includes('買')) return { supported: true, manualType: 'margin_open_long' };
  if (value.includes('信用') && value.includes('返済') && value.includes('売')) return { supported: true, manualType: 'margin_close_long' };
  if (value.includes('信用') && value.includes('新規') && value.includes('売')) return { supported: true, manualType: 'margin_open_short' };
  if (value.includes('信用') && value.includes('返済') && value.includes('買')) return { supported: true, manualType: 'margin_close_short' };

  return { supported: false };
}

export function isTradeComplete(trade) {
  return Boolean(trimText(trade?.symbol)) && (Number(trade?.quantity) || 0) > 0 && (Number(trade?.price) || 0) > 0;
}

export function createManualTrade(settings, preset = {}) {
  const nextSettings = resolveSettings(settings);
  const manualType = preset.manualType || 'spot_buy';
  const config = MANUAL_TYPE_MAP[manualType] || MANUAL_TYPE_MAP.spot_buy;
  const now = new Date().toISOString();

  return normalizeTrade({
    id: preset.id || generateId(),
    source: 'manual',
    createdAt: preset.createdAt || now,
    updatedAt: preset.updatedAt || now,
    manualType,
    symbol: preset.symbol || '',
    name: preset.name || '',
    market: preset.market || 'tse',
    marketLabel: preset.marketLabel || marketLabelFromKey(preset.market || 'tse'),
    productType: preset.productType || 'stock',
    term: preset.term || '--',
    custody: preset.custody || '特定',
    taxCategory: preset.taxCategory || '--',
    quantity: preset.quantity ?? '',
    price: preset.price ?? '',
    fee: preset.fee ?? '',
    taxAmount: preset.taxAmount ?? '',
    holdingCost: preset.holdingCost ?? '',
    reportedProfit: preset.reportedProfit ?? '',
    settlementDate: preset.settlementDate || '',
    settlementAmount: preset.settlementAmount ?? '',
    notes: preset.notes || '',
    assetType: config.assetType,
    action: config.action,
    positionEffect: config.positionEffect,
    positionSide: config.positionSide,
    tradeTypeLabel: config.tradeTypeLabel,
    ratioSnapshot: preset.ratioSnapshot || cloneActiveRuleSnapshot(nextSettings, config.assetType),
    order: preset.order ?? 0
  }, preset.date || todayStr(), Number(preset.order) || 0, nextSettings);
}

export function normalizeTrade(trade, dayDate, index = 0, settings = createDefaultSettings()) {
  const raw = trade && typeof trade === 'object' ? trade : {};
  const fallbackManualType = raw.manualType
    || describeTradeType(raw.tradeTypeLabel || raw.tradeType || '').manualType
    || inferManualTypeFromFields(
      raw.assetType || 'cash',
      raw.action || 'buy',
      raw.positionEffect || 'open',
      raw.positionSide || 'long'
    );
  const config = MANUAL_TYPE_MAP[fallbackManualType] || MANUAL_TYPE_MAP.spot_buy;
  const symbol = compactText(raw.symbol || raw.code || '');
  const assetType = raw.assetType || config.assetType;
  const nextSettings = resolveSettings(settings);

  return {
    id: raw.id || generateId(),
    source: raw.source || (raw.fingerprint ? 'csv' : 'manual'),
    createdAt: raw.createdAt || raw.updatedAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    symbol,
    name: trimText(raw.name || ''),
    manualType: fallbackManualType,
    assetType,
    action: raw.action || config.action,
    positionEffect: raw.positionEffect || config.positionEffect,
    positionSide: raw.positionSide || config.positionSide,
    market: normalizeMarketKey(raw.market || raw.marketLabel),
    marketLabel: trimText(raw.marketLabel || marketLabelFromKey(normalizeMarketKey(raw.market || raw.marketLabel))),
    productType: trimText(raw.productType || (fallbackManualType.startsWith('fund_') ? 'fund' : 'stock')),
    tradeTypeLabel: trimText(raw.tradeTypeLabel || config.tradeTypeLabel),
    term: trimText(raw.term || '--'),
    custody: trimText(raw.custody || '特定'),
    taxCategory: trimText(raw.taxCategory || '--'),
    quantity: raw.quantity === '' ? '' : (safeNumber(raw.quantity) ?? ''),
    price: raw.price === '' ? '' : (safeNumber(raw.price) ?? ''),
    fee: raw.fee === '' ? '' : (safeNumber(raw.fee) ?? ''),
    taxAmount: raw.taxAmount === '' ? '' : (safeNumber(raw.taxAmount) ?? ''),
    holdingCost: raw.holdingCost === '' ? '' : (safeNumber(raw.holdingCost) ?? ''),
    reportedProfit: raw.reportedProfit === '' ? '' : (safeNumber(raw.reportedProfit) ?? ''),
    settlementDate: normalizeAnyDate(raw.settlementDate) || '',
    settlementAmount: raw.settlementAmount === '' ? '' : (safeNumber(raw.settlementAmount) ?? ''),
    notes: trimText(raw.notes || ''),
    fingerprint: trimText(raw.fingerprint || ''),
    csvBaseSignature: trimText(raw.csvBaseSignature || ''),
    marginSettlement: normalizeMarginSettlement(raw.marginSettlement),
    taxDetail: normalizeTaxDetail(raw.taxDetail),
    ratioSnapshot: normalizeRuleSnapshot(raw.ratioSnapshot || cloneActiveRuleSnapshot(nextSettings, assetType), assetType)
  };
}

export function normalizeDay(day, settings = createDefaultSettings()) {
  const date = normalizeAnyDate(day?.date) || todayStr();
  const trades = Array.isArray(day?.trades)
    ? day.trades.map((trade, index) => normalizeTrade(trade, date, index, settings)).sort(compareTradeOrder)
    : [];

  return {
    id: day?.id || generateId(),
    date,
    trades: trades.map((trade, index) => ({ ...trade, order: index })),
    updatedAt: day?.updatedAt || new Date().toISOString()
  };
}

export function reindexTrades(trades, date, settings = createDefaultSettings()) {
  return trades.map((trade, index) => normalizeTrade({ ...trade, order: index }, date, index, settings));
}

export function buildTradeSoftKey(date, trade, settings = createDefaultSettings()) {
  const normalized = normalizeTrade(trade, date, Number(trade?.order) || 0, settings);
  return [
    date,
    normalized.symbol,
    normalized.assetType,
    normalized.action,
    normalized.positionEffect,
    normalized.positionSide,
    normalized.productType,
    normalized.market,
    normalized.quantity,
    normalized.price,
    normalized.settlementDate || ''
  ].join('|');
}

export function isCsvImportedTrade(trade) {
  const source = trimText(trade?.source || '');
  return source === 'csv' || Boolean(trimText(trade?.fingerprint || trade?.csvBaseSignature || ''));
}

export function collectManualDaysForCsvRebuild(days, settings = createDefaultSettings()) {
  const manualDays = new Map();

  days.map((day) => normalizeDay(day, settings)).forEach((day) => {
    const manualTrades = day.trades
      .filter((trade) => !isCsvImportedTrade(trade) && trimText(trade.source) === 'manual')
      .map((trade, index) => normalizeTrade({ ...trade, order: index }, day.date, index, settings));

    if (!manualTrades.length) return;

    manualDays.set(day.date, {
      id: day.id || generateId(),
      date: day.date,
      trades: reindexTrades(manualTrades, day.date, settings),
      updatedAt: day.updatedAt || new Date().toISOString()
    });
  });

  return manualDays;
}

function getStableTradeIdentityKeys(date, trade, settings) {
  const normalized = normalizeTrade(trade, date, Number(trade?.order) || 0, settings);
  const keys = [];
  if (normalized.id) keys.push(`id:${normalized.id}`);
  if (normalized.fingerprint) keys.push(`fp:${normalized.fingerprint}`);
  if (!normalized.fingerprint && normalized.csvBaseSignature) keys.push(`csv:${normalized.csvBaseSignature}`);
  return keys;
}

function canUseSoftTradeKey(trade) {
  return !isCsvImportedTrade(trade);
}

function buildSoftTradeIdentityKey(date, trade, settings) {
  return `soft:${buildTradeSoftKey(date, trade, settings)}`;
}

function countSoftTradeKeys(date, trades, settings) {
  const counts = new Map();
  trades.forEach((trade) => {
    if (!canUseSoftTradeKey(trade)) return;
    const key = buildSoftTradeIdentityKey(date, trade, settings);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

export function mergeTradeVersions(existingTrade, incomingTrade, date, settings = createDefaultSettings()) {
  const existing = normalizeTrade(existingTrade, date, Number(existingTrade?.order) || 0, settings);
  const incoming = normalizeTrade(incomingTrade, date, Number(incomingTrade?.order) || 0, settings);
  const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
  const incomingTime = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime();

  const preferred = incomingTime >= existingTime ? incoming : existing;
  const secondary = incomingTime >= existingTime ? existing : incoming;

  return normalizeTrade({
    ...secondary,
    ...preferred,
    id: existing.id || incoming.id,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: preferred.updatedAt || secondary.updatedAt || new Date().toISOString(),
    notes: preferred.notes || secondary.notes,
    fingerprint: preferred.fingerprint || secondary.fingerprint,
    csvBaseSignature: preferred.csvBaseSignature || secondary.csvBaseSignature,
    marginSettlement: preferred.marginSettlement || secondary.marginSettlement || null,
    taxDetail: preferred.taxDetail || secondary.taxDetail || null,
    ratioSnapshot: preferred.ratioSnapshot || secondary.ratioSnapshot || cloneActiveRuleSnapshot(settings, preferred.assetType)
  }, date, Number(preferred.order) || 0, settings);
}

export function mergeTradeLists(date, localTrades, remoteTrades, settings = createDefaultSettings()) {
  const normalizedLocal = (Array.isArray(localTrades) ? localTrades : [])
    .map((trade, index) => normalizeTrade(trade, date, index, settings));
  const normalizedRemote = (Array.isArray(remoteTrades) ? remoteTrades : [])
    .map((trade, index) => normalizeTrade(trade, date, index, settings));
  const merged = [];
  const stableKeyMap = new Map();
  const softKeyMap = new Map();
  const localSoftCounts = countSoftTradeKeys(date, normalizedLocal, settings);
  const remoteSoftCounts = countSoftTradeKeys(date, normalizedRemote, settings);

  const indexStableKeys = (trade, index) => {
    getStableTradeIdentityKeys(date, trade, settings).forEach((key) => stableKeyMap.set(key, index));
  };

  const registerLocalTrade = (trade) => {
    const index = merged.push(trade) - 1;
    indexStableKeys(trade, index);

    if (!canUseSoftTradeKey(trade)) return;

    const softKey = buildSoftTradeIdentityKey(date, trade, settings);
    if (localSoftCounts.get(softKey) === 1 && remoteSoftCounts.get(softKey) === 1) {
      softKeyMap.set(softKey, index);
    }
  };

  const registerRemoteTrade = (trade) => {
    const stableKeys = getStableTradeIdentityKeys(date, trade, settings);
    let matchedIndex = stableKeys.map((key) => stableKeyMap.get(key)).find((value) => value != null);

    if (matchedIndex == null && canUseSoftTradeKey(trade)) {
      const softKey = buildSoftTradeIdentityKey(date, trade, settings);
      if (localSoftCounts.get(softKey) === 1 && remoteSoftCounts.get(softKey) === 1) {
        matchedIndex = softKeyMap.get(softKey);
      }
    }

    if (matchedIndex == null) {
      const index = merged.push(trade) - 1;
      indexStableKeys(trade, index);
      return;
    }

    const next = mergeTradeVersions(merged[matchedIndex], trade, date, settings);
    merged[matchedIndex] = next;
    indexStableKeys(next, matchedIndex);
  };

  normalizedLocal.forEach(registerLocalTrade);
  normalizedRemote.forEach(registerRemoteTrade);

  return reindexTrades(merged.sort(compareTradeOrder), date, settings);
}

function mergeDayWithAuthoritativeCsv(date, local, remote, settings, csvSource) {
  const authoritative = csvSource === 'remote' ? remote : local;
  if (!authoritative) return null;
  const readTime = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  };

  return normalizeDay({
    ...authoritative,
    id: authoritative.id || local?.id || remote?.id || generateId(),
    date,
    updatedAt: new Date(Math.max(
      readTime(authoritative.updatedAt),
      readTime(local?.updatedAt),
      readTime(remote?.updatedAt)
    )).toISOString()
  }, settings);
}

export function mergeDays(localDays, cloudDays, settings = createDefaultSettings(), options = {}) {
  const csvSource = options.csvSource === 'local' || options.csvSource === 'remote'
    ? options.csvSource
    : 'merge';
  const byDate = new Map();
  const localMap = new Map(localDays.map((day) => {
    const normalized = normalizeDay(day, settings);
    return [normalized.date, normalized];
  }));
  const cloudMap = new Map(cloudDays.map((day) => {
    const normalized = normalizeDay(day, settings);
    return [normalized.date, normalized];
  }));
  const allDates = new Set([...localMap.keys(), ...cloudMap.keys()]);

  allDates.forEach((date) => {
    const local = localMap.get(date);
    const remote = cloudMap.get(date);

    if (csvSource !== 'merge') {
      const mergedDay = mergeDayWithAuthoritativeCsv(date, local, remote, settings, csvSource);
      if (mergedDay) byDate.set(date, mergedDay);
      return;
    }

    if (!local) {
      byDate.set(date, normalizeDay(remote, settings));
      return;
    }

    if (!remote) {
      byDate.set(date, normalizeDay(local, settings));
      return;
    }

    const mergedTrades = mergeTradeLists(date, local.trades, remote.trades, settings);
    const mergedDay = normalizeDay({
      id: local.id || remote.id || generateId(),
      date,
      trades: mergedTrades,
      updatedAt: new Date(Math.max(
        new Date(local.updatedAt || 0).getTime(),
        new Date(remote.updatedAt || 0).getTime()
      )).toISOString()
    }, settings);

    byDate.set(date, mergedDay);
  });

  return Array.from(byDate.values()).sort(compareByDateAsc);
}
