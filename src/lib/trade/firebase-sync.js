import {
  CLOUD_SYNC_META_KEY,
  FIREBASE_CONFIG_KEY,
  POST_LOGIN_SYNC_KEY
} from './constants.js';
import { maskEmail, trimText } from './utils.js';
import * as appMod from 'firebase/app';
import * as authMod from 'firebase/auth';
import * as firestoreMod from 'firebase/firestore/lite';

const APP_NAME = 'trade-ledger-cloud';

const cloudState = {
  configText: localStorage.getItem(FIREBASE_CONFIG_KEY) || '',
  isSignedIn: false,
  isSyncing: false,
  syncStatusText: '尚未同步',
  authStatusText: '还没有填写 Firebase Web 配置。',
  user: null,
  runtime: null,
  runtimePromise: null,
  observerAttached: false,
  redirectChecked: false,
  pendingPostLoginSync: false
};

function updateCloudAuthStatus(message = '') {
  if (message) {
    cloudState.authStatusText = message;
    return;
  }

  if (!trimText(cloudState.configText)) {
    cloudState.authStatusText = '还没有填写 Firebase Web 配置。';
    return;
  }

  if (cloudState.user?.email) {
    const accountLabel = trimText(cloudState.user.displayName)
      ? `${trimText(cloudState.user.displayName)} · ${maskEmail(cloudState.user.email)}`
      : maskEmail(cloudState.user.email);
    cloudState.authStatusText = `当前云账号：${accountLabel}`;
    return;
  }

  cloudState.authStatusText = 'Firebase 已连接，当前未登录 Google。';
}

export function initCloudSyncStatus() {
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_META_KEY);
    if (!raw) {
      cloudState.syncStatusText = cloudState.user?.uid ? '已登录，尚未同步' : '尚未同步';
      return;
    }

    const data = JSON.parse(raw);
    const directionMap = {
      merge: '安全合并',
      import: 'CSV 覆盖',
      clear: '清空云端',
      local: '清空本地'
    };
    cloudState.syncStatusText = `${data.at} · ${directionMap[data.dir] || '同步'}`;
  } catch {
    cloudState.syncStatusText = cloudState.user?.uid ? '已登录，尚未同步' : '尚未同步';
  }
}

export function setCloudSyncing(isSyncing, statusText = '') {
  cloudState.isSyncing = Boolean(isSyncing);
  if (statusText) {
    cloudState.syncStatusText = statusText;
  }
}

export function updateCloudSyncStatus(text) {
  cloudState.syncStatusText = text || '尚未同步';
}

function recordSyncMeta(direction) {
  const at = new Date().toLocaleString('zh-CN');
  localStorage.setItem(CLOUD_SYNC_META_KEY, JSON.stringify({
    at,
    dir: direction,
    provider: 'Firebase'
  }));
  initCloudSyncStatus();
}

export function getFirebaseState() {
  return {
    configText: cloudState.configText,
    isSignedIn: Boolean(cloudState.user?.uid),
    isSyncing: cloudState.isSyncing,
    syncStatusText: cloudState.syncStatusText,
    authStatusText: cloudState.authStatusText,
    user: cloudState.user
      ? {
          uid: cloudState.user.uid,
          email: cloudState.user.email || '',
          displayName: cloudState.user.displayName || ''
        }
      : null
  };
}

export function parseFirebaseConfigInput(rawValue) {
  let text = trimText(rawValue);
  if (!text) {
    throw new Error('请先粘贴 Firebase Web 配置。');
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  const normalizedJson = text
    .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,\s*([}\]])/g, '$1');

  let parsed;
  try {
    parsed = JSON.parse(normalizedJson);
  } catch (error) {
    throw new Error(`Firebase 配置解析失败：${error.message || error}`);
  }

  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missingKeys = requiredKeys.filter((key) => !trimText(parsed[key]));
  if (missingKeys.length) {
    throw new Error(`Firebase 配置缺少这些字段：${missingKeys.join('、')}`);
  }

  return parsed;
}

function normalizeFirebaseConfig(config) {
  const parsed = parseFirebaseConfigInput(JSON.stringify(config || {}));
  return {
    apiKey: parsed.apiKey,
    authDomain: parsed.authDomain,
    projectId: parsed.projectId,
    storageBucket: parsed.storageBucket || '',
    messagingSenderId: parsed.messagingSenderId || '',
    appId: parsed.appId,
    measurementId: parsed.measurementId || ''
  };
}

