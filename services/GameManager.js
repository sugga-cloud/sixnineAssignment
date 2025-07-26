// File: services/GameManager.js

const crypto = require('crypto');
const GameRound = require('../models/GameRound');
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const logger = require('../config/logger');
const CryptoService = require('./CryptoService');

class GameManager {
  constructor(io) {
    this.io = io;
    this.currentRound = null;
    this.multiplierInterval = null;
    this.players = new Map();
    this.cryptoService = new CryptoService();
    this.isGameActive = false;
    this.currentMultiplier = 1;
    this.gameStartTime = null;
    this.isSaving = false; // Prevent parallel save
  }

  start() {
    logger.info('Game Manager starting...');
    // Start the first round manually, next rounds will chain automatically
    this.startNewRound();
  }

  stop() {
    logger.info('Game Manager stopping...');
    if (this.multiplierInterval) clearInterval(this.multiplierInterval);
  }

  async startNewRound() {
    try {
      if (this.currentRound && this.isGameActive) await this.endRound();

      const roundId = this.generateRoundId();
      const seed = this.generateSeed();
      const seedHash = this.hashSeed(seed);
      const crashPoint = this.calculateCrashPoint(seed, roundId);

      this.currentRound = new GameRound({
        roundId,
        startTime: new Date(),
        crashPoint,
        seed,
        seedHash,
        status: 'waiting',
        bets: []
      });

      await this.currentRound.save();

      // Emit new round start with 3 seconds betting window
      this.io.emit('round:new', {
        roundId,
        seedHash,
        bettingEndsIn: 3000
      });

      logger.info(`New round started: ${roundId}, crash point: ${crashPoint}`);

      // Start game phase after betting time (3 seconds)
      setTimeout(() => this.startGamePhase(), 3000);

    } catch (error) {
      logger.error('Error starting new round:', error);
    }
  }

  async startGamePhase() {
    if (!this.currentRound) return;

    this.isGameActive = true;
    this.currentMultiplier = 1;
    this.gameStartTime = Date.now();

    this.currentRound.status = 'active';
    await this.safeSave(this.currentRound);

    // Start multiplier updates every 100ms (or env var)
    this.multiplierInterval = setInterval(() => this.updateMultiplier(), parseInt(process.env.MULTIPLIER_UPDATE_INTERVAL) || 100);

    this.io.emit('round:started', { roundId: this.currentRound.roundId });
    logger.info(`Game phase started for round: ${this.currentRound.roundId}`);
  }

  updateMultiplier() {
    if (!this.isGameActive || !this.currentRound) return;

    const timeElapsed = (Date.now() - this.gameStartTime) / 1000;
    const growthFactor = 0.1;
    this.currentMultiplier = 1 + (timeElapsed * growthFactor);

    this.currentRound.maxMultiplier = Math.max(this.currentRound.maxMultiplier || 1, this.currentMultiplier);

    if (this.currentMultiplier >= this.currentRound.crashPoint) {
      this.crashGame();
      return;
    }

    this.io.emit('multiplier:update', {
      roundId: this.currentRound.roundId,
      multiplier: parseFloat(this.currentMultiplier.toFixed(2))
    });
  }

  async crashGame() {
    if (!this.isGameActive || !this.currentRound) return;

    this.isGameActive = false;
    if (this.multiplierInterval) clearInterval(this.multiplierInterval);

    await this.endRound();

    this.io.emit('round:crashed', {
      roundId: this.currentRound.roundId,
      crashPoint: this.currentRound.crashPoint,
      finalMultiplier: this.currentMultiplier
    });

    logger.info(`Game crashed at ${this.currentRound.crashPoint}x for round: ${this.currentRound.roundId}`);

    // Schedule next round after 3 seconds delay
    setTimeout(() => {
      this.startNewRound();
    }, 3000);
  }

  async endRound() {
    if (!this.currentRound || this.currentRound.status === 'crashed') return;

    this.currentRound.endTime = new Date();
    this.currentRound.status = 'crashed';

    for (const bet of this.currentRound.bets) {
      if (!bet.cashedOut) {
        await this.updatePlayerStats(bet.playerId, false, bet.usdAmount);
      }
    }

    await this.safeSave(this.currentRound);

    // Removed inconsistent emit of multiplier:update here to avoid confusion
    // Clients will get the crash info via 'round:crashed' event instead

    logger.info(`Round ended: ${this.currentRound.roundId}`);
  }

