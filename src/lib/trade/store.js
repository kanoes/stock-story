import { APP_VERSION } from './constants.js';
import { buildAnalytics } from './analytics.js';
import { rebuildDaysFromCsvFiles } from './csv.js';
import {
  clearCloudTradeData as clearRemoteCloudData,
  consumePendingPostLoginSync,
  fetchCloudSnapshot,
  getFirebaseState,
  initCloudSyncStatus,
  markCsvImportSyncComplete,
  markLocalClearComplete,
  markMergeSyncComplete,
  parseFirebaseConfigInput,
  restoreFirebaseSession,
  saveFirebaseConfig as saveCloudConfig,
  setCloudSyncing,
  signInWithGoogle as signInCloud,
  signOutFromFirebase as signOutCloud,
  updateCloudSyncStatus,
  writeCloudSnapshot
} from './firebase-sync.js';
import {
  createManualTrade,
  isCsvImportedTrade,
  isTradeComplete,
  mergeDays,
  normalizeDay,
  normalizeTrade,
  reindexTrades
} from './models.js';
import {
  createDefaultSettings,
  loadSettings,
  mergeSettings,
  normalizeMemo,
  persistSettings
} from './settings.js';
import {
  clearAllDays,
  deleteDay,
  getAllDays,
  getDayByDate,
  replaceAllDays,
  saveDay
} from './storage.js';
import { deepClone, normalizeAnyDate, todayStr, trimText } from './utils.js';

let settings = loadSettings();
let days = [];
let analytics = buildAnalytics([]);

async function refreshState() {
  days = (await getAllDays()).map((day) => normalizeDay(day, settings)).sort((left, right) => right.date.localeCompare(left.date));
  analytics = buildAnalytics(days);
}

function countCsvImportedTrades(rawDays) {
  return (Array.isArray(rawDays) ? rawDays : []).reduce((total, day) => {
    const trades = Array.isArray(day?.trades) ? day.trades : [];
    return total + trades.filter(isCsvImportedTrade).length;
  }, 0);
}

function getExpectedCsvImportRows(localSettings, remoteSettings) {
  const localRows = Number(localSettings?.lastCsvImportSummary?.importedRows);
  const remoteRows = Number(remoteSettings?.lastCsvImportSummary?.importedRows);
  if (Number.isFinite(localRows) && localRows > 0) return localRows;
  if (Number.isFinite(remoteRows) && remoteRows > 0) return remoteRows;
  return 0;
}

function getCsvMergeSource(localSettings, remoteSettings, localDays = [], remoteDays = []) {
  const readTimestamp = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const localImportAt = readTimestamp(localSettings?.lastCsvImportAt);
  const remoteImportAt = readTimestamp(remoteSettings?.lastCsvImportAt);

  if (localImportAt > remoteImportAt) return 'local';
  if (remoteImportAt > localImportAt) return 'remote';

  const expectedRows = getExpectedCsvImportRows(localSettings, remoteSettings);
  if (expectedRows > 0) {
    const localMatchesImport = countCsvImportedTrades(localDays) === expectedRows;
    const remoteMatchesImport = countCsvImportedTrades(remoteDays) === expectedRows;

    if (localMatchesImport && !remoteMatchesImport) return 'local';
    if (remoteMatchesImport && !localMatchesImport) return 'remote';
  }

  return 'merge';
}

export function getTradeAppSnapshot() {
  return {
    version: APP_VERSION,
    settings: deepClone(settings),
    days: deepClone(days),
    analytics: deepClone(analytics),
    firebase: getFirebaseState()
  };
}

export async function initializeTradeCore() {
  settings = loadSettings();
  await refreshState();
  await restoreFirebaseSession();

  if (consumePendingPostLoginSync() && getFirebaseState().isSignedIn) {
    try {
      await syncWithCloud({ silent: true });
    } catch {}
  }

  initCloudSyncStatus();
  return getTradeAppSnapshot();
}

export function parseFirebaseConfigPreview(rawText) {
  if (!trimText(rawText)) return null;
  try {
    const config = parseFirebaseConfigInput(rawText);
    return {
      projectId: config.projectId || '',
      authDomain: config.authDomain || '',
      appId: config.appId || ''
    };
  } catch {
    return null;
  }
}

