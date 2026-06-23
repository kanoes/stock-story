import { APP_VERSION, SETTINGS_KEY } from './constants.js';
import { trimText } from './utils.js';

export function createDefaultSettings() {
  const now = new Date().toISOString();
  return {
    version: APP_VERSION,
    updatedAt: now,
    lastCsvImportAt: '',
    lastCsvImportSummary: null,
    memos: []
  };
}

function readTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function normalizeMemo(rawMemo, index = 0) {
  const raw = rawMemo && typeof rawMemo === 'object' ? rawMemo : {};
  const id = trimText(raw.id) || `legacy-memo-${index}`;
  const title = trimText(raw.title);
  const body = trimText(raw.body);
  const updatedAt = trimText(raw.updatedAt) || trimText(raw.createdAt) || '';
  const createdAt = trimText(raw.createdAt) || updatedAt;
  const deletedAt = trimText(raw.deletedAt);

  return {
    id,
    title,
    body,
    createdAt,
    updatedAt,
    deletedAt
  };
}

function normalizeMemos(rawMemos) {
  if (!Array.isArray(rawMemos)) return [];

  return rawMemos
    .map(normalizeMemo)
    .filter((memo) => memo.id && (memo.title || memo.body || memo.deletedAt))
    .sort((left, right) => {
      const rightTime = readTime(right.updatedAt || right.deletedAt || right.createdAt);
      const leftTime = readTime(left.updatedAt || left.deletedAt || left.createdAt);
      return rightTime - leftTime;
    });
}

function mergeMemos(localMemos, remoteMemos) {
  const merged = new Map();

  [...normalizeMemos(localMemos), ...normalizeMemos(remoteMemos)].forEach((memo) => {
    const existing = merged.get(memo.id);
    if (!existing || readTime(memo.updatedAt || memo.deletedAt || memo.createdAt) >= readTime(existing.updatedAt || existing.deletedAt || existing.createdAt)) {
      merged.set(memo.id, memo);
    }
  });

  return normalizeMemos(Array.from(merged.values()));
}

export function normalizeSettings(raw) {
  const defaults = createDefaultSettings();
  const settings = raw && typeof raw === 'object' ? raw : {};

  return {
    version: APP_VERSION,
    updatedAt: trimText(settings.updatedAt) || defaults.updatedAt,
    lastCsvImportAt: trimText(settings.lastCsvImportAt) || '',
    lastCsvImportSummary: settings.lastCsvImportSummary || null,
    memos: normalizeMemos(settings.memos)
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return createDefaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return createDefaultSettings();
  }
}

export function persistSettings(settings) {
  const nextSettings = normalizeSettings({
    ...settings,
    updatedAt: new Date().toISOString()
  });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
  return nextSettings;
}

export function mergeSettings(localSettings, remoteSettings) {
  const local = normalizeSettings(localSettings);
  if (!remoteSettings) return local;

  const remote = normalizeSettings(remoteSettings);
  const localImportAt = new Date(local.lastCsvImportAt || 0).getTime();
  const remoteImportAt = new Date(remote.lastCsvImportAt || 0).getTime();
  const useRemoteImport = remoteImportAt >= localImportAt;

  return normalizeSettings({
    version: APP_VERSION,
    updatedAt: new Date(Math.max(
      new Date(local.updatedAt || 0).getTime(),
      new Date(remote.updatedAt || 0).getTime(),
      Date.now()
    )).toISOString(),
    lastCsvImportAt: useRemoteImport ? remote.lastCsvImportAt : local.lastCsvImportAt,
    lastCsvImportSummary: useRemoteImport
      ? (remote.lastCsvImportSummary || local.lastCsvImportSummary)
      : (local.lastCsvImportSummary || remote.lastCsvImportSummary),
    memos: mergeMemos(local.memos, remote.memos)
  });
}