function isSameProject(leftOptions = {}, rightConfig = {}) {
  return leftOptions.projectId === rightConfig.projectId && leftOptions.appId === rightConfig.appId;
}

async function loadFirebaseRuntimeModules() {
  return { appMod, authMod, firestoreMod };
}

async function teardownRuntime() {
  if (!cloudState.runtime?.app) return;
  try {
    await cloudState.runtime.appMod.deleteApp(cloudState.runtime.app);
  } catch {}

  cloudState.runtime = null;
  cloudState.runtimePromise = null;
  cloudState.observerAttached = false;
  cloudState.redirectChecked = false;
  cloudState.user = null;
  updateCloudAuthStatus();
}

function waitForAuthState(authMod, auth) {
  return new Promise((resolve) => {
    const unsubscribe = authMod.onAuthStateChanged(auth, (user) => {
      cloudState.user = user || null;
      unsubscribe();
      resolve(user || null);
    });
  });
}

async function ensureRuntime() {
  if (cloudState.runtime) return cloudState.runtime;
  if (cloudState.runtimePromise) return cloudState.runtimePromise;

  cloudState.runtimePromise = (async () => {
    if (!trimText(cloudState.configText)) {
      throw new Error('请先填写 Firebase Web 配置。');
    }

    const config = normalizeFirebaseConfig(parseFirebaseConfigInput(cloudState.configText));
    const { appMod, authMod, firestoreMod } = await loadFirebaseRuntimeModules();

    const existingApp = appMod.getApps().find((app) => app.name === APP_NAME) || null;
    let app = existingApp;

    if (existingApp && !isSameProject(existingApp.options, config)) {
      await appMod.deleteApp(existingApp);
      app = null;
    }

    if (!app) {
      app = appMod.initializeApp(config, APP_NAME);
    }

    const auth = authMod.getAuth(app);
    const db = firestoreMod.getFirestore(app);
    auth.languageCode = navigator.language || 'zh-CN';
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);

    if (!cloudState.observerAttached) {
      authMod.onAuthStateChanged(auth, (user) => {
        cloudState.user = user || null;
        updateCloudAuthStatus();
      });
      cloudState.observerAttached = true;
    }

    if (!cloudState.redirectChecked) {
      cloudState.redirectChecked = true;
      const result = await authMod.getRedirectResult(auth);
      if (result?.user) {
        cloudState.user = result.user;
        cloudState.pendingPostLoginSync = true;
      }
    }

    if (!auth.currentUser) {
      await waitForAuthState(authMod, auth);
    } else {
      cloudState.user = auth.currentUser;
    }

    if (localStorage.getItem(POST_LOGIN_SYNC_KEY) && cloudState.user?.uid) {
      cloudState.pendingPostLoginSync = true;
    }

    cloudState.runtime = { app, auth, db, appMod, authMod, firestoreMod };
    updateCloudAuthStatus();
    return cloudState.runtime;
  })().catch((error) => {
    cloudState.runtimePromise = null;
    updateCloudAuthStatus(error.message || String(error));
    throw error;
  });

  return cloudState.runtimePromise;
}

export async function saveFirebaseConfig(rawValue) {
  const normalizedConfig = normalizeFirebaseConfig(parseFirebaseConfigInput(rawValue));
  const nextText = JSON.stringify(normalizedConfig, null, 2);
  const hasChanged = trimText(nextText) !== trimText(cloudState.configText);
  cloudState.configText = nextText;
  localStorage.setItem(FIREBASE_CONFIG_KEY, nextText);

  if (hasChanged) {
    await teardownRuntime();
  }

  updateCloudAuthStatus('Firebase 配置已保存。');
  return { normalizedConfig, hasChanged };
}

export async function restoreFirebaseSession() {
  if (!trimText(cloudState.configText)) {
    updateCloudAuthStatus();
    initCloudSyncStatus();
    return getFirebaseState();
  }

  try {
    await ensureRuntime();
    updateCloudAuthStatus();
  } catch (error) {
    updateCloudAuthStatus(`Firebase 未连接：${error.message || error}`);
  }

  initCloudSyncStatus();
  return getFirebaseState();
}

export function consumePendingPostLoginSync() {
  const shouldSync = cloudState.pendingPostLoginSync;
  cloudState.pendingPostLoginSync = false;
  localStorage.removeItem(POST_LOGIN_SYNC_KEY);
  return shouldSync;
}

