const logger = require('../config/logger');
const Player = require('../models/Player');

class WebSocketHandler {
  constructor(io, gameManager) {
    this.io = io;
    this.gameManager = gameManager;
    this.connectedPlayers = new Map(); // socketId -> playerId mapping
    
    this.initializeSocketHandlers();
  }

  initializeSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Handle player authentication/registration
      socket.on('player:join', async (data) => {
        try {
          await this.handlePlayerJoin(socket, data);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle bet placement
      socket.on('game:bet', async (data) => {
        try {
          await this.handleBet(socket, data);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle cashout request
      socket.on('game:cashout', async () => {
        try {
          await this.handleCashout(socket);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle game state request
      socket.on('game:state', () => {
        try {
          this.handleGameStateRequest(socket);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle wallet balance request
      socket.on('wallet:balance', async () => {
        try {
          await this.handleBalanceRequest(socket);
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong');
      });
    });
  }

  async handlePlayerJoin(socket, data) {
    const { playerId, username } = data;

    if (!playerId || !username) {
      throw new Error('Player ID and username are required');
    }

    // Find or create player
    let player = await Player.findOne({ playerId });
    
    if (!player) {
      player = new Player({
        playerId,
        username: username.trim().substring(0, 50) // Limit username length
      });
      await player.save();
      logger.info(`New player created: ${playerId} (${username})`);
    } else {
      // Update username if changed
      if (player.username !== username.trim()) {
        player.username = username.trim().substring(0, 50);
        await player.save();
      }
    }

    // Store player association
    this.connectedPlayers.set(socket.id, playerId);
    socket.playerId = playerId;

    // Join player to game room
    socket.join('game');

    // Send welcome message with current game state
    socket.emit('player:joined', {
      playerId,
      username: player.username,
      wallet: player.wallet,
      stats: {
        totalGamesPlayed: player.totalGamesPlayed,
        totalWon: player.totalWon,
        totalLost: player.totalLost
      }
    });

    // Send current game state
    const gameState = this.gameManager.getGameState();
    socket.emit('game:state', gameState);

    logger.info(`Player joined: ${playerId} (${username})`);
  }

  async handleBet(socket, data) {
    const playerId = socket.playerId;
    if (!playerId) {
      throw new Error('Player not authenticated');
    }

    const { usdAmount, cryptocurrency } = data;

    // Validate input
    if (!usdAmount || usdAmount <= 0) {
      throw new Error('Invalid bet amount');
    }

    if (!cryptocurrency || !['BTC', 'ETH', 'USDT'].includes(cryptocurrency.toUpperCase())) {
      throw new Error('Invalid cryptocurrency');
    }

    // Place bet through game manager
    const bet = await this.gameManager.placeBet(
      playerId, 
      parseFloat(usdAmount), 
      cryptocurrency.toUpperCase()
    );

    // Confirm bet to player
    socket.emit('bet:confirmed', {
      roundId: bet.roundId,
      usdAmount: bet.usdAmount,
      cryptoAmount: bet.cryptoAmount,
      cryptocurrency: bet.cryptocurrency,
      priceAtTime: bet.priceAtTime
    });

    logger.info(`Bet handled via WebSocket: ${playerId} - $${usdAmount}`);
  }

  async handleCashout(socket) {
    const playerId = socket.playerId;
    if (!playerId) {
      throw new Error('Player not authenticated');
    }

    // Process cashout through game manager
    const result = await this.gameManager.cashOut(playerId);

    // Confirm cashout to player
    socket.emit('cashout:confirmed', {
      multiplier: result.multiplier,
      payout: result.payout
    });

    logger.info(`Cashout handled via WebSocket: ${playerId} - ${result.multiplier}x`);
  }

  handleGameStateRequest(socket) {
    const gameState = this.gameManager.getGameState();
    socket.emit('game:state', gameState);
  }

  async handleBalanceRequest(socket) {
    const playerId = socket.playerId;
    if (!playerId) {
      throw new Error('Player not authenticated');
    }

    const player = await Player.findOne({ playerId });
    if (!player) {
      throw new Error('Player not found');
    }

    socket.emit('wallet:balance', {
      wallet: player.wallet
    });
  }

  handleDisconnect(socket) {
    const playerId = this.connectedPlayers.get(socket.id);
    
    if (playerId) {
      this.connectedPlayers.delete(socket.id);
      logger.info(`Player disconnected: ${playerId} (${socket.id})`);
    } else {
      logger.info(`Client disconnected: ${socket.id}`);
    }
  }

  // Broadcast methods for game events
  broadcastToGame(event, data) {
    this.io.to('game').emit(event, data);
  }

  // Get connection statistics
  getConnectionStats() {
    return {
      totalConnections: this.io.engine.clientsCount,
      authenticatedPlayers: this.connectedPlayers.size,
      players: Array.from(this.connectedPlayers.values())
    };
  }
}

module.exports = WebSocketHandler;