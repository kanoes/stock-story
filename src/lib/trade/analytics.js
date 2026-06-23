import { SCOPES } from './constants.js';
import { getStockDisplayName } from './company-data.js';
import { normalizeDay, normalizeTrade } from './models.js';
import {
  buildPositionViews,
  createPositionBooks,
  processPositionTrade
} from './position-engine.js';
import {
  compareByDateAsc,
  compareTradePositionProcessingOrder,
  getCurrentWeekMondayStr,
  sumMoney,
  todayStr
} from './utils.js';

function createScopeDayState() {
  return {
    grossProfit: 0,
    profit: 0,
    holdingCost: 0,
    estimatedHoldingCost: 0,
    financingCost: 0,
    estimatedFinancingCost: 0,
    tradeCount: 0,
    closeTradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    symbols: new Set()
  };
}

function createScopeSummary() {
  return {
    grossProfit: 0,
    totalProfit: 0,
    holdingCost: 0,
    estimatedHoldingCost: 0,
    financingCost: 0,
    estimatedFinancingCost: 0,
    activeDays: 0,
    winDays: 0,
    lossDays: 0,
    winRate: 0,
    tradeCount: 0,
    buyCount: 0,
    sellCount: 0,
    closeTradeCount: 0,
    symbolCount: 0,
    positionsCount: 0,
    positions: [],
    ranking: [],
    monthly: [],
    daySeries: [],
    today: {
      profit: 0,
      tradeCount: 0,
      holdingCost: 0,
      estimatedHoldingCost: 0,
      financingCost: 0,
      estimatedFinancingCost: 0
    },
    week: {
      profit: 0,
      tradeCount: 0,
      holdingCost: 0,
      estimatedHoldingCost: 0,
      financingCost: 0,
      estimatedFinancingCost: 0
    }
  };
}

