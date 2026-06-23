import {
  formatDateParts,
  formatMoney,
  formatPercent,
  getScopeLabel
} from '../lib/trade/index.js';
import {
  getHoldingCostMeta,
  getTradeActionLabel,
  getTradeBadgeTone,
  getTradeProfitSourceLabel,
  getTradeProfitSourceTone,
  getTradeSourceLabel,
  getValueTone
} from '../lib/view-models.js';
import {
  AppTopBar,
  CollapsibleSection,
  DeferredChart,
  EmptyState,
  ScopeToggle,
  StatCard,
  StatusBadge
} from './common.jsx';

function RecordDayCard({ day, scope, compact, onOpen }) {
  const scopeDay = day.scopes[scope];
  const cashDay = day.scopes.cash;
  const marginDay = day.scopes.margin;
  const symbols = Array.from(scopeDay.symbols || []).filter(Boolean).slice(0, compact ? 3 : 6);
  const dateParts = formatDateParts(day.date);
  const tone = getValueTone(scopeDay.profit);
  const showDailySplit = scope === 'all';

  return (
    <button type="button" className="record-card" onClick={() => onOpen(day)}>
      <div className="record-card-head">
        <div>
          <strong>{dateParts.fullLabel}</strong>
          <span>{scopeDay.tradeCount} 笔 · {symbols.join(' / ') || '无代码'}</span>
        </div>
        <div className={`record-profit ${tone}`}>{formatMoney(scopeDay.profit)}</div>
      </div>
      <div className="record-card-meta">
        {showDailySplit ? (
          <>
            <span className={getValueTone(cashDay.profit)}>现物 {formatMoney(cashDay.profit)}</span>
            <span className={getValueTone(marginDay.profit)}>信用 {formatMoney(marginDay.profit)}</span>
          </>
        ) : (
          <span>买 {scopeDay.buyCount} / 卖 {scopeDay.sellCount}</span>
        )}
        <span>平仓 {scopeDay.closeTradeCount}</span>
        <span>成本 {formatMoney(scopeDay.holdingCost, { signed: false })}</span>
      </div>
    </button>
  );
}

function PositionCard({ item }) {
  return (
    <article className="list-card">
      <div className="list-card-head">
        <div>
          <strong>{item.name || item.symbol}</strong>
          <span>{item.symbol}</span>
        </div>
        <StatusBadge tone={item.assetType === 'margin' ? 'margin' : 'cash'}>
          {item.positionSide === 'short' ? '空头' : getScopeLabel(item.assetType)}
        </StatusBadge>
      </div>
      <div className="list-card-grid">
        <div>
          <span>数量</span>
          <strong>{Number(item.quantity) || 0} 股</strong>
        </div>
        <div>
          <span>均价</span>
          <strong>{formatMoney(item.avgPrice, { signed: false })}</strong>
        </div>
      </div>
    </article>
  );
}

function RankingCard({ item }) {
  const tone = getValueTone(item.profit);

  return (
    <article className="list-card">
      <div className="list-card-head">
        <div>
          <strong>{item.name || item.symbol}</strong>
          <span>{item.symbol}</span>
        </div>
        <strong className={tone}>{formatMoney(item.profit)}</strong>
      </div>
      <div className="list-card-meta">
        <span>{item.tradeCount} 笔</span>
        <span>买 {item.buyCount}</span>
        <span>卖 {item.sellCount}</span>
      </div>
    </article>
  );
}

