import { DAYS_IN_YEAR, MARGIN_INTEREST_RATE } from './constants.js';
import { getStockDisplayName } from './company-data.js';
import {
  calculateInclusiveHoldingDays,
  roundMoney,
  safeNumber
} from './utils.js';

const LOT_PRICE_TOLERANCE = 0.05;

export function createPositionBooks() {
  return {
    cashPositions: new Map(),
    marginLongPositions: new Map(),
    marginShortPositions: new Map()
  };
}

function getTradeReportedClosePnl(trade) {
  if (trade.assetType === 'margin' && trade.positionEffect === 'close') {
    return trade.settlementAmount === '' ? null : safeNumber(trade.settlementAmount);
  }

  if (trade.assetType === 'cash' && trade.action === 'sell') {
    return trade.reportedProfit === '' ? null : safeNumber(trade.reportedProfit);
  }

  return null;
}

function getTradeHoldingCostOverride(trade) {
  return trade.holdingCost === '' ? null : safeNumber(trade.holdingCost);
}

function sumKnownNumbers(values) {
  return values.reduce((sum, value) => {
    const amount = safeNumber(value);
    return amount == null ? sum : sum + amount;
  }, 0);
}

function getTradeReportedCloseCost(trade) {
  if (getTradeReportedClosePnl(trade) == null) return null;

  const detail = trade.marginSettlement;
  const totalExpenses = safeNumber(detail?.totalExpenses);
  if (totalExpenses != null) return totalExpenses;

  const detailedExpenses = sumKnownNumbers([
    detail?.openFee,
    detail?.closeFee,
    detail?.managementFee,
    detail?.lendingFee,
    detail?.interestAmount,
    detail?.reverseDailyFee,
    detail?.consumptionTax,
    detail?.rewritingFee,
    trade.taxDetail?.fee
  ]);
  if (detailedExpenses > 0) return detailedExpenses;

  const executionExpenses = sumKnownNumbers([trade.fee, trade.taxAmount]);
  return executionExpenses > 0 ? executionExpenses : null;
}

function getLotUnitPrice(lot, valueKey) {
  const explicitPrice = safeNumber(lot.openPrice);
  if (explicitPrice != null) return explicitPrice;

  const quantity = Number(lot.quantity) || 0;
  const value = Number(lot[valueKey]) || 0;
  return quantity > 0 && value > 0 ? value / quantity : null;
}

function createMarginSettlementLotMatcher(trade, valueKey) {
  const detail = trade.marginSettlement;
  if (!detail || typeof detail !== 'object') return null;

  // 信用決済明細 identifies the opening lot, so prefer that before falling back to FIFO.
  const openDate = detail.openDate || '';
  const openPrice = safeNumber(detail.openPrice);
  if (!openDate && openPrice == null) return null;

  return (lot) => {
    if (openDate && lot.openDate !== openDate) return false;

    const lotPrice = getLotUnitPrice(lot, valueKey);
    if (openPrice != null && lotPrice != null && Math.abs(lotPrice - openPrice) > LOT_PRICE_TOLERANCE) {
      return false;
    }

    return true;
  };
}

function addLongPosition(map, trade, quantity, totalCost, openedDate = '', openedPrice = null) {
  const symbol = trade.symbol;
  if (!map.has(symbol)) {
    map.set(symbol, {
      symbol,
      name: getStockDisplayName(symbol, trade.name),
      quantity: 0,
      totalCost: 0,
      market: trade.market,
      lots: []
    });
  }

  const position = map.get(symbol);
  position.name = trade.name || position.name || getStockDisplayName(symbol);
  position.market = trade.market || position.market || 'tse';
  position.quantity += quantity;
  position.totalCost += totalCost;

  if (quantity > 0 && totalCost > 0) {
    position.lots.push({
      openDate: openedDate,
      openPrice: safeNumber(openedPrice) ?? safeNumber(trade.price),
      quantity,
      totalCost
    });
  }
}

