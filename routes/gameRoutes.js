const express = require('express');
const router = express.Router();
const GameRound = require('../models/GameRound');
const Transaction = require('../models/Transaction');
const logger = require('../config/logger');

// Get current game state (REST endpoint)
router.get('/state', async (req, res) => {
  try {
    // This would be handled by the GameManager instance
    // For now, return basic info
    const currentRound = await GameRound.findOne({ status: { $in: ['waiting', 'active'] } })
      .sort({ createdAt: -1 });

    res.json({
      currentRound: currentRound ? {
        roundId: currentRound.roundId,
        status: currentRound.status,
        seedHash: currentRound.seedHash,
        startTime: currentRound.startTime
      } : null,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting game state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get game history
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const rounds = await GameRound.find({ status: 'crashed' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('roundId crashPoint startTime endTime maxMultiplier');

    const total = await GameRound.countDocuments({ status: 'crashed' });

    res.json({
      rounds,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Error getting game history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get round details
router.get('/round/:roundId', async (req, res) => {
  try {
    const { roundId } = req.params;

    const round = await GameRound.findOne({ roundId });
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }

    // Don't expose the seed until the round is complete
    const responseData = {
      roundId: round.roundId,
      startTime: round.startTime,
      endTime: round.endTime,
      crashPoint: round.crashPoint,
      seedHash: round.seedHash,
      status: round.status,
      maxMultiplier: round.maxMultiplier,
      totalBets: round.bets.length,
      totalBetAmount: round.bets.reduce((sum, bet) => sum + bet.usdAmount, 0)
    };

    // Only include seed if round is completed (for verification)
    if (round.status === 'crashed') {
      responseData.seed = round.seed;
    }

    res.json(responseData);
  } catch (error) {
    logger.error('Error getting round details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify crash point (provably fair verification)
router.post('/verify', async (req, res) => {
  try {
    const { roundId, seed, expectedCrashPoint } = req.body;

    if (!roundId || !seed || !expectedCrashPoint) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const round = await GameRound.findOne({ roundId });
    if (!round) {
      return res.status(404).json({ error: 'Round not found' });
    }

    if (round.status !== 'crashed') {
      return res.status(400).json({ error: 'Round not completed yet' });
    }

    // Verify the seed matches
    const crypto = require('crypto');
    const computedHash = crypto.createHash('sha256').update(seed).digest('hex');
    
    if (computedHash !== round.seedHash) {
      return res.status(400).json({ error: 'Invalid seed' });
    }

    // Recalculate crash point
    const hash = crypto.createHmac('sha256', process.env.PROVABLY_FAIR_SECRET || 'default-secret')
      .update(seed + roundId)
      .digest('hex');
    
    const hashNumber = parseInt(hash.substring(0, 8), 16);
    const maxCrash = parseFloat(process.env.MAX_CRASH_MULTIPLIER) || 120;
    const minCrash = parseFloat(process.env.MIN_CRASH_MULTIPLIER) || 1.01;
    
    const uniform = hashNumber / 0xFFFFFFFF;
    const calculatedCrashPoint = minCrash + (Math.log(1 - uniform) / -0.1);
    const finalCrashPoint = Math.min(Math.max(calculatedCrashPoint, minCrash), maxCrash);

    const isValid = Math.abs(finalCrashPoint - round.crashPoint) < 0.01;

    res.json({
      valid: isValid,
      providedCrashPoint: expectedCrashPoint,
      actualCrashPoint: round.crashPoint,
      calculatedCrashPoint: parseFloat(finalCrashPoint.toFixed(2)),
      seedHash: round.seedHash,
      seed: round.seed
    });

  } catch (error) {
    logger.error('Error verifying crash point:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { period = 'all', limit = 10 } = req.query;
    
    let matchCondition = {};
    
    if (period === 'daily') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      matchCondition.createdAt = { $gte: today };
    } else if (period === 'weekly') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      matchCondition.createdAt = { $gte: weekAgo };
    }

    const leaderboard = await Transaction.aggregate([
      { $match: { type: 'cashout', ...matchCondition } },
      {
        $group: {
          _id: '$playerId',
          totalWinnings: { $sum: '$usdAmount' },
          totalGames: { $sum: 1 },
          biggestWin: { $max: { usd: '$usdAmount', multiplier: '$multiplier' } }
        }
      },
      { $sort: { totalWinnings: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      period,
      leaderboard
    });

  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;