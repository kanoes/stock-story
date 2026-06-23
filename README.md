# stock-story

一个面向手机网页的个人交易账本。

现在的版本重点是：

- 本地 `IndexedDB` 存储
- `Firebase Auth + Firestore` 安全合并同步
- CSV 导入与手动录入共用一套交易模型
- 固定使用一套结算口径：
  券商已提供信用平仓净损益时优先使用券商值，否则使用 FIFO lot 计算
- 三份券商 CSV（約定履歴、信用決済明細、特定口座損益明細）可组合导入，用于更清晰地查看每日损益

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 目录

- `src/App.jsx`：React 容器层，只做状态编排
- `src/components/`：页面组件、弹层、通用 UI
- `src/lib/trade/`：交易模型、分析、存储、CSV、云同步
- `companies_tse.json`：按需加载的股票名称数据
- `.github/workflows/deploy.yml`：GitHub Pages 部署
