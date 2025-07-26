const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const CryptoService = require('../services/CryptoService');
const logger = require('../config/logger');

const cryptoService = new CryptoService();

// Get wallet balance
router.get('/balance/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Get current crypto prices for USD equivalent
    const prices = await cryptoService.getPrices(['BTC', 'ETH', 'USDT']);
    
    const walletWithUsd = {};
    for (const [crypto, amount] of Object.entries(player.wallet)) {
      walletWithUsd[crypto] = {
        amount: parseFloat(amount.toFixed(8)),
        usdValue: prices[crypto] ? parseFloat((amount * prices[crypto]).toFixed(2)) : 0
      };
    }

    const totalUsdValue = Object.entries(walletWithUsd)
      .reduce((sum, [crypto, data]) => sum + data.usdValue, 0);

    res.json({
      playerId,
      wallet: walletWithUsd,
      totalUsdValue: parseFloat(totalUsdValue.toFixed(2)),
      prices
    });

  } catch (error) {
    logger.error('Error getting wallet balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add funds to wallet (simulate deposit)
router.post('/deposit', async (req, res) => {
  try {
    const { playerId, amount, cryptocurrency } = req.body;

    if (!playerId || !amount || !cryptocurrency) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    if (!['BTC', 'ETH', 'USDT'].includes(cryptocurrency.toUpperCase())) {
      return res.status(400).json({ error: 'Unsupported cryptocurrency' });
    }

    const player = await Player.findOne({ playerId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Get current price
    const price = await cryptoService.getPrice(cryptocurrency.toUpperCase());
    
    // Add to wallet
    const crypto = cryptocurrency.toUpperCase();
    player.wallet[crypto] = (player.wallet[crypto] || 0) + parseFloat(amount);
    await player.save();

    // Log transaction
    const crypto_module = require('crypto');
    const transaction = new Transaction({
      transactionId: `tx_${Date.now()}_${crypto_module.randomBytes(8).toString('hex')}`,
      playerId,
      roundId: 'deposit',
      type: 'deposit',
      usdAmount: amount * price,
      cryptoAmount: parseFloat(amount),
      cryptocurrency: crypto,
      priceAtTime: price,
      transactionHash: crypto_module.randomBytes(32).toString('hex'),
      balanceAfter: player.wallet
    });

    await transaction.save();

    res.json({
      success: true,
      transaction: {
        transactionId: transaction.transactionId,
        amount: parseFloat(amount),
        cryptocurrency: crypto,
        usdValue: parseFloat((amount * price).toFixed(2)),
        newBalance: player.wallet[crypto]
      }
    });

    logger.info(`Deposit processed: ${playerId} - ${amount} ${crypto}`);

  } catch (error) {
    logger.error('Error processing deposit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get transaction history
router.get('/transactions/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let filter = { playerId };
    if (type && ['bet', 'cashout', 'deposit', 'withdrawal'].includes(type)) {
      filter.type = type;
    }

    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v');

    const total = await Transaction.countDocuments(filter);

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error getting transaction history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get crypto prices
router.get('/prices', async (req, res) => {
  try {
    const prices = await cryptoService.getPrices(['BTC', 'ETH', 'USDT']);
    
    res.json({
      prices,
      timestamp: new Date().toISOString(),
      cacheStats: cryptoService.getCacheStats()
    });

  } catch (error) {
    logger.error('Error getting crypto prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert between currencies
router.post('/convert', async (req, res) => {
  try {
    const { amount, fromCurrency, toCurrency } = req.body;

    if (!amount || !fromCurrency || !toCurrency) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    const supportedCryptos = ['BTC', 'ETH', 'USDT', 'USD'];
    if (!supportedCryptos.includes(fromCurrency.toUpperCase()) || 
        !supportedCryptos.includes(toCurrency.toUpperCase())) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }

    let convertedAmount;
    let fromPrice = 1, toPrice = 1;

    // Get prices if needed
    if (fromCurrency.toUpperCase() !== 'USD') {
      fromPrice = await cryptoService.getPrice(fromCurrency.toUpperCase());
    }
    
    if (toCurrency.toUpperCase() !== 'USD') {
      toPrice = await cryptoService.getPrice(toCurrency.toUpperCase());
    }

    // Convert via USD
    const usdAmount = fromCurrency.toUpperCase() === 'USD' ? amount : amount * fromPrice;
    convertedAmount = toCurrency.toUpperCase() === 'USD' ? usdAmount : usdAmount / toPrice;

    res.json({
      originalAmount: parseFloat(amount),
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
      convertedAmount: parseFloat(convertedAmount.toFixed(8)),
      rates: {
        [fromCurrency.toUpperCase()]: fromPrice,
        [toCurrency.toUpperCase()]: toPrice
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error converting currencies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;