export async function importCsvFile(file) {
  return importCsvFiles([file]);
}

function buildCsvImportPreview(result) {
  const nextDays = result.days.map((day) => normalizeDay(day, settings));
  const dates = nextDays.map((day) => day.date).sort();
  const nextAnalytics = buildAnalytics(nextDays);

  return {
    summary: result.summary,
    dayCount: nextDays.length,
    tradeCount: nextDays.reduce((total, day) => total + day.trades.length, 0),
    dateStart: dates[0] || '',
    dateEnd: dates[dates.length - 1] || '',
    totalProfit: nextAnalytics.summaries.all.totalProfit,
    cashProfit: nextAnalytics.summaries.cash.totalProfit,
    marginProfit: nextAnalytics.summaries.margin.totalProfit
  };
}

export async function previewCsvImportFiles(files) {
  const result = await rebuildDaysFromCsvFiles(files, [], settings);
  return buildCsvImportPreview(result);
}

export async function importCsvFiles(files) {
  const result = await rebuildDaysFromCsvFiles(files, [], settings);
  const nextDays = result.days.map((day) => normalizeDay(day, settings));
  await replaceAllDays(nextDays);

  settings = persistSettings({
    ...settings,
    lastCsvImportAt: new Date().toISOString(),
    lastCsvImportSummary: result.summary
  });

  await refreshState();

  let cloudSynced = false;
  let cloudSyncError = '';
  if (getFirebaseState().isSignedIn) {
    setCloudSyncing(true, '正在用 CSV 覆盖云端数据…');
    try {
      await writeCloudSnapshot(days.map((day) => normalizeDay(day, settings)), settings);
      markCsvImportSyncComplete();
      cloudSynced = true;
    } catch (error) {
      cloudSyncError = error.message || String(error);
      updateCloudSyncStatus('CSV 已导入，本次云端覆盖失败');
    } finally {
      setCloudSyncing(false);
    }
  }

  return {
    summary: result.summary,
    preview: buildCsvImportPreview(result),
    cloudSynced,
    cloudSyncError,
    snapshot: getTradeAppSnapshot()
  };
}

export function createDraftTrade(preset = {}) {
  return createManualTrade(settings, preset);
}

export async function upsertManualDay({ date, trades, dayId = '' }) {
  const normalizedDate = normalizeAnyDate(date);
  if (!normalizedDate) {
    throw new Error('请选择有效日期。');
  }

  const normalizedTrades = (Array.isArray(trades) ? trades : [])
    .filter((trade) => trade?.fingerprint || isTradeComplete(trade))
    .map((trade, index) => normalizeTrade({
      ...trade,
      updatedAt: new Date().toISOString()
    }, normalizedDate, index, settings));

  if (!normalizedTrades.length) {
    throw new Error('至少保留一笔有效交易再保存。');
  }

  const now = new Date().toISOString();
  if (trimText(dayId)) {
    const current = days.find((day) => day.id === dayId)
      || await getDayByDate(normalizedDate)
      || { id: dayId, date: normalizedDate, trades: [] };

    const nextDay = normalizeDay({
      ...current,
      date: normalizedDate,
      trades: reindexTrades(normalizedTrades, normalizedDate, settings),
      updatedAt: now
    }, settings);

    await saveDay(nextDay);
  } else {
    const existing = await getDayByDate(normalizedDate);
    if (existing) {
      const mergedTrades = [
        ...normalizeDay(existing, settings).trades,
        ...normalizedTrades.filter((trade) => !trade.fingerprint)
      ];

      await saveDay(normalizeDay({
        ...existing,
        trades: reindexTrades(mergedTrades, normalizedDate, settings),
        updatedAt: now
      }, settings));
    } else {
      await saveDay(normalizeDay({
        id: crypto.randomUUID(),
        date: normalizedDate,
        trades: reindexTrades(normalizedTrades, normalizedDate, settings),
        updatedAt: now
      }, settings));
    }
  }

  await refreshState();
  return getTradeAppSnapshot();
}

