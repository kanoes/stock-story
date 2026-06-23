import { useEffect, useRef, useState } from 'react';

import {
  clearCloudTradeData,
  clearLocalTradeData,
  importCsvFiles,
  maskEmail,
  parseFirebaseConfigPreview,
  previewCsvImportFiles,
  RECORDS_PAGE_SIZE,
  saveFirebaseConfig,
  signInWithGoogle,
  signOutFromFirebase,
  syncWithCloud,
  todayStr,
  trimText
} from './lib/trade/index.js';
import {
  buildAnalysisDiagnostics,
  buildBarChartData,
  buildDashboardTimeline,
  buildHealthReport,
  buildLineChartData,
  buildMonthlyHighlights,
  buildRecordFilterBadges,
  findExtremeDays,
  summarizeRecordDays
} from './lib/view-models.js';
import { BottomNav, Toast } from './components/common.jsx';
import {
  ConfirmSheet,
  CsvImportPreviewSheet,
  ManualDaySheet,
  RecordFilterSheet
} from './components/sheets.jsx';
import {
  AnalysisTab,
  HomeTab,
  RecordsTab,
  SettingsTab
} from './components/tabs.jsx';
import { useManualDayEditor } from './hooks/use-manual-day-editor.js';
import { useTradeSnapshot } from './hooks/use-trade-snapshot.js';

const MOBILE_BREAKPOINT = '(max-width: 720px)';
const MOBILE_VISIBLE_LIMIT = 8;
const MOBILE_RANKING_LIMIT = 10;

const DEFAULT_RECORD_FILTERS = {
  month: 'all',
  search: '',
  source: 'all',
  outcome: 'all',
  sort: 'desc',
  compact: false
};

function createConfirmState() {
  return {
    open: false,
    mode: 'local'
  };
}

function createCsvPreviewState() {
  return {
    open: false,
    confirming: false,
    files: [],
    preview: null
  };
}

function getMonthOptions(days) {
  return Array.from(new Set(days.map((day) => day.date.slice(0, 7)))).sort().reverse();
}

function isCompactViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches;
}

