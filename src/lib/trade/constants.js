export const APP_VERSION = '5.0.0';

export const SETTINGS_KEY = 'trade_diary_settings_v5';
export const CLOUD_SYNC_META_KEY = 'trade_diary_cloud_last_sync_v2';
export const FIREBASE_CONFIG_KEY = 'trade_diary_firebase_config_v2';
export const POST_LOGIN_SYNC_KEY = 'trade_diary_post_login_sync_v1';

export const DB_NAME = 'tradediary_db_local_v41';
export const DB_VERSION = 1;
export const STORE_NAME = 'days';

export const DIVIDEND_START_DATE = '2026-04-01';
export const RECORDS_PAGE_SIZE = 8;
export const MARGIN_INTEREST_RATE = 0.028;
export const DAYS_IN_YEAR = 365;

export const TAB_ITEMS = [
  { id: 'home', label: '总览', icon: 'home' },
  { id: 'records', label: '记录', icon: 'list' },
  { id: 'analysis', label: '分析', icon: 'bars' },
  { id: 'dividend', label: '分红', icon: 'gift' },
  { id: 'settings', label: '设置', icon: 'gear' }
];

export const SCOPES = ['all', 'cash', 'margin'];

export const MANUAL_TYPE_MAP = {
  spot_buy: {
    assetType: 'cash',
    action: 'buy',
    positionEffect: 'open',
    positionSide: 'long',
    tradeTypeLabel: '株式現物買',
    label: '株式現物買'
  },
  spot_sell: {
    assetType: 'cash',
    action: 'sell',
    positionEffect: 'close',
    positionSide: 'long',
    tradeTypeLabel: '株式現物売',
    label: '株式現物売'
  },
  fund_buy: {
    assetType: 'cash',
    action: 'buy',
    positionEffect: 'open',
    positionSide: 'long',
    tradeTypeLabel: '投信金額買付',
    label: '投信買付'
  },
  fund_sell: {
    assetType: 'cash',
    action: 'sell',
    positionEffect: 'close',
    positionSide: 'long',
    tradeTypeLabel: '投信金額解約',
    label: '投信解約'
  },
  margin_open_long: {
    assetType: 'margin',
    action: 'buy',
    positionEffect: 'open',
    positionSide: 'long',
    tradeTypeLabel: '信用新規買',
    label: '信用新規買'
  },
  margin_close_long: {
    assetType: 'margin',
    action: 'sell',
    positionEffect: 'close',
    positionSide: 'long',
    tradeTypeLabel: '信用返済売',
    label: '信用返済売'
  },
  margin_open_short: {
    assetType: 'margin',
    action: 'sell',
    positionEffect: 'open',
    positionSide: 'short',
    tradeTypeLabel: '信用新規売',
    label: '信用新規売'
  },
  margin_close_short: {
    assetType: 'margin',
    action: 'buy',
    positionEffect: 'close',
    positionSide: 'short',
    tradeTypeLabel: '信用返済買',
    label: '信用返済買'
  }
};
