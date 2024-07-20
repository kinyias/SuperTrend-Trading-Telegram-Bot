import ccxt from 'ccxt';
import express from 'express';
import bodyParser from 'body-parser';
import moment from 'moment-timezone';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const telegramToken = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const bot = new Telegraf(telegramToken);

//Init server
const app = express();
app.use(bodyParser.json());

app.get('/', async (req, res) => {
  const symbol = req.query.symbol;
  const timeframe = req.query.timeframe;
  const atrLength = req.query.atrLength;
  const multiplier = req.query.multiplier;
  await fetchAndCalculateSupertrend(symbol, timeframe,atrLength,multiplier);
  res.json({ success: true, message: 'Telegram  Bot' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function fetchOHLCV(symbol, timeframe, limit) {
  const exchange = new ccxt.binance();
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  return ohlcv.map((candle) => ({
    timestamp: candle[0],
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  }));
}

// Function to calculate ATR
function calculateATR(data, length) {
  const highLow = data.map((row) => row.high - row.low);
  const highClose = data.map((row, index) =>
    Math.abs(row.high - (index > 0 ? data[index - 1].close : row.close))
  );
  const lowClose = data.map((row, index) =>
    Math.abs(row.low - (index > 0 ? data[index - 1].close : row.close))
  );

  const tr = highLow.map((hl, index) =>
    Math.max(hl, highClose[index], lowClose[index])
  );

  const atr = tr.map((_, index) => {
    const slice = tr.slice(Math.max(0, index - length + 1), index + 1);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / slice.length;
  });

  return atr;
}

const calculateSupertrend = (df, atrLength, multiplier) => {
  const hl2 = df.map((row) => (row.high + row.low) / 2);
  const atr = calculateATR(df, atrLength);
  const basicUpperBand = hl2.map((hl, index) => hl + multiplier * atr[index]);
  const basicLowerBand = hl2.map((hl, index) => hl - multiplier * atr[index]);
  const upperBand = new Array(df.length).fill(0);
  const lowerBand = new Array(df.length).fill(0);
  const supertrend = new Array(df.length).fill(0);
  const trend = new Array(df.length).fill(0);

  for (let i = 1; i < df.length; i++) {
    upperBand[i] =
      basicUpperBand[i] < upperBand[i - 1] || df[i - 1].close > upperBand[i - 1]
        ? basicUpperBand[i]
        : upperBand[i - 1];
    lowerBand[i] =
      basicLowerBand[i] > lowerBand[i - 1] || df[i - 1].close < lowerBand[i - 1]
        ? basicLowerBand[i]
        : lowerBand[i - 1];

    trend[i] =
      trend[i - 1] === 1
        ? df[i].close > lowerBand[i]
          ? 1
          : -1
        : df[i].close < upperBand[i]
        ? -1
        : 1;
    supertrend[i] = trend[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  const direction = trend.map((value) => (value === 1 ? 'BUY' : 'SELL'));

  // Convert timestamps to Vietnam timezone and format them
  const timestamp = df.map((row) =>
    moment
      .utc(row.timestamp)
      .tz('Asia/Ho_Chi_Minh')
      .format('HH:mm:ss DD/MM/YYYY')
  );

  return df.map((row, index) => ({
    timestamp: timestamp[index],
    close: row.close,
    direction: direction[index],
    supertrend: supertrend[index],
  }));
};

// Function to fetch data and calculate Supertrend
async function fetchAndCalculateSupertrend(symbol, timeframe, atrLength,multiplier) {
  const limit = 100;
  const data = await fetchOHLCV(symbol.toUpperCase(), timeframe, limit);
  const superTrend = calculateSupertrend(data, atrLength, multiplier);
  const nearLasest = superTrend[superTrend.length - 2];
  const latest = superTrend[superTrend.length - 1];
  //To notifi when revert trend
  if (nearLasest.direction != latest.direction) {
    const message = `${
      latest.direction == 'BUY' ? '🟢' : '🔴'
    }#${symbol.replace('/', '')}\nRECOMMENDATION: ${
      latest.direction == 'BUY' ? 'BUY 🟢' : 'SELL 🔴'
    }\nEntry: ${latest.close.toFixed(2)}\nSL: ${latest.supertrend.toFixed(
      2
    )}⛔`;
    await bot.telegram.sendMessage(chatId, message);
  }
  console.log('On Running...');
}
//To get trend now
function getTrendByBot() {
  // Respond to messages with "/now" command
  bot.on('text', async (ctx) => {
    if (ctx.message.text.includes('/now')) {
      const symbol = ctx.message.text.split(' ')[1].toUpperCase();
      if (symbol) {
        const timeframe = '15m';
        const limit = 100;
        const atrLength = 10;
        const multiplier = 3;
        const data = await fetchOHLCV(symbol, timeframe, limit);
        const superTrend = calculateSupertrend(data, atrLength, multiplier);
        const latest = superTrend[superTrend.length - 1];
        const message = `${
          latest.direction == 'BUY' ? '🟢' : '🔴'
        }#${symbol.replace('/', '')}\nRECOMMENDATION: ${
          latest.direction == 'BUY' ? 'BUY 🟢' : 'SELL 🔴'
        }\nEntry: ${latest.close.toFixed(2)}\nSL: ${latest.supertrend.toFixed(
          2
        )}⛔`;
        ctx.reply(message);
      } else {
        ctx.reply('Wrong command!! Exam: /now BTC/USDT');
      }
    }
  });
  // Launch the bot
  bot
    .launch()
    .then(() => {
      console.log('Bot is running...');
    })
    .catch((err) => {
      console.error('Error launching bot:', err);
    });
}

// Call this function to start the bot’s command handling
getTrendByBot();