function finalizeLongPosition(position) {
  if (!position) return;
  position.lots = Array.isArray(position.lots)
    ? position.lots.filter((lot) => (Number(lot.quantity) || 0) > 1e-8 && (Number(lot.totalCost) || 0) > 1e-8)
    : [];
  position.quantity = position.lots.reduce((sum, lot) => sum + (Number(lot.quantity) || 0), 0);
  position.totalCost = roundMoney(position.lots.reduce((sum, lot) => sum + (Number(lot.totalCost) || 0), 0));
}

function reduceLotsByFifo(position, closeQty, closeDate, options = {}) {
  const { applyHoldingCost = false, lotMatcher = null } = options;
  if (!Array.isArray(position?.lots) || !position.lots.length) {
    return { costBasis: 0, estimatedHoldingCost: 0, weightedHoldingDays: 0 };
  }

  let remainingQuantity = closeQty;
  let costBasis = 0;
  let estimatedHoldingCost = 0;
  let weightedHoldingDays = 0;
  const lots = position.lots.map((lot) => ({ ...lot }));

  const consumeLot = (lot) => {
    const lotQuantity = Number(lot.quantity) || 0;
    const lotTotalCost = Number(lot.totalCost) || 0;
    if (lotQuantity <= 0 || lotTotalCost <= 0) return;
    if (remainingQuantity <= 1e-8) return;

    const closedQuantity = Math.min(remainingQuantity, lotQuantity);
    const unitCost = lotTotalCost / lotQuantity;
    const closedCost = unitCost * closedQuantity;
    costBasis += closedCost;

    if (applyHoldingCost && closedCost > 0) {
      const holdingDays = calculateInclusiveHoldingDays(lot.openDate, closeDate);
      estimatedHoldingCost += (closedCost * MARGIN_INTEREST_RATE * holdingDays) / DAYS_IN_YEAR;
      weightedHoldingDays += closedQuantity * holdingDays;
    }

    const nextQuantity = lotQuantity - closedQuantity;
    lot.quantity = nextQuantity;
    lot.totalCost = nextQuantity > 1e-8 ? roundMoney(unitCost * nextQuantity) : 0;
    remainingQuantity -= closedQuantity;
  };

  if (typeof lotMatcher === 'function') {
    lots.forEach((lot) => {
      if (lotMatcher(lot)) consumeLot(lot);
    });
  }

  lots.forEach(consumeLot);

  position.lots = lots;
  finalizeLongPosition(position);
  return {
    costBasis: roundMoney(costBasis),
    estimatedHoldingCost: roundMoney(estimatedHoldingCost),
    weightedHoldingDays
  };
}

function closeLongPosition(map, symbol, quantity, revenue, closeDate, options = {}) {
  const {
    applyHoldingCost = false,
    holdingCostOverride = null,
    lotMatcher = null
  } = options;
  const position = map.get(symbol);
  if (!position || position.quantity <= 0) {
    return {
      closeQty: 0,
      costBasis: 0,
      grossProfit: 0,
      holdingCost: 0,
      estimatedHoldingCost: 0,
      holdingCostSource: 'none',
      derivedNetProfit: 0,
      averageHoldingDays: 0
    };
  }

  const closeQty = Math.min(quantity, position.quantity);
  if (closeQty <= 0) {
    return {
      closeQty: 0,
      costBasis: 0,
      grossProfit: 0,
      holdingCost: 0,
      estimatedHoldingCost: 0,
      holdingCostSource: 'none',
      derivedNetProfit: 0,
      averageHoldingDays: 0
    };
  }

  const lotResult = reduceLotsByFifo(position, closeQty, closeDate, { applyHoldingCost, lotMatcher });
  const costBasis = lotResult.costBasis;
  const grossProfit = roundMoney(revenue - costBasis);
  const estimatedHoldingCost = applyHoldingCost ? lotResult.estimatedHoldingCost : 0;
  const holdingCost = holdingCostOverride != null
    ? roundMoney(holdingCostOverride)
    : estimatedHoldingCost;

  if (position.quantity <= 1e-8) {
    map.delete(symbol);
  }

  return {
    closeQty,
    costBasis,
    grossProfit,
    holdingCost,
    estimatedHoldingCost,
    holdingCostSource: holdingCostOverride != null ? 'manual' : applyHoldingCost ? 'estimated' : 'none',
    derivedNetProfit: roundMoney(grossProfit - holdingCost),
    averageHoldingDays: closeQty > 0 ? lotResult.weightedHoldingDays / closeQty : 0
  };
}

