// Helper: Parse CSV text to array of objects
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length !== header.length) continue; // skip malformed
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j];
      let val = row[j].trim();
      if (key === 'date' || key === 'time' || key === 'timestamp') {
        obj.date = new Date(val);
      } else {
        obj[key] = parseFloat(val);
      }
    }
    if (!obj.date) obj.date = new Date(i); // fallback index
    data.push(obj);
  }
  return data;
}

// Helper: Simple Moving Average (SMA)
function calculateSMA(values, period) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

// Helper: Exponential Moving Average (EMA)
function calculateEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = Array(values.length).fill(null);
  let prev;
  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    if (prev === undefined) {
      prev = price; // seed with first value
    } else {
      prev = price * k + prev * (1 - k);
    }
    if (i >= period - 1) ema[i] = prev;
  }
  return ema;
}

// Helper: RSI (Wilder's smoothing)
function calculateRSI(values, period) {
  const rsi = Array(values.length).fill(null);
  let gains = 0;
  let losses = 0;

  // seed initial averages
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses -= change; // losses positive
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) rsi[period] = 100;
  else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - 100 / (1 + rs);
  }

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }
  return rsi;
}

// Helper: MACD
function calculateMACD(values, fastPeriod, slowPeriod, signalPeriod) {
  const emaFast = calculateEMA(values, fastPeriod);
  const emaSlow = calculateEMA(values, slowPeriod);
  const macdLine = values.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return emaFast[i] - emaSlow[i];
  });
  const signalLine = calculateEMA(macdLine.map(v => (v === null ? 0 : v)), signalPeriod);
  return { macdLine, signalLine };
}

// Backtest function
function runBacktest(data, params) {
  const closes = data.map(d => d.close);
  const sma = calculateSMA(closes, params.maPeriod);
  const rsi = calculateRSI(closes, params.rsiPeriod);
  const { macdLine, signalLine } = calculateMACD(
    closes,
    params.macdFast,
    params.macdSlow,
    params.macdSignal
  );

  const trades = [];
  let inTrade = false;
  let entryPrice = 0;
  let entryDate = null;

  for (let i = 1; i < data.length; i++) {
    if (!inTrade) {
      // Entry conditions
      const buySignal =
        closes[i] > sma[i] &&
        macdLine[i - 1] !== null &&
        macdLine[i] !== null &&
        macdLine[i - 1] <= signalLine[i - 1] &&
        macdLine[i] > signalLine[i] &&
        rsi[i] !== null &&
        rsi[i] < params.rsiOverbought;

      if (buySignal) {
        inTrade = true;
        entryPrice = closes[i];
        entryDate = data[i].date;
      }
    } else {
      // Exit condition
      const sellSignal =
        macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i];
      if (sellSignal || i === data.length - 1) {
        const exitPrice = closes[i];
        const exitDate = data[i].date;
        const pnl = exitPrice - entryPrice;
        trades.push({
          entryDate,
          exitDate,
          entryPrice,
          exitPrice,
          pnl,
        });
        inTrade = false;
      }
    }
  }

  // Performance metrics
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.pnl > 0).length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  const profitFactor = grossLoss ? grossProfit / grossLoss : Infinity;

  return { trades, winRate, totalTrades, profitFactor };
}

// DOM Elements
const csvInput = document.getElementById('csvFile');
const runBtn = document.getElementById('runBtn');
const resultsSection = document.getElementById('results');
const summaryDiv = document.getElementById('summary');
const tradesTableBody = document.querySelector('#tradesTable tbody');

let csvData = null; // store parsed data

csvInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    csvData = parseCSV(evt.target.result);
    alert('CSV loaded successfully!');
  };
  reader.readAsText(file);
});

runBtn.addEventListener('click', () => {
  if (!csvData || !csvData.length) {
    alert('Please upload a valid CSV file first.');
    return;
  }

  const params = {
    maPeriod: parseInt(document.getElementById('maPeriod').value, 10),
    rsiPeriod: parseInt(document.getElementById('rsiPeriod').value, 10),
    rsiOverbought: parseFloat(document.getElementById('rsiOverbought').value),
    macdFast: parseInt(document.getElementById('macdFast').value, 10),
    macdSlow: parseInt(document.getElementById('macdSlow').value, 10),
    macdSignal: parseInt(document.getElementById('macdSignal').value, 10),
  };

  const { trades, winRate, totalTrades, profitFactor } = runBacktest(csvData, params);

  // Render summary
  summaryDiv.innerHTML = `
    <p><strong>Total Trades:</strong> ${totalTrades}</p>
    <p><strong>Win Rate:</strong> ${winRate.toFixed(2)}%</p>
    <p><strong>Profit Factor:</strong> ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}</p>
  `;

  // Render trades table
  tradesTableBody.innerHTML = '';
  trades.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${t.entryDate.toISOString().split('T')[0]}</td>
      <td>${t.exitDate.toISOString().split('T')[0]}</td>
      <td>${t.entryPrice.toFixed(2)}</td>
      <td>${t.exitPrice.toFixed(2)}</td>
      <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">${t.pnl.toFixed(2)}</td>
    `;
    tradesTableBody.appendChild(tr);
  });

  resultsSection.classList.remove('hidden');
});