export async function removeDayById(dayId) {
  await deleteDay(dayId);
  await refreshState();
  return getTradeAppSnapshot();
}

export async function upsertMemo({ id = '', title = '', body = '' } = {}) {
  const normalizedTitle = trimText(title);
  const normalizedBody = trimText(body);

  if (!normalizedTitle && !normalizedBody) {
    throw new Error('Memo 不能为空。');
  }

  const now = new Date().toISOString();
  const memoId = trimText(id) || crypto.randomUUID();
  const existing = (settings.memos || []).find((memo) => memo.id === memoId);
  const nextMemo = normalizeMemo({
    id: memoId,
    title: normalizedTitle || normalizedBody.slice(0, 28) || 'Memo',
    body: normalizedBody,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    deletedAt: ''
  });
  const others = (settings.memos || []).filter((memo) => memo.id !== memoId);

  settings = persistSettings({
    ...settings,
    memos: [nextMemo, ...others]
  });

  return getTradeAppSnapshot();
}

export async function deleteMemo(id) {
  const memoId = trimText(id);
  if (!memoId) return getTradeAppSnapshot();

  const existing = (settings.memos || []).find((memo) => memo.id === memoId);
  if (!existing) return getTradeAppSnapshot();

  const now = new Date().toISOString();
  settings = persistSettings({
    ...settings,
    memos: [
      normalizeMemo({
        ...existing,
        updatedAt: now,
        deletedAt: now
      }),
      ...(settings.memos || []).filter((memo) => memo.id !== memoId)
    ]
  });

  return getTradeAppSnapshot();
}

export async function saveFirebaseConfig(rawText) {
  await saveCloudConfig(rawText);
  await restoreFirebaseSession();
  return getTradeAppSnapshot();
}

export async function signInWithGoogle(rawText) {
  const result = await signInCloud(rawText);
  if (result.redirected) {
    return getTradeAppSnapshot();
  }

  return syncWithCloud({ silent: false });
}

export async function signOutFromFirebase() {
  await signOutCloud();
  await restoreFirebaseSession();
  return getTradeAppSnapshot();
}

export async function syncWithCloud(options = {}) {
  const { silent = false } = options;
  if (getFirebaseState().isSyncing) return getTradeAppSnapshot();

  setCloudSyncing(true, '正在安全合并云端数据…');

  try {
    const remoteSnapshot = await fetchCloudSnapshot();
    const csvSource = getCsvMergeSource(settings, remoteSnapshot.settings, days, remoteSnapshot.days || []);
    const mergedSettings = mergeSettings(settings, remoteSnapshot.settings);
    const mergedDays = mergeDays(days, remoteSnapshot.days || [], mergedSettings, { csvSource });

    settings = persistSettings(mergedSettings);
    await replaceAllDays(mergedDays.map((day) => normalizeDay(day, settings)));
    await refreshState();
    await writeCloudSnapshot(days.map((day) => normalizeDay(day, settings)), settings);
    markMergeSyncComplete();

    return getTradeAppSnapshot();
  } catch (error) {
    updateCloudSyncStatus(silent ? '后台同步失败' : '同步失败');
    throw error;
  } finally {
    setCloudSyncing(false);
    initCloudSyncStatus();
  }
}

export async function clearCloudTradeData() {
  setCloudSyncing(true, '正在清空云端数据…');

  try {
    await clearRemoteCloudData();
    return getTradeAppSnapshot();
  } finally {
    setCloudSyncing(false);
    initCloudSyncStatus();
  }
}

export async function clearLocalTradeData() {
  setCloudSyncing(true, '正在清空本地数据…');

  try {
    await clearAllDays();
    settings = persistSettings(createDefaultSettings());
    markLocalClearComplete();
    await refreshState();
    return getTradeAppSnapshot();
  } finally {
    setCloudSyncing(false);
    initCloudSyncStatus();
  }
}

export function buildNextTradeFromType(trade, manualType, date = todayStr()) {
  return normalizeTrade({
    ...trade,
    manualType,
    updatedAt: new Date().toISOString()
  }, date, Number(trade?.order) || 0, settings);
}