function addShortPosition(map, trade, quantity, totalEntry, openedDate = '', openedPrice = null) {
  const symbol = trade.symbol;
  if (!map.has(symbol)) {
    map.set(symbol, {
      symbol,
      name: getStockDisplayName(symbol, trade.name),
      quantity: 0,
      totalEntry: 0,
      market: trade.market,
      lots: []
    });
  }

  const position = map.get(symbol);
  position.name = trade.name || position.name || getStockDisplayName(symbol);
  position.market = trade.market || position.market || 'tse';
  position.quantity += quantity;
  position.totalEntry = roundMoney(position.totalEntry + totalEntry);

  if (quantity > 0 && totalEntry > 0) {
    position.lots.push({
      openDate: openedDate,
      openPrice: safeNumber(openedPrice) ?? safeNumber(trade.price),
      quantity,
      totalEntry
    });
  }
}

function finalizeShortPosition(position) {
  if (!position) return;
  position.lots = Array.isArray(position.lots)
    ? position.lots.filter((lot) => (Number(lot.quantity) || 0) > 1e-8 && (Number(lot.totalEntry) || 0) > 1e-8)
    : [];
  position.quantity = position.lots.reduce((sum, lot) => sum + (Number(lot.quantity) || 0), 0);
  position.totalEntry = roundMoney(position.lots.reduce((sum, lot) => sum + (Number(lot.totalEntry) || 0), 0));
}

function reduceShortLotsByFifo(position, closeQty, options = {}) {
  const { lotMatcher = null } = options;
  if (!Array.isArray(position?.lots) || !position.lots.length) {
    return { entryValue: 0 };
  }

  let remainingQuantity = closeQty;
  let entryValue = 0;
  const lots = position.lots.map((lot) => ({ ...lot }));

  const consumeLot = (lot) => {
    const lotQuantity = Number(lot.quantity) || 0;
    const lotTotalEntry = Number(lot.totalEntry) || 0;
    if (lotQuantity <= 0 || lotTotalEntry <= 0) return;
    if (remainingQuantity <= 1e-8) return;

    const closedQuantity = Math.min(remainingQuantity, lotQuantity);
    const unitEntry = lotTotalEntry / lotQuantity;
    const closedEntry = unitEntry * closedQuantity;
    entryValue += closedEntry;

    const nextQuantity = lotQuantity - closedQuantity;
    lot.quantity = nextQuantity;
    lot.totalEntry = nextQuantity > 1e-8 ? roundMoney(unitEntry * nextQuantity) : 0;
    remainingQuantity -= closedQuantity;
  };

  if (typeof lotMatcher === 'function') {
    lots.forEach((lot) => {
      if (lotMatcher(lot)) consumeLot(lot);
    });
  }

  lots.forEach(consumeLot);

  position.lots = lots;
  finalizeShortPosition(position);
  return { entryValue: roundMoney(entryValue) };
}

