const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  playerId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  wallet: {
    BTC: {
      type: Number,
      default: 0,
      min: 0
    },
    ETH: {
      type: Number,
      default: 0,
      min: 0
    },
    USDT: {
      type: Number,
      default: 1000, // Starting balance
      min: 0
    }
  },
  totalGamesPlayed: {
    type: Number,
    default: 0
  },
  totalWon: {
    type: Number,
    default: 0
  },
  totalLost: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better performance
playerSchema.index({ playerId: 1 });
playerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Player', playerSchema);