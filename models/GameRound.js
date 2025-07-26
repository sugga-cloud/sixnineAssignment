const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  playerId: {
    type: String,
    required: true
  },
  usdAmount: {
    type: Number,
    required: true,
    min: 0.01
  },
  cryptoAmount: {
    type: Number,
    required: true,
    min: 0
  },
  cryptocurrency: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'USDT']
  },
  priceAtTime: {
    type: Number,
    required: true,
    min: 0
  },
  cashedOut: {
    type: Boolean,
    default: false
  },
  cashoutMultiplier: {
    type: Number,
    min: 1
  },
  payout: {
    cryptoAmount: Number,
    usdAmount: Number
  },
  transactionHash: String
});

const gameRoundSchema = new mongoose.Schema({
  roundId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: Date,
  crashPoint: {
    type: Number,
    required: true,
    min: 1
  },
  seed: {
    type: String,
    required: true
  },
  seedHash: {
    type: String,
    required: true
  },
  bets: [betSchema],
  status: {
    type: String,
    enum: ['waiting', 'active', 'crashed', 'completed'],
    default: 'waiting'
  },
  maxMultiplier: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Indexes for better performance
gameRoundSchema.index({ roundId: 1 });
gameRoundSchema.index({ startTime: -1 });
gameRoundSchema.index({ status: 1 });
gameRoundSchema.index({ 'bets.playerId': 1 });

module.exports = mongoose.model('GameRound', gameRoundSchema);