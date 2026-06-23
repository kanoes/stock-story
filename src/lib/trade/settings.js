import { APP_VERSION, SETTINGS_KEY } from './constants.js';
import { trimText } from './utils.js';

export function createDefaultSettings() {
  const now = new Date().toISOString();
  return {
    version: APP_VERSION,
    updatedAt: now,
    lastCsvImportAt: '',
    lastCsvImportSummary: null
  };
}

export function normalizeSettings(raw) {
  const defaults = createDefaultSettings();
  const settings = raw && typeof raw === 'object' ? raw : {};

  return {
    version: APP_VERSION,
    updatedAt: trimText(settings.updatedAt) || defaults.updatedAt,
    lastCsvImportAt: trimText(settings.lastCsvImportAt) || '',
    lastCsvImportSummary: settings.lastCsvImportSummary || null
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
      : (local.lastCsvImportSummary || remote.lastCsvImportSummary)
  });
}