  async placeBet(playerId, usdAmount, cryptocurrency) {
    try {
      if (!this.currentRound || this.currentRound.status !== 'waiting') {
        throw new Error('Betting not allowed now');
      }

      const price = await this.cryptoService.getPrice(cryptocurrency);
      const cryptoAmount = usdAmount / price;

      const player = await Player.findOne({ playerId });
      if (!player || player.wallet[cryptocurrency] < cryptoAmount) throw new Error('Insufficient balance');

      const bet = {
        playerId,
        usdAmount,
        cryptoAmount,
        cryptocurrency,
        priceAtTime: price,
        transactionHash: this.generateTransactionHash()
      };

      player.wallet[cryptocurrency] -= cryptoAmount;
      await player.save();

      this.currentRound.bets.push(bet);
      await this.safeSave(this.currentRound);

      await this.logTransaction({
        playerId,
        roundId: this.currentRound.roundId,
        type: 'bet',
        usdAmount,
        cryptoAmount,
        cryptocurrency,
        priceAtTime: price,
        transactionHash: bet.transactionHash,
        balanceAfter: player.wallet
      });

      this.io.emit('bet:placed', { roundId: this.currentRound.roundId, playerId, usdAmount, cryptocurrency });
      return bet;

    } catch (error) {
      logger.error('Error placing bet:', error);
      throw error;
    }
  }

  async cashOut(playerId) {
    try {
      if (!this.isGameActive || !this.currentRound) throw new Error('Cannot cash out');

      const bet = this.currentRound.bets.find(b => b.playerId === playerId && !b.cashedOut);
      if (!bet) throw new Error('No active bet');

      const multiplier = this.currentMultiplier;
      const cryptoPayout = bet.cryptoAmount * multiplier;
      const usdPayout = cryptoPayout * bet.priceAtTime;

      bet.cashedOut = true;
      bet.cashoutMultiplier = multiplier;
      bet.payout = { cryptoAmount: cryptoPayout, usdAmount: usdPayout };

      const player = await Player.findOne({ playerId });
      player.wallet[bet.cryptocurrency] += cryptoPayout;
      await player.save();

      await this.safeSave(this.currentRound);

      await this.logTransaction({
        playerId,
        roundId: this.currentRound.roundId,
        type: 'cashout',
        usdAmount: usdPayout,
        cryptoAmount: cryptoPayout,
        cryptocurrency: bet.cryptocurrency,
        priceAtTime: bet.priceAtTime,
        transactionHash: this.generateTransactionHash(),
        multiplier,
        balanceAfter: player.wallet
      });

      await this.updatePlayerStats(playerId, true, usdPayout - bet.usdAmount);

      this.io.emit('player:cashedout', {
        roundId: this.currentRound.roundId,
        playerId,
        multiplier: parseFloat(multiplier.toFixed(2)),
        payout: {
          crypto: parseFloat(cryptoPayout.toFixed(8)),
          usd: parseFloat(usdPayout.toFixed(2))
        },
        cryptocurrency: bet.cryptocurrency
      });

      return { multiplier, payout: bet.payout };

    } catch (error) {
      logger.error('Error cashing out:', error);
      throw error;
    }
  }

  async updatePlayerStats(playerId, won, amount) {
    try {
      const player = await Player.findOne({ playerId });
      if (player) {
        player.totalGamesPlayed += 1;
        if (won) player.totalWon += amount;
        else player.totalLost += amount;
        await player.save();
      }
    } catch (err) {
      logger.error('Error updating stats:', err);
    }
  }

  async logTransaction(data) {
    try {
      const transaction = new Transaction({
        transactionId: this.generateTransactionId(),
        ...data
      });
      await transaction.save();
    } catch (err) {
      logger.error('Transaction log error:', err);
    }
  }

  async safeSave(document) {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      await document.save();
    } catch (err) {
      logger.error('Safe save error:', err);
    } finally {
      this.isSaving = false;
    }
  }

  calculateCrashPoint(seed, roundId) {
    const hash = crypto.createHmac('sha256', process.env.PROVABLY_FAIR_SECRET || 'secret')
      .update(seed + roundId).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const uniform = hashNum / 0xFFFFFFFF;
    const maxCrash = parseFloat(process.env.MAX_CRASH_MULTIPLIER) || 120;
    const minCrash = parseFloat(process.env.MIN_CRASH_MULTIPLIER) || 1.01;
    const crash = minCrash + (Math.log(1 - uniform) / -0.1);
    return Math.min(Math.max(crash, minCrash), maxCrash);
  }

  generateRoundId() {
    return `round_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  generateSeed() {
    return crypto.randomBytes(32).toString('hex');
  }

  hashSeed(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex');
  }

  generateTransactionHash() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateTransactionId() {
    return `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  getGameState() {
    return {
      currentRound: this.currentRound ? {
        roundId: this.currentRound.roundId,
        status: this.currentRound.status,
        seedHash: this.currentRound.seedHash
      } : null,
      isGameActive: this.isGameActive,
      currentMultiplier: parseFloat(this.currentMultiplier.toFixed(2))
    };
  }
}

module.exports = GameManager;