export function buildAnalytics(days) {
  const normalizedDays = days.map((day) => normalizeDay(day)).sort(compareByDateAsc);
  const dayViews = normalizedDays.map((day) => ({
    id: day.id,
    date: day.date,
    updatedAt: day.updatedAt,
    importedCount: day.trades.filter((trade) => trade.fingerprint).length,
    manualCount: day.trades.filter((trade) => !trade.fingerprint).length,
    trades: [],
    scopes: {
      all: createScopeDayState(),
      cash: createScopeDayState(),
      margin: createScopeDayState()
    }
  }));

  const dayMap = new Map(dayViews.map((day) => [day.date, day]));
  const positionBooks = createPositionBooks();
  const enrichedTrades = [];

  normalizedDays.forEach((day) => {
    const dayView = dayMap.get(day.date);
    const processingTrades = day.trades
      .map((trade, index) => normalizeTrade(trade, day.date, index))
      .sort((left, right) => compareTradePositionProcessingOrder(day.date, left, right));

    processingTrades.forEach((trade) => {
      const positionResult = processPositionTrade(positionBooks, trade, day.date);

      const enrichedTrade = {
        ...trade,
        ...positionResult,
        dayDate: day.date
      };

      dayView.trades.push(enrichedTrade);
      enrichedTrades.push(enrichedTrade);

      const targets = [dayView.scopes.all, dayView.scopes[trade.assetType]];
      targets.forEach((scopeState) => {
        scopeState.tradeCount += 1;
        scopeState.grossProfit = sumMoney(scopeState.grossProfit, positionResult.grossRealizedProfit);
        scopeState.profit = sumMoney(scopeState.profit, positionResult.realizedProfit);
        scopeState.holdingCost = sumMoney(scopeState.holdingCost, positionResult.holdingCost);
        scopeState.estimatedHoldingCost = sumMoney(scopeState.estimatedHoldingCost, positionResult.estimatedHoldingCost);
        scopeState.financingCost = scopeState.holdingCost;
        scopeState.estimatedFinancingCost = scopeState.estimatedHoldingCost;
        scopeState.symbols.add(trade.symbol || trade.name || '');

        if (trade.action === 'buy') scopeState.buyCount += 1;
        if (trade.action === 'sell') scopeState.sellCount += 1;
        if (trade.positionEffect === 'close' || (trade.assetType === 'cash' && trade.action === 'sell')) {
          scopeState.closeTradeCount += 1;
        }
      });
    });
  });

  const positions = buildPositionViews(positionBooks);

  const summaries = {
    all: createScopeSummary(),
    cash: createScopeSummary(),
    margin: createScopeSummary()
  };

  const today = todayStr();
  const monday = getCurrentWeekMondayStr();

  SCOPES.forEach((scope) => {
    const summary = summaries[scope];
    const rankingMap = new Map();
    const monthlyMap = new Map();
    const symbolSet = new Set();

    dayViews.forEach((day) => {
      const scopeDay = day.scopes[scope];
      if (!scopeDay.tradeCount) return;

      summary.totalProfit = sumMoney(summary.totalProfit, scopeDay.profit);
      summary.grossProfit = sumMoney(summary.grossProfit, scopeDay.grossProfit);
      summary.holdingCost = sumMoney(summary.holdingCost, scopeDay.holdingCost);
      summary.estimatedHoldingCost = sumMoney(summary.estimatedHoldingCost, scopeDay.estimatedHoldingCost);
      summary.financingCost = summary.holdingCost;
      summary.estimatedFinancingCost = summary.estimatedHoldingCost;
      summary.activeDays += 1;
      summary.tradeCount += scopeDay.tradeCount;
      summary.buyCount += scopeDay.buyCount;
      summary.sellCount += scopeDay.sellCount;
      summary.closeTradeCount += scopeDay.closeTradeCount;
      summary.daySeries.push({ date: day.date, value: scopeDay.profit });

      if (scopeDay.profit > 0) summary.winDays += 1;
      if (scopeDay.profit < 0) summary.lossDays += 1;

      if (day.date === today) {
        summary.today = {
          profit: scopeDay.profit,
          tradeCount: scopeDay.tradeCount,
          holdingCost: scopeDay.holdingCost,
          estimatedHoldingCost: scopeDay.estimatedHoldingCost,
          financingCost: scopeDay.holdingCost,
          estimatedFinancingCost: scopeDay.estimatedHoldingCost
        };
      }

      if (day.date >= monday && day.date <= today) {
        summary.week.profit = sumMoney(summary.week.profit, scopeDay.profit);
        summary.week.tradeCount += scopeDay.tradeCount;
        summary.week.holdingCost = sumMoney(summary.week.holdingCost, scopeDay.holdingCost);
        summary.week.estimatedHoldingCost = sumMoney(summary.week.estimatedHoldingCost, scopeDay.estimatedHoldingCost);
        summary.week.financingCost = summary.week.holdingCost;
        summary.week.estimatedFinancingCost = summary.week.estimatedHoldingCost;
      }

      const monthKey = day.date.slice(0, 7);
      monthlyMap.set(monthKey, sumMoney(monthlyMap.get(monthKey) || 0, scopeDay.profit));
      scopeDay.symbols.forEach((symbol) => symbol && symbolSet.add(symbol));
    });

    enrichedTrades.forEach((trade) => {
      if (scope !== 'all' && trade.assetType !== scope) return;
      if (trade.symbol) symbolSet.add(trade.symbol);

      if (!rankingMap.has(trade.symbol)) {
        rankingMap.set(trade.symbol, {
          symbol: trade.symbol,
          name: getStockDisplayName(trade.symbol, trade.name),
          profit: 0,
          buyCount: 0,
          sellCount: 0,
          tradeCount: 0
        });
      }

      const target = rankingMap.get(trade.symbol);
      target.profit = sumMoney(target.profit, trade.realizedProfit);
      target.tradeCount += 1;
      if (trade.action === 'buy') target.buyCount += 1;
      if (trade.action === 'sell') target.sellCount += 1;
    });

    summary.winRate = summary.activeDays ? Math.round((summary.winDays / summary.activeDays) * 100) : 0;
    summary.symbolCount = symbolSet.size;
    summary.positions = positions[scope];
    summary.positionsCount = positions[scope].length;
    summary.ranking = Array.from(rankingMap.values())
      .filter((item) => item.tradeCount > 0)
      .sort((left, right) => right.profit - left.profit);
    summary.monthly = Array.from(monthlyMap.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([month, profit]) => ({ month, profit }));
  });

  return {
    daysAsc: dayViews,
    daysDesc: [...dayViews].sort((left, right) => right.date.localeCompare(left.date)),
    trades: enrichedTrades.sort((left, right) => {
      const dateDelta = right.dayDate.localeCompare(left.dayDate);
      if (dateDelta !== 0) return dateDelta;
      return (Number(left.order) || 0) - (Number(right.order) || 0);
    }),
    summaries,
    positions
  };
}
