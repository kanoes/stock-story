import { useEffect, useRef, useState } from 'react';

import {
  buildAnalytics,
  getTradeAppSnapshot,
  initializeTradeCore,
  syncWithCloud
} from '../lib/trade/index.js';

const EMPTY_SNAPSHOT = {
  version: '5.0.0',
  settings: {
    lastCsvImportAt: '',
    lastCsvImportSummary: null
  },
  days: [],
  analytics: buildAnalytics([]),
  firebase: {
    configText: '',
    isSignedIn: false,
    isSyncing: false,
    syncStatusText: '尚未同步',
    authStatusText: '还没有填写 Firebase Web 配置。',
    user: null
  }
};

export function useTradeSnapshot({ setToast }) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [ready, setReady] = useState(false);
  const [initialError, setInitialError] = useState('');
  const [firebaseDraft, setFirebaseDraft] = useState('');
  const bootSyncedRef = useRef(false);

  function applySnapshot(nextSnapshot) {
    setSnapshot(nextSnapshot);
    setFirebaseDraft(nextSnapshot.firebase.configText || '');
  }

  useEffect(() => {
    let active = true;

    initializeTradeCore()
      .then((nextSnapshot) => {
        if (!active) return;
        applySnapshot(nextSnapshot);
        setReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setInitialError(error.message || String(error));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || bootSyncedRef.current || !snapshot.firebase.isSignedIn) return;
    bootSyncedRef.current = true;

    syncWithCloud({ silent: true })
      .then((nextSnapshot) => applySnapshot(nextSnapshot))
      .catch(() => {});
  }, [ready, snapshot.firebase.isSignedIn]);

  async function runTask(task, options = {}) {
    try {
      const result = await task();
      if (result?.version) {
        applySnapshot(result);
      } else if (result?.snapshot?.version) {
        applySnapshot(result.snapshot);
      } else {
        applySnapshot(getTradeAppSnapshot());
      }

      if (options.successText) {
        setToast({ tone: 'success', text: options.successText });
      }

      return result;
    } catch (error) {
      setToast({ tone: 'danger', text: error.message || String(error) });
      throw error;
    }
  }

  return {
    snapshot,
    ready,
    initialError,
    firebaseDraft,
    setFirebaseDraft,
    applySnapshot,
    runTask
  };
}