export function App() {
  const [toast, setToast] = useState(null);
  const {
    snapshot,
    ready,
    initialError,
    firebaseDraft,
    setFirebaseDraft,
    runTask
  } = useTradeSnapshot({ setToast });
  const [isCompactScreen, setIsCompactScreen] = useState(isCompactViewport);
  const [activeTab, setActiveTab] = useState('home');
  const [dashboardScope, setDashboardScope] = useState('all');
  const [analysisScope, setAnalysisScope] = useState('all');
  const [chartRange, setChartRange] = useState('week');
  const [chartType, setChartType] = useState('cumulative');
  const [recordsPage, setRecordsPage] = useState(0);
  const [recordFilters, setRecordFilters] = useState(DEFAULT_RECORD_FILTERS);
  const [recordFilterSheetOpen, setRecordFilterSheetOpen] = useState(false);
  const [confirmState, setConfirmState] = useState(createConfirmState());
  const [csvPreviewState, setCsvPreviewState] = useState(createCsvPreviewState());
  const [showAllPositions, setShowAllPositions] = useState(false);
  const [showAllRanking, setShowAllRanking] = useState(false);
  const csvInputRef = useRef(null);
  const {
    manualSheet,
    setManualDate,
    openAddSheet,
    openEditSheet,
    closeManualSheet,
    handleManualTradeUpdate,
    handleManualRemove,
    handleManualMove,
    handleManualAdd,
    handleManualDuplicate,
    handleManualReverse,
    handleManualSave,
    handleDeleteDay
  } = useManualDayEditor({
    runTask,
    onSaved: () => setActiveTab('records')
  });

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia(MOBILE_BREAKPOINT);
    const sync = () => setIsCompactScreen(media.matches);
    sync();
    media.addEventListener('change', sync);

    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isCompactScreen) return;
    setRecordFilters((current) => (current.compact ? current : { ...current, compact: true }));
  }, [isCompactScreen]);

  useEffect(() => {
    setRecordsPage(0);
  }, [dashboardScope, recordFilters.month, recordFilters.search, recordFilters.source, recordFilters.outcome, recordFilters.sort, recordFilters.compact]);

  useEffect(() => {
    setShowAllPositions(false);
    setShowAllRanking(false);
  }, [analysisScope, activeTab, isCompactScreen]);

  async function handleCsvImport(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    try {
      const preview = await previewCsvImportFiles(files);
      setCsvPreviewState({
        open: true,
        confirming: false,
        files,
        preview
      });
    } catch (error) {
      setToast({ tone: 'danger', text: error.message || String(error) });
    } finally {
      event.target.value = '';
    }
  }

  function closeCsvPreview() {
    setCsvPreviewState(createCsvPreviewState());
  }

  async function confirmCsvImport() {
    if (!csvPreviewState.files.length || csvPreviewState.confirming) return;

    setCsvPreviewState((current) => ({ ...current, confirming: true }));

    try {
      const result = await runTask(() => importCsvFiles(csvPreviewState.files));
      const marginSummary = result.summary.marginSettlements;
      const supplementText = marginSummary?.importedRows
        ? `，信用补充 ${result.summary.matchedMarginSettlementRows}/${marginSummary.importedRows} 行`
        : '';
      const taxText = result.summary.taxDetailRows
        ? `，现物明细 ${result.summary.matchedTaxDetailRows || 0}/${result.summary.taxDetailRows} 行`
        : '';
      const fundText = result.summary.importedInvestmentTrustRows
        ? `，投信 ${result.summary.importedInvestmentTrustRows} 行`
        : '';
      const conversionText = result.summary.importedConversionRows
        ? `，現引 ${result.summary.importedConversionRows} 行`
        : '';
      const skippedText = [
        result.summary.skippedInvestmentTrust ? `忽略投信 ${result.summary.skippedInvestmentTrust} 行` : '',
        result.summary.skippedUnsupported ? `不支持 ${result.summary.skippedUnsupported} 行` : ''
      ].filter(Boolean).join('，');
      const cloudText = result.cloudSynced
        ? '，已覆盖云端'
        : result.cloudSyncError
          ? '，云端覆盖失败，请稍后手动同步'
          : '';
      setActiveTab('records');
      setCsvPreviewState(createCsvPreviewState());
      setToast({
        tone: result.cloudSyncError ? 'warning' : 'success',
        text: `已重建导入 ${result.summary.importedRows} 笔交易${fundText}${conversionText}${supplementText}${taxText}${cloudText}${skippedText ? `，${skippedText}` : ''}。`
      });
    } catch {
      setCsvPreviewState((current) => ({ ...current, confirming: false }));
    }
  }

  async function handleFirebaseConfigSave() {
    await runTask(() => saveFirebaseConfig(firebaseDraft), { successText: 'Firebase 配置已保存。' });
  }

  async function handleCloudLogin() {
    await runTask(() => signInWithGoogle(firebaseDraft), { successText: '已完成安全合并同步。' });
  }

  async function handleCloudLogout() {
    await runTask(() => signOutFromFirebase(), { successText: '已退出当前账号。' });
  }

  async function handleCloudSync() {
    await runTask(() => syncWithCloud(), { successText: '已完成安全合并同步。' });
  }

  async function handleDangerConfirm() {
    if (confirmState.mode === 'cloud') {
      await runTask(() => clearCloudTradeData(), { successText: '云端数据已清空。' });
    } else {
      await runTask(() => clearLocalTradeData(), { successText: '本地数据已清空。' });
    }
    setConfirmState(createConfirmState());
  }

  const dashboardSummary = snapshot.analytics.summaries[dashboardScope];
  const analysisSummary = snapshot.analytics.summaries[analysisScope];
  const chartData = buildLineChartData(buildDashboardTimeline(snapshot.analytics.daysAsc, dashboardScope, chartRange), dashboardScope, chartType);
  const monthlyChartData = buildBarChartData(analysisSummary);
  const healthReport = buildHealthReport(snapshot.days);
  const dashboardDiagnostics = buildAnalysisDiagnostics(
    dashboardSummary,
    snapshot.analytics.trades.filter((trade) => dashboardScope === 'all' || trade.assetType === dashboardScope)
  );
  const analysisDiagnostics = buildAnalysisDiagnostics(
    analysisSummary,
    snapshot.analytics.trades.filter((trade) => analysisScope === 'all' || trade.assetType === analysisScope)
  );
  const currentMonthKey = todayStr().slice(0, 7);
  const currentMonthProfit = dashboardSummary.monthly.find((item) => item.month === currentMonthKey)?.profit || 0;
  const latestDay = snapshot.analytics.daysDesc.find((day) => day.scopes[dashboardScope].tradeCount > 0) || null;
  const configPreview = parseFirebaseConfigPreview(firebaseDraft);
  const monthOptions = getMonthOptions(snapshot.days);
  const analysisExtremes = findExtremeDays(snapshot.analytics.daysDesc, analysisScope);
  const monthlyHighlights = buildMonthlyHighlights(analysisSummary.monthly);
  const bestStock = analysisSummary.ranking[0] || null;
  const worstStock = [...analysisSummary.ranking].reverse().find((item) => item.profit < 0) || analysisSummary.ranking[analysisSummary.ranking.length - 1] || null;
  const recordFilterBadges = buildRecordFilterBadges(recordFilters);
  const currentAccountLabel = snapshot.firebase.user?.email
    ? maskEmail(snapshot.firebase.user.email)
    : (configPreview?.projectId ? '已配置' : '未配置');

  const filteredRecordDays = snapshot.analytics.daysDesc
    .filter((day) => day.scopes[dashboardScope].tradeCount > 0)
    .filter((day) => (recordFilters.month === 'all' ? true : day.date.slice(0, 7) === recordFilters.month))
    .filter((day) => {
      const normalizedSearch = trimText(recordFilters.search).toLowerCase();
      if (!normalizedSearch) return true;
      return day.trades.some((trade) => {
        if (dashboardScope !== 'all' && trade.assetType !== dashboardScope) return false;
        const haystack = [
          trade.symbol,
          trade.name,
          trade.notes,
          trade.tradeTypeLabel
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    })
    .filter((day) => {
      if (recordFilters.source === 'all') return true;
      const trades = day.trades.filter((trade) => dashboardScope === 'all' || trade.assetType === dashboardScope);
      if (recordFilters.source === 'csv') return trades.some((trade) => trade.fingerprint);
      return trades.some((trade) => !trade.fingerprint);
    })
    .filter((day) => {
      const profit = day.scopes[dashboardScope].profit;
      if (recordFilters.outcome === 'win') return profit > 0;
      if (recordFilters.outcome === 'loss') return profit < 0;
      if (recordFilters.outcome === 'flat') return profit === 0;
      return true;
    })
    .sort((left, right) => {
      if (recordFilters.sort === 'profit') {
        return Math.abs(right.scopes[dashboardScope].profit) - Math.abs(left.scopes[dashboardScope].profit);
      }
      if (recordFilters.sort === 'oldest') {
        return left.date.localeCompare(right.date);
      }
      return right.date.localeCompare(left.date);
    });

  const filteredRecordSummary = summarizeRecordDays(filteredRecordDays, dashboardScope);
  const recordPageSize = recordFilters.compact ? 10 : RECORDS_PAGE_SIZE;
  const totalRecordPages = filteredRecordDays.length ? Math.ceil(filteredRecordDays.length / recordPageSize) : 0;
  const safeRecordsPage = totalRecordPages ? Math.min(recordsPage, totalRecordPages - 1) : 0;
  const visibleRecordDays = filteredRecordDays.slice(safeRecordsPage * recordPageSize, (safeRecordsPage + 1) * recordPageSize);

  const sortedPositions = [...analysisSummary.positions].sort((left, right) => (right.quantity * right.avgPrice) - (left.quantity * left.avgPrice));
  const visiblePositions = isCompactScreen && !showAllPositions
    ? sortedPositions.slice(0, MOBILE_VISIBLE_LIMIT)
    : sortedPositions;
  const visibleRanking = isCompactScreen && !showAllRanking
    ? analysisSummary.ranking.slice(0, MOBILE_RANKING_LIMIT)
    : analysisSummary.ranking;
  const recentDays = snapshot.analytics.daysDesc
    .filter((day) => day.scopes[dashboardScope].tradeCount > 0)
    .slice(0, 5);

  if (!ready && !initialError) {
    return (
      <div className="loading-page">
        <div className="loading-card">
          <div className="loading-dot" />
          <h1>载入中</h1>
        </div>
      </div>
    );
  }

  if (initialError) {
    return (
      <div className="loading-page">
        <div className="loading-card error">
          <h1>启动失败</h1>
          <p>{initialError}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <input ref={csvInputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={handleCsvImport} />

      <div className="app-shell">
        {activeTab === 'home' ? (
          <HomeTab
            dashboardScope={dashboardScope}
            setDashboardScope={setDashboardScope}
            dashboardSummary={dashboardSummary}
            dashboardDiagnostics={dashboardDiagnostics}
            currentMonthProfit={currentMonthProfit}
            latestDay={latestDay}
            chartRange={chartRange}
            setChartRange={setChartRange}
            chartType={chartType}
            setChartType={setChartType}
            chartData={chartData}
            onAddRecord={openAddSheet}
            onImportCsv={() => csvInputRef.current?.click()}
            onOpenSync={() => {
              if (snapshot.firebase.isSignedIn) {
                handleCloudSync();
                return;
              }
              setActiveTab('settings');
            }}
            recentDays={recentDays}
            onOpenDay={openEditSheet}
          />
        ) : null}

        {activeTab === 'records' ? (
          <RecordsTab
            dashboardScope={dashboardScope}
            setDashboardScope={setDashboardScope}
            recordFilterBadges={recordFilterBadges}
            filteredRecordSummary={filteredRecordSummary}
            visibleRecordDays={visibleRecordDays}
            totalRecordPages={totalRecordPages}
            safeRecordsPage={safeRecordsPage}
            setRecordsPage={setRecordsPage}
            onOpenFilters={() => setRecordFilterSheetOpen(true)}
            onOpenDay={openEditSheet}
          />
        ) : null}

        {activeTab === 'analysis' ? (
          <AnalysisTab
            analysisScope={analysisScope}
            setAnalysisScope={setAnalysisScope}
            analysisSummary={analysisSummary}
            analysisDiagnostics={analysisDiagnostics}
            analysisExtremes={analysisExtremes}
            monthlyHighlights={monthlyHighlights}
            bestStock={bestStock}
            worstStock={worstStock}
            monthlyChartData={monthlyChartData}
            healthReport={healthReport}
            visiblePositions={visiblePositions}
            visibleRanking={visibleRanking}
            showAllPositions={showAllPositions}
            setShowAllPositions={setShowAllPositions}
            showAllRanking={showAllRanking}
            setShowAllRanking={setShowAllRanking}
            isCompactScreen={isCompactScreen}
          />
        ) : null}

        {activeTab === 'settings' ? (
          <SettingsTab
            snapshot={snapshot}
            currentAccountLabel={currentAccountLabel}
            configPreview={configPreview}
            firebaseDraft={firebaseDraft}
            setFirebaseDraft={setFirebaseDraft}
            onSaveConfig={handleFirebaseConfigSave}
            onLogin={handleCloudLogin}
            onLogout={handleCloudLogout}
            onSync={handleCloudSync}
            onOpenLocalClear={() => setConfirmState({ open: true, mode: 'local' })}
            onOpenCloudClear={() => setConfirmState({ open: true, mode: 'cloud' })}
            onAddRecord={openAddSheet}
            onImportCsv={() => csvInputRef.current?.click()}
          />
        ) : null}
      </div>

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />

      <RecordFilterSheet
        open={recordFilterSheetOpen}
        recordFilters={recordFilters}
        setRecordFilters={setRecordFilters}
        dashboardScope={dashboardScope}
        setDashboardScope={setDashboardScope}
        monthOptions={monthOptions}
        onReset={() => {
          setRecordFilters(DEFAULT_RECORD_FILTERS);
          setRecordsPage(0);
        }}
        onClose={() => setRecordFilterSheetOpen(false)}
      />

      <ManualDaySheet
        state={manualSheet}
        snapshot={snapshot}
        onCancel={closeManualSheet}
        onChangeDate={setManualDate}
        onUpdateTrade={handleManualTradeUpdate}
        onRemoveTrade={handleManualRemove}
        onMoveTrade={handleManualMove}
        onDuplicateTrade={handleManualDuplicate}
        onReverseTrade={handleManualReverse}
        onAddTrade={handleManualAdd}
        onDeleteDay={handleDeleteDay}
        onSave={handleManualSave}
      />

      <ConfirmSheet
        state={confirmState}
        onCancel={() => setConfirmState(createConfirmState())}
        onConfirm={handleDangerConfirm}
      />

      <CsvImportPreviewSheet
        state={csvPreviewState}
        firebaseSignedIn={snapshot.firebase.isSignedIn}
        onCancel={closeCsvPreview}
        onConfirm={confirmCsvImport}
      />

      <Toast toast={toast} />
    </>
  );
}
