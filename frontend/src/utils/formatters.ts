export function formatIdr(amount: number): string {
  const rounded = Math.round(amount || 0);
  return 'Rp ' + rounded.toLocaleString('id-ID');
}

export function formatSignedIdr(amount: number): string {
  const rounded = Math.round(amount || 0);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}Rp ${Math.abs(rounded).toLocaleString('id-ID')}`;
}

export function formatUsdt(amount: number): string {
  return (
    '$' +
    (amount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function calculateLivePositionAccounting(
  pos: {
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    positionSize: number;
    marginIdr: number;
    entryFeeIdr: number;
  },
  currentPriceUsdt: number
) {
  if (!currentPriceUsdt || pos.entryPrice <= 0) {
    return { grossPnlIdr: 0, exitFeeIdr: 0, netPnlIdr: 0, roiPercent: 0 };
  }
  const diffRatio =
    pos.side === 'LONG'
      ? (currentPriceUsdt - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - currentPriceUsdt) / pos.entryPrice;

  const grossPnlIdr = Math.round(pos.positionSize * diffRatio);
  const exitFeeIdr = Math.round(pos.positionSize * 0.0005);
  const netPnlIdr = grossPnlIdr - pos.entryFeeIdr - exitFeeIdr;
  const roiPercent = pos.marginIdr > 0 ? (netPnlIdr / pos.marginIdr) * 100 : 0;

  return { grossPnlIdr, exitFeeIdr, netPnlIdr, roiPercent };
}
