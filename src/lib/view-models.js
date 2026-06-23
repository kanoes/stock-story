import { MANUAL_TYPE_MAP } from './trade/constants.js';
import { buildTradeSoftKey, normalizeDay } from './trade/models.js';
import {
  addDays,
  compareTradePositionProcessingOrder,
  formatDateParts,
  getScopeLabel,
  todayStr,
  trimText
} from './trade/utils.js';

export function getValueTone(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

export function getHoldingCostMeta(scopeDay) {
  const confirmed = Number(scopeDay?.holdingCost) || 0;
  const estimated = Number(scopeDay?.estimatedHoldingCost) || 0;
  if (confirmed > 0) return { label: '持有成本', value: confirmed };
  if (estimated > 0) return { label: '估算持有成本', value: estimated };
  return { label: '持有成本', value: 0 };
}

export function getTradeBadgeTone(trade) {
  return trade.assetType === 'margin' ? 'margin' : 'cash';
}

export function getTradeActionLabel(trade) {
  if (trade.tradeTypeLabel) return trade.tradeTypeLabel;
  return MANUAL_TYPE_MAP[trade.manualType]?.label || '交易';
}

export function getTradeSourceLabel(trade) {
  return trade.fingerprint ? 'CSV' : '手动';
}

export function getTradeProfitSourceLabel(trade) {
  if (trade.profitSource === 'reported') return '券商';
  if (trade.profitSource === 'manual') return '手工';
  if (trade.profitSource === 'model') return 'FIFO';
  return '';
}

export function getTradeProfitSourceTone(trade) {
  if (trade.profitSource === 'reported') return 'success';
  if (trade.profitSource === 'manual') return 'warning';
  return 'neutral';
}

export function buildDashboardTimeline(daysAsc, scope, chartRange) {
  const today = todayStr();
  const startDate = chartRange === 'week'
    ? addDays(today, -6)
    : chartRange === 'month'
      ? addDays(today, -29)
      : '';

  let running = 0;
  return daysAsc
    .filter((day) => day.scopes[scope].tradeCount > 0)
    .filter((day) => !startDate || day.date >= startDate)
    .map((day) => {
      const scopeDay = day.scopes[scope];
      running += scopeDay.profit;
      return {
        date: day.date,
        profit: scopeDay.profit,
        cumulative: running,
        tradeCount: scopeDay.tradeCount,
        financingCost: scopeDay.financingCost
      };
    });
}

function getChartAccent(scope) {
  if (scope === 'cash') {
    return { line: '#2a6ddf', fill: 'rgba(42, 109, 223, 0.12)' };
  }

  if (scope === 'margin') {
    return { line: '#d06f36', fill: 'rgba(208, 111, 54, 0.16)' };
  }

  return { line: '#9c6b43', fill: 'rgba(156, 107, 67, 0.14)' };
}

export function buildLineChartData(timeline, scope, chartType) {
  const labels = timeline.map((item) => {
    const parts = formatDateParts(item.date);
    return `${parts.month}/${parts.day}`;
  });
  const values = timeline.map((item) => (chartType === 'cumulative' ? item.cumulative : item.profit));
  const accent = getChartAccent(scope);

  return {
    labels,
    datasets: [
      {
        data: values,
        borderColor: accent.line,
        backgroundColor: accent.fill,
        borderWidth: 3,
        tension: 0.32,
        fill: true,
        pointRadius: timeline.map((_, index) => (index === timeline.length - 1 ? 4 : 0)),
        pointHoverRadius: 5,
        pointHitRadius: 18,
        pointBackgroundColor: accent.line
      }
    ]
  };
}

export function buildBarChartData(summary) {
  return {
    labels: summary.monthly.map((item) => item.month.replace('-', '/')),
    datasets: [
      {
        label: '月度收益',
        data: summary.monthly.map((item) => item.profit),
        backgroundColor: summary.monthly.map((item) => (item.profit >= 0 ? '#15845d' : '#cb5252')),
        borderRadius: 10,
        borderSkipped: false
      }
    ]
  };
}

export function summarizeRecordDays(days, scope) {
  return days.reduce((accumulator, day) => {
    const scopeDay = day.scopes[scope];
    accumulator.totalProfit += scopeDay.profit;
    accumulator.tradeCount += scopeDay.tradeCount;
    accumulator.closeTradeCount += scopeDay.closeTradeCount;
    if (scopeDay.profit > 0) accumulator.winDays += 1;
    if (scopeDay.profit < 0) accumulator.lossDays += 1;
    return accumulator;
  }, {
    totalProfit: 0,
    tradeCount: 0,
    closeTradeCount: 0,
    winDays: 0,
    lossDays: 0
  });
}

export function findExtremeDays(days, scope) {
  const relevantDays = days.filter((day) => day.scopes[scope].tradeCount > 0);
  if (!relevantDays.length) {
    return { best: null, worst: null };
  }

  return relevantDays.reduce((accumulator, day) => {
    if (!accumulator.best || day.scopes[scope].profit > accumulator.best.scopes[scope].profit) {
      accumulator.best = day;
    }
    if (!accumulator.worst || day.scopes[scope].profit < accumulator.worst.scopes[scope].profit) {
      accumulator.worst = day;
    }
    return accumulator;
  }, { best: null, worst: null });
}

export function buildMonthlyHighlights(monthly) {
  if (!monthly.length) {
    return { best: null, worst: null };
  }

  return monthly.reduce((accumulator, item) => {
    if (!accumulator.best || item.profit > accumulator.best.profit) accumulator.best = item;
    if (!accumulator.worst || item.profit < accumulator.worst.profit) accumulator.worst = item;
    return accumulator;
  }, { best: null, worst: null });
}

export function buildRecordFilterBadges(filters) {
  const badges = [];

  if (filters.month !== 'all') {
    badges.push({ tone: 'neutral', label: filters.month });
  }
  if (trimText(filters.search)) {
    badges.push({ tone: 'warning', label: trimText(filters.search) });
  }
  if (filters.source !== 'all') {
    badges.push({
      tone: filters.source === 'csv' ? 'success' : 'neutral',
      label: filters.source === 'csv' ? '仅 CSV' : '仅手动'
    });
  }
  if (filters.outcome !== 'all') {
    const labelMap = { win: '盈利日', loss: '亏损日', flat: '平盘日' };
    badges.push({ tone: filters.outcome === 'loss' ? 'danger' : 'neutral', label: labelMap[filters.outcome] });
  }
  if (filters.sort !== 'desc') {
    const labelMap = { oldest: '最早优先', profit: '波动最大' };
    badges.push({ tone: 'neutral', label: labelMap[filters.sort] });
  }
  if (filters.compact) {
    badges.push({ tone: 'cash', label: '紧凑模式' });
  }

  return badges;
}

export function buildHealthReport(days) {
  const duplicates = [];
  const duplicateMap = new Map();
  const positionMap = new Map();
  const orphanCloses = [];
  const normalizedDays = [...days].map(normalizeDay).sort((left, right) => left.date.localeCompare(right.date));

  normalizedDays.forEach((day) => {
    [...day.trades]
      .sort((left, right) => compareTradePositionProcessingOrder(day.date, left, right))
      .forEach((trade) => {
        const duplicateKey = trade.fingerprint
          ? `fp:${trade.fingerprint}`
          : `soft:${buildTradeSoftKey(day.date, trade)}`;

        if (duplicateMap.has(duplicateKey)) {
          duplicates.push({
            date: day.date,
            symbol: trade.symbol,
            name: trade.name,
            tradeTypeLabel: trade.tradeTypeLabel
          });
        } else {
          duplicateMap.set(duplicateKey, true);
        }

        const quantity = Number(trade.quantity) || 0;
        const key = `${trade.assetType}|${trade.positionSide}|${trade.symbol}`;
        const current = positionMap.get(key) || 0;
        const next = trade.positionEffect === 'open' ? current + quantity : current - quantity;
        const hasReportedCloseProfit = trade.reportedProfit !== '' && trade.reportedProfit != null;
        const hasBrokerCloseDetail = hasReportedCloseProfit || Boolean(trade.marginSettlement);

        if (trade.positionEffect === 'close' && quantity > current + 1e-8 && !hasBrokerCloseDetail) {
          orphanCloses.push({
            date: day.date,
            symbol: trade.symbol,
            name: trade.name,
            tradeTypeLabel: trade.tradeTypeLabel,
            missingQuantity: quantity - current
          });
        }

        positionMap.set(key, Math.max(0, next));
      });
  });

  return {
    duplicateCount: duplicates.length,
    orphanCloseCount: orphanCloses.length,
    duplicateExamples: duplicates.slice(0, 3),
    orphanExamples: orphanCloses.slice(0, 3)
  };
}

export function buildAnalysisDiagnostics(summary, trades) {
  const closingTrades = trades.filter((trade) => {
    const isCashClose = trade.assetType === 'cash' && trade.action === 'sell';
    return (isCashClose || trade.positionEffect === 'close') && trade.realizedProfit !== 0;
  });

  const winTrades = closingTrades.filter((trade) => trade.realizedProfit > 0);
  const lossTrades = closingTrades.filter((trade) => trade.realizedProfit < 0);

  const avgPerClose = closingTrades.length
    ? closingTrades.reduce((sum, trade) => sum + trade.realizedProfit, 0) / closingTrades.length
    : 0;
  const avgWin = winTrades.length
    ? winTrades.reduce((sum, trade) => sum + trade.realizedProfit, 0) / winTrades.length
    : 0;
  const avgLoss = lossTrades.length
    ? lossTrades.reduce((sum, trade) => sum + trade.realizedProfit, 0) / lossTrades.length
    : 0;
  const profitFactor = lossTrades.length
    ? winTrades.reduce((sum, trade) => sum + trade.realizedProfit, 0) / Math.abs(lossTrades.reduce((sum, trade) => sum + trade.realizedProfit, 0))
    : 0;
  const tradeWinRate = closingTrades.length ? Math.round((winTrades.length / closingTrades.length) * 100) : 0;

  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  summary.daySeries.forEach((item) => {
    running += item.value;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);

    if (item.value > 0) {
      winStreak += 1;
      lossStreak = 0;
    } else if (item.value < 0) {
      lossStreak += 1;
      winStreak = 0;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }

    maxWinStreak = Math.max(maxWinStreak, winStreak);
    maxLossStreak = Math.max(maxLossStreak, lossStreak);
  });

  return {
    avgPerClose,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown,
    maxWinStreak,
    maxLossStreak,
    closeTradeCount: closingTrades.length,
    winTradeCount: winTrades.length,
    lossTradeCount: lossTrades.length,
    tradeWinRate
  };
}

export function buildScopeOptions() {
  return ['all', 'cash', 'margin'].map((scope) => ({
    value: scope,
    label: getScopeLabel(scope)
  }));
}