export async function signInWithGoogle(rawConfigText = '') {
  if (trimText(rawConfigText)) {
    await saveFirebaseConfig(rawConfigText);
  }

  const runtime = await ensureRuntime();
  const provider = new runtime.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await runtime.authMod.signInWithPopup(runtime.auth, provider);
    cloudState.user = result.user || runtime.auth.currentUser || null;
    cloudState.pendingPostLoginSync = true;
    updateCloudAuthStatus();
    return { redirected: false };
  } catch (error) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(error?.code || '')) {
      localStorage.setItem(POST_LOGIN_SYNC_KEY, '1');
      await runtime.authMod.signInWithRedirect(runtime.auth, provider);
      updateCloudAuthStatus('正在跳转到 Google…');
      return { redirected: true };
    }

    updateCloudAuthStatus(error.message || String(error));
    throw error;
  }
}

export async function signOutFromFirebase() {
  const runtime = await ensureRuntime();
  await runtime.authMod.signOut(runtime.auth);
  cloudState.user = null;
  localStorage.removeItem(POST_LOGIN_SYNC_KEY);
  updateCloudAuthStatus();
}

function createBatchQueue(firestoreMod, db) {
  let batch = firestoreMod.writeBatch(db);
  let operationCount = 0;
  const commits = [];

  const flush = () => {
    if (!operationCount) return;
    commits.push(batch.commit());
    batch = firestoreMod.writeBatch(db);
    operationCount = 0;
  };

  return {
    set(ref, value) {
      if (operationCount >= 400) flush();
      batch.set(ref, value);
      operationCount += 1;
    },
    delete(ref) {
      if (operationCount >= 400) flush();
      batch.delete(ref);
      operationCount += 1;
    },
    async commitAll() {
      flush();
      await Promise.all(commits);
    }
  };
}

function assertSignedIn() {
  if (!cloudState.user?.uid) {
    throw new Error('请先登录 Firebase 云账号。');
  }
}

export async function fetchCloudSnapshot() {
  const runtime = await ensureRuntime();
  assertSignedIn();

  const daysCollection = runtime.firestoreMod.collection(runtime.db, 'users', cloudState.user.uid, 'days');
  const settingsRef = runtime.firestoreMod.doc(runtime.db, 'users', cloudState.user.uid, 'meta', 'settings');

  const [daysSnapshot, settingsSnapshot] = await Promise.all([
    runtime.firestoreMod.getDocs(daysCollection),
    runtime.firestoreMod.getDoc(settingsRef)
  ]);

  return {
    days: daysSnapshot.docs.map((doc) => ({
      ...doc.data(),
      date: doc.id
    })),
    settings: settingsSnapshot.exists() ? (settingsSnapshot.data()?.data || settingsSnapshot.data()) : null
  };
}

export async function writeCloudSnapshot(days, settings) {
  const runtime = await ensureRuntime();
  assertSignedIn();

  const daysCollection = runtime.firestoreMod.collection(runtime.db, 'users', cloudState.user.uid, 'days');
  const settingsRef = runtime.firestoreMod.doc(runtime.db, 'users', cloudState.user.uid, 'meta', 'settings');
  const existingDays = await runtime.firestoreMod.getDocs(daysCollection);
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const queue = createBatchQueue(runtime.firestoreMod, runtime.db);

  existingDays.forEach((doc) => {
    if (!dayMap.has(doc.id)) {
      queue.delete(doc.ref);
    }
  });

  dayMap.forEach((day, date) => {
    queue.set(runtime.firestoreMod.doc(runtime.db, 'users', cloudState.user.uid, 'days', date), day);
  });

  queue.set(settingsRef, {
    data: settings,
    updatedAt: new Date().toISOString(),
    version: settings.version
  });

  await queue.commitAll();
}

export async function clearCloudTradeData() {
  const runtime = await ensureRuntime();
  assertSignedIn();

  const daysCollection = runtime.firestoreMod.collection(runtime.db, 'users', cloudState.user.uid, 'days');
  const settingsRef = runtime.firestoreMod.doc(runtime.db, 'users', cloudState.user.uid, 'meta', 'settings');
  const daysSnapshot = await runtime.firestoreMod.getDocs(daysCollection);
  const queue = createBatchQueue(runtime.firestoreMod, runtime.db);

  daysSnapshot.forEach((doc) => queue.delete(doc.ref));
  queue.delete(settingsRef);
  await queue.commitAll();

  recordSyncMeta('clear');
}

export function markMergeSyncComplete() {
  recordSyncMeta('merge');
}

export function markCsvImportSyncComplete() {
  recordSyncMeta('import');
}

export function markLocalClearComplete() {
  recordSyncMeta('local');
}