export function HomeTab({
  dashboardScope,
  setDashboardScope,
  dashboardSummary,
  dashboardDiagnostics,
  currentMonthProfit,
  latestDay,
  chartRange,
  setChartRange,
  chartType,
  setChartType,
  chartData,
  onAddRecord,
  onImportCsv,
  onOpenSync,
  recentDays,
  onOpenDay
}) {
  return (
    <div className="page">
      <AppTopBar
        title="交易账本"
        actions={(
          <>
            <ScopeToggle value={dashboardScope} onChange={setDashboardScope} />
            <div className="toolbar-row">
              <button type="button" className="primary-btn" onClick={onAddRecord}>新增记录</button>
              <details className="more-actions">
                <summary className="ghost-btn">更多操作</summary>
                <div className="more-action-menu">
                  <button type="button" className="ghost-btn" onClick={onImportCsv}>重建导入 CSV</button>
                  <button type="button" className="ghost-btn" onClick={onOpenSync}>同步</button>
                </div>
              </details>
            </div>
            <span className="action-note">CSV 会替换本地交易，登录时覆盖云端。</span>
          </>
        )}
      />

      <section className="hero-grid">
        <StatCard label="累计收益" value={formatMoney(dashboardSummary.totalProfit)} tone={getValueTone(dashboardSummary.totalProfit)} emphasis />
        <StatCard label="本周" value={formatMoney(dashboardSummary.week.profit)} tone={getValueTone(dashboardSummary.week.profit)} />
        <StatCard label="本月" value={formatMoney(currentMonthProfit)} tone={getValueTone(currentMonthProfit)} />
        <StatCard label="交易笔数" value={String(dashboardSummary.tradeCount)} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>收益曲线</h2>
          <div className="toolbar-row compact">
            <div className="inline-options">
              {[
                ['week', '7 天'],
                ['month', '30 天'],
                ['all', '全部']
              ].map(([value, label]) => (
                <button key={value} type="button" className={`filter-chip ${chartRange === value ? 'active' : ''}`} onClick={() => setChartRange(value)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-options">
              {[
                ['cumulative', '累计'],
                ['daily', '单日']
              ].map(([value, label]) => (
                <button key={value} type="button" className={`filter-chip ${chartType === value ? 'active' : ''}`} onClick={() => setChartType(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="chart-box">
          <DeferredChart
            kind="line"
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: {
                  grid: { display: false }
                },
                y: {
                  ticks: {
                    callback: (value) => `¥${value}`
                  }
                }
              }
            }}
          />
        </div>
      </section>

      <CollapsibleSection title="更多概览">
        <div className="hero-grid">
          <StatCard label="胜率" value={formatPercent(dashboardSummary.winRate)} />
          <StatCard label="收盘笔数" value={String(dashboardDiagnostics.closeTradeCount)} />
          <StatCard label="平均单笔" value={formatMoney(dashboardDiagnostics.avgPerClose)} tone={getValueTone(dashboardDiagnostics.avgPerClose)} />
          <StatCard label="最大回撤" value={formatMoney(-dashboardDiagnostics.maxDrawdown)} tone={dashboardDiagnostics.maxDrawdown > 0 ? 'negative' : 'neutral'} />
        </div>
      </CollapsibleSection>

      <section className="card">
        <div className="card-head">
          <h2>最近交易日</h2>
          {latestDay ? <StatusBadge tone={getValueTone(latestDay.scopes[dashboardScope].profit)}>{formatMoney(latestDay.scopes[dashboardScope].profit)}</StatusBadge> : null}
        </div>
        <div className="stack-list">
          {recentDays.length ? recentDays.map((day) => (
            <RecordDayCard key={day.id} day={day} scope={dashboardScope} compact onOpen={onOpenDay} />
          )) : (
            <EmptyState title="还没有交易记录" />
          )}
        </div>
      </section>
    </div>
  );
}

export function RecordsTab({
  dashboardScope,
  setDashboardScope,
  recordFilterBadges,
  filteredRecordSummary,
  visibleRecordDays,
  totalRecordPages,
  safeRecordsPage,
  setRecordsPage,
  onOpenFilters,
  onOpenDay
}) {
  return (
    <div className="page">
      <AppTopBar
        title="记录"
        actions={(
          <>
            <ScopeToggle value={dashboardScope} onChange={setDashboardScope} />
            <div className="toolbar-row">
              <button type="button" className="ghost-btn" onClick={onOpenFilters}>筛选</button>
            </div>
          </>
        )}
      />

      <section className="hero-grid">
        <StatCard label="筛选收益" value={formatMoney(filteredRecordSummary.totalProfit)} tone={getValueTone(filteredRecordSummary.totalProfit)} />
        <StatCard label="交易日" value={String(filteredRecordSummary.winDays + filteredRecordSummary.lossDays)} />
        <StatCard label="交易笔数" value={String(filteredRecordSummary.tradeCount)} />
        <StatCard label="平仓笔数" value={String(filteredRecordSummary.closeTradeCount)} />
      </section>

      {recordFilterBadges.length ? (
        <div className="badge-row wrap">
          {recordFilterBadges.map((badge) => (
            <StatusBadge key={`${badge.tone}-${badge.label}`} tone={badge.tone}>{badge.label}</StatusBadge>
          ))}
        </div>
      ) : null}

      <section className="card">
        <div className="stack-list">
          {visibleRecordDays.length ? visibleRecordDays.map((day) => (
            <RecordDayCard key={day.id} day={day} scope={dashboardScope} onOpen={onOpenDay} />
          )) : (
            <EmptyState title="没有符合条件的记录" />
          )}
        </div>
      </section>

      {totalRecordPages > 1 ? (
        <div className="pagination-row">
          <button type="button" className="ghost-btn" disabled={safeRecordsPage === 0} onClick={() => setRecordsPage((current) => Math.max(0, current - 1))}>
            上一页
          </button>
          <span>{safeRecordsPage + 1} / {totalRecordPages}</span>
          <button type="button" className="ghost-btn" disabled={safeRecordsPage >= totalRecordPages - 1} onClick={() => setRecordsPage((current) => Math.min(totalRecordPages - 1, current + 1))}>
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AnalysisTab({
  analysisScope,
  setAnalysisScope,
  analysisSummary,
  analysisDiagnostics,
  analysisExtremes,
  monthlyHighlights,
  bestStock,
  worstStock,
  monthlyChartData,
  healthReport,
  visiblePositions,
  visibleRanking,
  showAllPositions,
  setShowAllPositions,
  showAllRanking,
  setShowAllRanking,
  isCompactScreen
}) {
  const holdingCostMeta = getHoldingCostMeta(analysisSummary);

  return (
    <div className="page">
      <AppTopBar
        title="分析"
        actions={<ScopeToggle value={analysisScope} onChange={setAnalysisScope} />}
      />

      <section className="hero-grid">
        <StatCard label="累计收益" value={formatMoney(analysisSummary.totalProfit)} tone={getValueTone(analysisSummary.totalProfit)} emphasis />
        <StatCard label="胜率" value={formatPercent(analysisSummary.winRate)} />
        <StatCard label={holdingCostMeta.label} value={formatMoney(holdingCostMeta.value, { signed: false })} />
        <StatCard label="持仓数量" value={String(analysisSummary.positionsCount)} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>月度收益</h2>
          {monthlyHighlights.best ? <StatusBadge tone={getValueTone(monthlyHighlights.best.profit)}>{monthlyHighlights.best.month}</StatusBadge> : null}
        </div>
        <div className="chart-box chart-box-small">
          <DeferredChart
            kind="bar"
            data={monthlyChartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              }
            }}
          />
        </div>
      </section>

      <CollapsibleSection title="诊断">
        <div className="hero-grid">
          <StatCard label="平均单笔" value={formatMoney(analysisDiagnostics.avgPerClose)} tone={getValueTone(analysisDiagnostics.avgPerClose)} />
          <StatCard label="Profit Factor" value={analysisDiagnostics.profitFactor ? analysisDiagnostics.profitFactor.toFixed(2) : '0.00'} />
          <StatCard label="最大回撤" value={formatMoney(-analysisDiagnostics.maxDrawdown)} tone={analysisDiagnostics.maxDrawdown > 0 ? 'negative' : 'neutral'} />
          <StatCard label="最大连赢" value={String(analysisDiagnostics.maxWinStreak)} />
        </div>
        <div className="stack-list compact-gap">
          {analysisExtremes.best ? (
            <article className="list-card">
              <div className="list-card-head">
                <strong>最佳交易日</strong>
                <strong className="positive">{formatMoney(analysisExtremes.best.scopes[analysisScope].profit)}</strong>
              </div>
              <span>{formatDateParts(analysisExtremes.best.date).fullLabel}</span>
            </article>
          ) : null}
          {analysisExtremes.worst ? (
            <article className="list-card">
              <div className="list-card-head">
                <strong>最差交易日</strong>
                <strong className="negative">{formatMoney(analysisExtremes.worst.scopes[analysisScope].profit)}</strong>
              </div>
              <span>{formatDateParts(analysisExtremes.worst.date).fullLabel}</span>
            </article>
          ) : null}
          {bestStock ? (
            <article className="list-card">
              <div className="list-card-head">
                <strong>最佳标的</strong>
                <strong className={getValueTone(bestStock.profit)}>{formatMoney(bestStock.profit)}</strong>
              </div>
              <span>{bestStock.name}</span>
            </article>
          ) : null}
          {worstStock ? (
            <article className="list-card">
              <div className="list-card-head">
                <strong>最差标的</strong>
                <strong className={getValueTone(worstStock.profit)}>{formatMoney(worstStock.profit)}</strong>
              </div>
              <span>{worstStock.name}</span>
            </article>
          ) : null}
        </div>
      </CollapsibleSection>

      <section className="card">
        <div className="card-head">
          <h2>持仓</h2>
          <StatusBadge tone="neutral">{analysisSummary.positionsCount}</StatusBadge>
        </div>
        <div className="stack-list">
          {visiblePositions.length ? visiblePositions.map((item) => (
            <PositionCard key={`${item.assetType}-${item.positionSide}-${item.symbol}`} item={item} />
          )) : (
            <EmptyState title="当前没有持仓" />
          )}
        </div>
        {isCompactScreen && analysisSummary.positions.length > visiblePositions.length ? (
          <button type="button" className="ghost-btn wide-btn" onClick={() => setShowAllPositions((current) => !current)}>
            {showAllPositions ? '收起' : '展开全部'}
          </button>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>盈亏排行</h2>
          <StatusBadge tone="neutral">{analysisSummary.ranking.length}</StatusBadge>
        </div>
        <div className="stack-list">
          {visibleRanking.length ? visibleRanking.map((item) => (
            <RankingCard key={item.symbol} item={item} />
          )) : (
            <EmptyState title="还没有可统计的平仓记录" />
          )}
        </div>
        {isCompactScreen && analysisSummary.ranking.length > visibleRanking.length ? (
          <button type="button" className="ghost-btn wide-btn" onClick={() => setShowAllRanking((current) => !current)}>
            {showAllRanking ? '收起' : '展开更多'}
          </button>
        ) : null}
      </section>

      {(healthReport.duplicateCount || healthReport.orphanCloseCount) ? (
        <CollapsibleSection title="数据提醒">
          <div className="hero-grid">
            <StatCard label="重复记录" value={String(healthReport.duplicateCount)} />
            <StatCard label="未匹配平仓" value={String(healthReport.orphanCloseCount)} />
          </div>
          <div className="stack-list compact-gap">
            {healthReport.duplicateExamples.map((item, index) => (
              <article className="list-card" key={`dup-${item.date}-${item.symbol}-${item.tradeTypeLabel}-${index}`}>
                <div className="list-card-head">
                  <strong>重复样例</strong>
                  <StatusBadge tone="warning">{item.date}</StatusBadge>
                </div>
                <div className="list-card-meta">
                  <span>{item.symbol || item.name || '无代码'} · {item.tradeTypeLabel}</span>
                  <span>这类重复会把收益和交易笔数重复累加。</span>
                </div>
              </article>
            ))}
            {healthReport.orphanExamples.map((item, index) => (
              <article className="list-card" key={`orphan-${item.date}-${item.symbol}-${item.tradeTypeLabel}-${index}`}>
                <div className="list-card-head">
                  <strong>未匹配平仓样例</strong>
                  <StatusBadge tone="danger">{item.date}</StatusBadge>
                </div>
                <div className="list-card-meta">
                  <span>{item.symbol || item.name || '无代码'} · {item.tradeTypeLabel}</span>
                  <span>缺少约 {Number(item.missingQuantity) || 0} 股的对应开仓。</span>
                </div>
              </article>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

export function SettingsTab({
  snapshot,
  currentAccountLabel,
  configPreview,
  firebaseDraft,
  setFirebaseDraft,
  onSaveConfig,
  onLogin,
  onLogout,
  onSync,
  onOpenLocalClear,
  onOpenCloudClear,
  onAddRecord,
  onImportCsv
}) {
  const importSummary = snapshot.settings.lastCsvImportSummary || null;
  const marginImport = importSummary?.marginSettlements || null;
  const taxTotal = (importSummary?.taxDetails || []).reduce((sum, item) => sum + (Number(item.totalTax) || 0), 0);

  return (
    <div className="page">
      <AppTopBar
        title="设置"
        trailing={<StatusBadge tone={snapshot.firebase.isSignedIn ? 'success' : 'warning'}>{snapshot.firebase.isSignedIn ? '已连接' : '未连接'}</StatusBadge>}
      />

      <section className="card">
        <div className="card-head">
          <h2>数据</h2>
        </div>
        <div className="toolbar-row">
          <button type="button" className="primary-btn" onClick={onAddRecord}>新增记录</button>
          <button type="button" className="ghost-btn" onClick={onImportCsv}>重建导入 CSV</button>
        </div>
        <div className="inline-note">重建导入会替换本机全部交易；已登录时会同步覆盖云端。</div>
        <div className="hero-grid compact-grid">
          <StatCard label="最近导入" value={snapshot.settings.lastCsvImportAt ? formatDateParts(snapshot.settings.lastCsvImportAt).label : '无'} />
          <StatCard label="版本" value={`v${snapshot.version}`} />
          <StatCard label="导入交易" value={importSummary ? String(importSummary.importedRows || 0) : '0'} />
          <StatCard label="信用补充" value={marginImport ? `${importSummary.matchedMarginSettlementRows || 0}/${marginImport.importedRows || 0}` : '0/0'} />
          <StatCard label="税额对账" value={taxTotal ? formatMoney(-taxTotal) : '无'} tone={taxTotal ? 'negative' : 'neutral'} />
          <StatCard label="现物明细" value={importSummary?.taxDetailRows ? `${importSummary.matchedTaxDetailRows || 0}/${importSummary.taxDetailRows}` : '0/0'} />
          <StatCard label="投信导入" value={importSummary?.importedInvestmentTrustRows ? String(importSummary.importedInvestmentTrustRows) : '0'} />
          <StatCard label="現引转换" value={importSummary?.importedConversionRows ? String(importSummary.importedConversionRows) : '0'} />
          <StatCard label="CSV 文件" value={importSummary?.fileCount ? String(importSummary.fileCount) : '0'} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>云同步</h2>
          <StatusBadge tone={snapshot.firebase.isSignedIn ? 'success' : 'neutral'}>{currentAccountLabel}</StatusBadge>
        </div>
        <div className="sync-block">
          <strong>{snapshot.firebase.authStatusText}</strong>
          <span>{snapshot.firebase.syncStatusText}</span>
        </div>
        <div className="toolbar-row">
          <button type="button" className="primary-btn" onClick={onLogin}>
            {snapshot.firebase.isSignedIn ? '切换账号' : 'Google 登录'}
          </button>
          <button type="button" className="ghost-btn" disabled={!snapshot.firebase.isSignedIn} onClick={onLogout}>退出</button>
          <button type="button" className="ghost-btn" disabled={!snapshot.firebase.isSignedIn || snapshot.firebase.isSyncing} onClick={onSync}>立即同步</button>
        </div>
      </section>

      <CollapsibleSection title="Firebase 配置">
        <div className="stack-list compact-gap">
          <div className="hero-grid compact-grid">
            <StatCard label="Project" value={configPreview?.projectId || '未配置'} />
            <StatCard label="Domain" value={configPreview?.authDomain || '未配置'} />
          </div>
          <label className="field-group">
            <span className="form-label">Web 配置</span>
            <textarea
              className="form-input"
              rows="8"
              value={firebaseDraft}
              onChange={(event) => setFirebaseDraft(event.target.value)}
            />
          </label>
          <button type="button" className="ghost-btn" onClick={onSaveConfig}>保存配置</button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="清理数据">
        <div className="toolbar-row">
          <button type="button" className="danger-btn" onClick={onOpenLocalClear}>清空本地</button>
          <button type="button" className="danger-btn" disabled={!snapshot.firebase.isSignedIn} onClick={onOpenCloudClear}>清空云端</button>
        </div>
      </CollapsibleSection>
    </div>
  );
}
