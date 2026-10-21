export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BotConfig {
  pair: string;
  timeframe: string;
  leverage: number;
  marginPercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxPositions: number;
  thresholdScore: number;
}

export interface Position {
  id: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  isBot: boolean;
  entryPrice: number;
  entryPriceIdr: number;
  marginIdr: number;
  leverage: number;
  positionSize: number;
  quantityBtc: number;
  entryFeeIdr: number;
  tpPrice: number;
  slPrice: number;
  liqPrice: number;
  openedAt: string;
  candleTime: number;
}

export interface TradeHistoryItem {
  id: string;
  time: string;
  type: 'Bot Trading' | 'Manual';
  pair: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  marginIdr: number;
  entryPrice: number;
  entryPriceIdr: number;
  closePrice: number;
  closePriceIdr: number;
  pnlIdr: number;
  roiPercent: number;
  status: 'Take Profit' | 'Stop Loss' | 'Liquidated' | 'Manual Close';
}

export interface ScoreBreakdown {
  longScore: number;
  shortScore: number;
  maLong: number;
  maShort: number;
  emaLong: number;
  emaShort: number;
  rsiLong: number;
  rsiShort: number;
  volLong: number;
  volShort: number;
  ma50: number;
  ma200: number;
  ema20: number;
  rsi14: number;
  rvol: number;
  clv: number;
  multiplierTf: number;
  signalSummary: string;
  evaluatedCandle: number;
}

export interface PersistentState {
  idrBalance: number;
  usdtRate: number;
  botRunning: boolean;
  botNetProfitIdr: number;
  botWinCount: number;
  botLossCount: number;
  lastBotTradeCandleTime: number;
  botConfig: BotConfig;
  activePositions: Position[];
  tradeHistory: TradeHistoryItem[];
}

export interface LiveSnapshot {
  currentPriceUsdt: number;
  currentPriceIdr: number;
  priceChange24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  state: PersistentState;
  score: ScoreBreakdown;
  serverTime: string;
}
