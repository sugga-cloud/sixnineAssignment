const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  playerId: {
    type: String,
    required: true,
    index: true
  },
  roundId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['bet', 'cashout', 'deposit', 'withdrawal'],
    required: true
  },
  usdAmount: {
    type: Number,
    required: true
  },
  cryptoAmount: {
    type: Number,
    required: true
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
  transactionHash: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  },
  multiplier: Number,
  balanceAfter: {
    BTC: Number,
    ETH: Number,
    USDT: Number
  }
}, {
  timestamps: true
});

// Indexes for better performance
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ playerId: 1, createdAt: -1 });
transactionSchema.index({ roundId: 1 });
transactionSchema.index({ type: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);