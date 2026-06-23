export function deepClone(value) {
  return structuredClone(value);
}

export function generateId() {
  return crypto.randomUUID();
}

export function trimText(value) {
  return String(value ?? '')
    .replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
    .replace(/\u00a0/g, ' ');
}

export function compactText(value) {
  return trimText(value).replace(/[\s\u3000]+/g, '');
}

export function todayStr(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateStr, diff) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(year, month - 1, day + diff);
  return todayStr(date);
}

export function normalizeAnyDate(value) {
  const raw = trimText(value);
  if (!raw) return '';

  let match = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (match) {
    return match[1];
  }

  match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  match = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return '';
}

export function formatDateParts(dateStr) {
  const normalized = normalizeAnyDate(dateStr) || todayStr();
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return {
    normalized,
    year,
    month,
    day,
    label: `${month}月${day}日`,
    fullLabel: `${year}年${month}月${day}日`,
    weekday: date.toLocaleDateString('zh-CN', { weekday: 'short' })
  };
}

export function formatMoney(value, options = {}) {
  const { signed = true } = options;
  const amount = Number(value) || 0;
  const abs = Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  if (signed) {
    if (amount > 0) return `+¥${abs}`;
    if (amount < 0) return `-¥${abs}`;
  }

  return `${amount < 0 ? '-' : ''}¥${abs}`;
}

export function formatPercent(value) {
  return `${Number(value || 0).toFixed(0)}%`;
}

export function roundMoney(value) {
  const amount = Number(value) || 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function sumMoney(left, right) {
  return roundMoney((Number(left) || 0) + (Number(right) || 0));
}

export function maskEmail(email) {
  const value = trimText(email);
  const [name, domain] = value.split('@');
  if (!name || !domain) return value;
  if (name.length <= 2) return `${name[0] || '*'}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

export function safeNumber(value) {
  if (value === '' || value == null) return null;
  const normalized = trimText(value).replace(/,/g, '');
  if (!normalized || normalized === '--') return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

export function compareByDateAsc(left, right) {
  return left.date.localeCompare(right.date);
}

export function compareTradeOrder(left, right) {
  const orderDelta = (Number(left.order) || 0) - (Number(right.order) || 0);
  if (orderDelta !== 0) return orderDelta;

  const leftTime = new Date(left.createdAt || 0).getTime();
  const rightTime = new Date(right.createdAt || 0).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;

  return String(left.id || '').localeCompare(String(right.id || ''));
}

export function compareTradeProcessingOrder(left, right) {
  return compareTradeOrder(left, right);
}

function isCsvTrade(trade) {
  return trimText(trade?.source || '') === 'csv'
    || Boolean(trimText(trade?.fingerprint || trade?.csvBaseSignature || ''));
}

export function getTradePositionProcessingBucket(trade, dayDate) {
  if (trade.assetType === 'cash' && isCsvTrade(trade)) {
    return trade.action === 'sell' ? 1 : 0;
  }

  if (
    trade.assetType === 'margin'
    && trade.positionEffect === 'close'
    && trade.marginSettlement?.openDate === dayDate
  ) {
    return 1;
  }

  return 0;
}

export function compareTradePositionProcessingOrder(dayDate, left, right) {
  const bucketDelta = getTradePositionProcessingBucket(left, dayDate) - getTradePositionProcessingBucket(right, dayDate);
  if (bucketDelta !== 0) return bucketDelta;
  return compareTradeOrder(left, right);
}

export function marketLabelFromKey(key) {
  if (key === 'pts') return 'PTS';
  if (key === 'other') return '其他';
  return '东证';
}

export function normalizeMarketKey(value) {
  const raw = trimText(value).toUpperCase();
  if (!raw || raw === '--' || raw === 'TSE') return 'tse';
  if (raw === 'PTS' || raw.includes('PTS')) return 'pts';
  if (raw.includes('東証') || raw.includes('东证')) return 'tse';
  return 'other';
}

export function getScopeLabel(scope) {
  if (scope === 'cash') return '现物';
  if (scope === 'margin') return '信用';
  return '合计';
}

export function getCurrentWeekMondayStr() {
  const now = new Date();
  const weekday = now.getDay();
  const diff = (weekday + 6) % 7;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - diff);
  return todayStr(now);
}

export function toDateStartTimestamp(dateStr) {
  const normalized = normalizeAnyDate(dateStr);
  if (!normalized) return Number.NaN;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function calculateInclusiveHoldingDays(openDate, closeDate) {
  const openTime = toDateStartTimestamp(openDate);
  const closeTime = toDateStartTimestamp(closeDate);
  if (!Number.isFinite(openTime) || !Number.isFinite(closeTime)) return 1;
  const dayDiff = Math.floor((closeTime - openTime) / 86400000);
  return Math.max(1, dayDiff + 1);
}