function closeShortPosition(map, symbol, quantity, costToClose, options = {}) {
  const { holdingCostOverride = null, lotMatcher = null } = options;
  const position = map.get(symbol);
  if (!position || position.quantity <= 0) {
    return {
      closeQty: 0,
      entryValue: 0,
      grossProfit: 0,
      holdingCost: 0,
      estimatedHoldingCost: 0,
      holdingCostSource: 'none',
      derivedNetProfit: 0
    };
  }

  const closeQty = Math.min(quantity, position.quantity);
  const lotResult = reduceShortLotsByFifo(position, closeQty, { lotMatcher });
  const entryValue = lotResult.entryValue;
  const grossProfit = roundMoney(entryValue - costToClose);
  const holdingCost = holdingCostOverride != null ? roundMoney(holdingCostOverride) : 0;

  if (position.quantity <= 1e-8) {
    map.delete(symbol);
  }

  return {
    closeQty,
    entryValue,
    grossProfit,
    holdingCost,
    estimatedHoldingCost: 0,
    holdingCostSource: holdingCostOverride != null ? 'manual' : 'none',
    derivedNetProfit: roundMoney(grossProfit - holdingCost)
  };
}

export function processPositionTrade(books, trade, dayDate) {
  const quantity = Number(trade.quantity) || 0;
  const price = Number(trade.price) || 0;
  const fee = Number(trade.fee) || 0;
  const taxAmount = Number(trade.taxAmount) || 0;
  const settlementAmount = safeNumber(trade.settlementAmount);
  const holdingCostOverride = getTradeHoldingCostOverride(trade);
  const reportedClosePnl = getTradeReportedClosePnl(trade);
  const reportedCloseCost = getTradeReportedCloseCost(trade);
  const grossAmount = roundMoney(quantity * price);
  const buyCost = trade.assetType === 'cash' && settlementAmount != null && trade.action === 'buy'
    ? settlementAmount
    : roundMoney(grossAmount + fee + taxAmount);
  const sellRevenue = trade.assetType === 'cash' && settlementAmount != null && trade.action === 'sell'
    ? settlementAmount
    : roundMoney(grossAmount - fee - taxAmount);

  let realizedProfit = 0;
  let derivedNetProfit = 0;
  let grossRealizedProfit = 0;
  let holdingCost = 0;
  let estimatedHoldingCost = 0;
  let holdingCostSource = 'none';
  let profitSource = 'open';
  let averageHoldingDays = 0;
  let costBasisAmount = 0;
  let closeValueAmount = 0;

  if (trade.assetType === 'cash') {
    if (trade.action === 'buy') {
      addLongPosition(books.cashPositions, trade, quantity, buyCost, dayDate, price);
      closeValueAmount = buyCost;
    } else {
      const closeResult = closeLongPosition(books.cashPositions, trade.symbol, quantity, sellRevenue, dayDate);
      derivedNetProfit = closeResult.derivedNetProfit;
      realizedProfit = reportedClosePnl != null ? reportedClosePnl : derivedNetProfit;
      grossRealizedProfit = closeResult.grossProfit;
      holdingCost = closeResult.holdingCost;
      estimatedHoldingCost = closeResult.estimatedHoldingCost;
      holdingCostSource = closeResult.holdingCostSource;
      costBasisAmount = closeResult.costBasis;
      closeValueAmount = sellRevenue;
      profitSource = reportedClosePnl != null ? 'reported' : 'model';
    }
  } else if (trade.positionSide === 'short') {
    if (trade.positionEffect === 'open') {
      addShortPosition(books.marginShortPositions, trade, quantity, roundMoney(grossAmount - fee - taxAmount), dayDate, price);
      closeValueAmount = roundMoney(grossAmount - fee - taxAmount);
    } else {
      const closeResult = closeShortPosition(
        books.marginShortPositions,
        trade.symbol,
        quantity,
        roundMoney(grossAmount + fee + taxAmount),
        {
          holdingCostOverride,
          lotMatcher: createMarginSettlementLotMatcher(trade, 'totalEntry')
        }
      );
      derivedNetProfit = closeResult.derivedNetProfit;
      realizedProfit = reportedClosePnl != null ? reportedClosePnl : derivedNetProfit;
      grossRealizedProfit = closeResult.grossProfit;
      holdingCost = closeResult.holdingCost;
      estimatedHoldingCost = closeResult.estimatedHoldingCost;
      holdingCostSource = closeResult.holdingCostSource;
      costBasisAmount = closeResult.entryValue;
      closeValueAmount = roundMoney(grossAmount + fee + taxAmount);
      profitSource = reportedClosePnl != null
        ? 'reported'
        : holdingCostSource === 'manual'
          ? 'manual'
          : 'model';
    }
  } else if (trade.positionEffect === 'open') {
    addLongPosition(books.marginLongPositions, trade, quantity, roundMoney(grossAmount + fee + taxAmount), dayDate, price);
    closeValueAmount = roundMoney(grossAmount + fee + taxAmount);
  } else {
    const closeResult = closeLongPosition(
      books.marginLongPositions,
      trade.symbol,
      quantity,
      roundMoney(grossAmount - fee - taxAmount),
      dayDate,
      {
        applyHoldingCost: true,
        holdingCostOverride,
        lotMatcher: createMarginSettlementLotMatcher(trade, 'totalCost')
      }
    );
    derivedNetProfit = closeResult.derivedNetProfit;
    realizedProfit = reportedClosePnl != null ? reportedClosePnl : derivedNetProfit;
    grossRealizedProfit = closeResult.grossProfit;
    holdingCost = closeResult.holdingCost;
    estimatedHoldingCost = closeResult.estimatedHoldingCost;
    holdingCostSource = closeResult.holdingCostSource;
    averageHoldingDays = closeResult.averageHoldingDays;
    costBasisAmount = closeResult.costBasis;
    closeValueAmount = roundMoney(grossAmount - fee - taxAmount);
    profitSource = reportedClosePnl != null
      ? 'reported'
      : holdingCostSource === 'manual'
        ? 'manual'
        : 'model';
  }

  realizedProfit = roundMoney(realizedProfit);
  derivedNetProfit = roundMoney(derivedNetProfit);
  grossRealizedProfit = roundMoney(grossRealizedProfit);
  holdingCost = roundMoney(holdingCost);
  estimatedHoldingCost = roundMoney(estimatedHoldingCost);
  const reportedHoldingCost = reportedClosePnl != null && reportedCloseCost != null
    ? roundMoney(reportedCloseCost)
    : null;
  if (reportedHoldingCost != null && grossRealizedProfit === 0) {
    grossRealizedProfit = roundMoney(realizedProfit + reportedHoldingCost);
  }

  return {
    realizedProfit,
    derivedNetProfit,
    grossRealizedProfit,
    holdingCost: reportedHoldingCost ?? holdingCost,
    estimatedHoldingCost,
    financingCost: reportedHoldingCost ?? holdingCost,
    estimatedFinancingCost: estimatedHoldingCost,
    holdingCostSource,
    reportedClosePnl,
    profitSource,
    costBasisAmount,
    closeValueAmount,
    averageHoldingDays
  };
}

export function buildPositionViews(books) {
  const positions = {
    cash: Array.from(books.cashPositions.values()).map((position) => ({
      assetType: 'cash',
      positionSide: 'long',
      symbol: position.symbol,
      name: position.name,
      quantity: position.quantity,
      avgPrice: position.quantity > 0 ? position.totalCost / position.quantity : 0,
      market: position.market
    })),
    margin: [
      ...Array.from(books.marginLongPositions.values()).map((position) => ({
        assetType: 'margin',
        positionSide: 'long',
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
        avgPrice: position.quantity > 0 ? position.totalCost / position.quantity : 0,
        market: position.market
      })),
      ...Array.from(books.marginShortPositions.values()).map((position) => ({
        assetType: 'margin',
        positionSide: 'short',
        symbol: position.symbol,
        name: position.name,
        quantity: position.quantity,
        avgPrice: position.quantity > 0 ? position.totalEntry / position.quantity : 0,
        market: position.market
      }))
    ]
  };
  positions.all = [...positions.cash, ...positions.margin];
  return positions;
}
