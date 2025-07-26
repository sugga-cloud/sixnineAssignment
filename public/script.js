class CryptoCrashGame {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.currentRound = null;
        this.playerData = null;
        this.currentBet = null;
        this.gameState = 'waiting';
        this.multiplier = 1.00;
        this.autoCashoutEnabled = false;
        this.autoCashoutValue = 2.00;
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadGameHistory();
    }

    initializeElements() {
        // Game elements
        this.multiplierValue = document.getElementById('multiplierValue');
        this.gameStatus = document.getElementById('gameStatus');
        this.countdown = document.getElementById('countdown');
        this.crashAnimation = document.getElementById('crashAnimation');
        this.gameDisplay = document.querySelector('.game-display');

        // Control elements
        this.betAmountInput = document.getElementById('betAmount');
        this.cryptocurrencySelect = document.getElementById('cryptocurrency');
        this.placeBetBtn = document.getElementById('placeBetBtn');
        this.cashOutBtn = document.getElementById('cashOutBtn');
        this.autoCashoutCheckbox = document.getElementById('autoCashout');
        this.autoCashoutValueInput = document.getElementById('autoCashoutValue');

        // Player elements
        this.playerNameInput = document.getElementById('playerName');
        this.joinGameBtn = document.getElementById('joinGameBtn');
        this.connectionStatus = document.getElementById('connectionStatus');

        // Wallet elements
        this.walletBalances = document.getElementById('walletBalances');
        this.totalBalance = document.getElementById('totalBalance');
        this.refreshWalletBtn = document.getElementById('refreshWallet');
        this.depositAmountInput = document.getElementById('depositAmount');
        this.depositCryptoSelect = document.getElementById('depositCrypto');
        this.depositBtn = document.getElementById('depositBtn');

        // Info elements
        this.playersOnline = document.getElementById('playersOnline');
        this.currentRoundDisplay = document.getElementById('currentRound');
        this.playersList = document.getElementById('playersList');
        this.cashoutsList = document.getElementById('cashoutsList');
        this.historyList = document.getElementById('historyList');
        this.notifications = document.getElementById('notifications');

        // Modal elements
        this.crashModal = document.getElementById('crashModal');
        this.crashPoint = document.getElementById('crashPoint');
        this.yourResult = document.getElementById('yourResult');
    }

    attachEventListeners() {
        // Game controls
        this.placeBetBtn.addEventListener('click', () => this.placeBet());
        this.cashOutBtn.addEventListener('click', () => this.cashOut());
        this.joinGameBtn.addEventListener('click', () => this.joinGame());

        // Auto cashout
        this.autoCashoutCheckbox.addEventListener('change', (e) => {
            this.autoCashoutEnabled = e.target.checked;
            this.autoCashoutValueInput.disabled = !e.target.checked;
        });

        this.autoCashoutValueInput.addEventListener('input', (e) => {
            this.autoCashoutValue = parseFloat(e.target.value) || 2.00;
        });

        // Wallet
        this.refreshWalletBtn.addEventListener('click', () => this.refreshWallet());
        this.depositBtn.addEventListener('click', () => this.deposit());

        // Modal
        document.querySelector('.modal-close').addEventListener('click', () => {
            this.crashModal.classList.remove('show');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.gameState === 'active' && this.currentBet) {
                e.preventDefault();
                this.cashOut();
            }
        });

        // Input validation
        this.betAmountInput.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (value < 1) e.target.value = 1;
            if (value > 1000) e.target.value = 1000;
        });
    }

    connectWebSocket() {
        try {
            this.socket = io();
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateConnectionStatus(true);
                this.showNotification('Connected to game server', 'success');
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.updateConnectionStatus(false);
                this.showNotification('Disconnected from server', 'error');
            });

            // Game events
            this.socket.on('round:new', (data) => this.handleNewRound(data));
            this.socket.on('round:started', (data) => this.handleRoundStarted(data));
            this.socket.on('multiplier:update', (data) => this.handleMultiplierUpdate(data));
            this.socket.on('player:cashedout', (data) => this.handlePlayerCashout(data));
            this.socket.on('round:crashed', (data) => this.handleRoundCrashed(data));

            // Player events
            this.socket.on('player:joined', (data) => this.handlePlayerJoined(data));
            this.socket.on('bet:placed', (data) => this.handleBetPlaced(data));
            this.socket.on('bet:confirmed', (data) => this.handleBetConfirmed(data));
            this.socket.on('cashout:confirmed', (data) => this.handleCashoutConfirmed(data));
            this.socket.on('wallet:balance', (data) => this.updateWalletDisplay(data.wallet));

            // Error handling
            this.socket.on('error', (data) => {
                this.showNotification(data.message, 'error');
            });

        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.showNotification('Failed to connect to game server', 'error');
        }
    }

    joinGame() {
        const playerName = this.playerNameInput.value.trim();
        if (!playerName) {
            this.showNotification('Please enter your name', 'warning');
            return;
        }

        if (!this.socket) {
            this.connectWebSocket();
        }

        const playerId = this.generatePlayerId();
        
        this.socket.emit('player:join', {
            playerId: playerId,
            username: playerName
        });

        this.playerNameInput.disabled = true;
        this.joinGameBtn.disabled = true;
    }

    placeBet() {
        if (!this.isConnected || !this.playerData) {
            this.showNotification('Please join the game first', 'warning');
            return;
        }

        if (this.gameState !== 'waiting') {
            this.showNotification('Cannot place bet - round in progress', 'warning');
            return;
        }

        const betAmount = parseFloat(this.betAmountInput.value);
        const cryptocurrency = this.cryptocurrencySelect.value;

        if (!betAmount || betAmount < 1) {
            this.showNotification('Please enter a valid bet amount', 'warning');
            return;
        }

        this.socket.emit('game:bet', {
            usdAmount: betAmount,
            cryptocurrency: cryptocurrency
        });

        this.placeBetBtn.disabled = true;
    }

    cashOut() {
        if (!this.currentBet || this.gameState !== 'active') {
            return;
        }

        this.socket.emit('game:cashout');
        this.cashOutBtn.disabled = true;
    }

    deposit() {
        const amount = parseFloat(this.depositAmountInput.value);
        const crypto = this.depositCryptoSelect.value;

        if (!amount || amount <= 0) {
            this.showNotification('Please enter a valid amount', 'warning');
            return;
        }

        fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                playerId: this.playerData?.playerId,
                amount: amount,
                cryptocurrency: crypto
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showNotification(`Deposited ${amount} ${crypto}`, 'success');
                this.refreshWallet();
                this.depositAmountInput.value = '';
            } else {
                this.showNotification(data.error || 'Deposit failed', 'error');
            }
        })
        .catch(error => {
            console.error('Deposit error:', error);
            this.showNotification('Deposit failed', 'error');
        });
    }

    refreshWallet() {
        if (!this.playerData) return;

        fetch(`/api/wallet/balance/${this.playerData.playerId}`)
            .then(response => response.json())
            .then(data => {
                this.updateWalletDisplay(data.wallet);
                this.totalBalance.textContent = `$${data.totalUsdValue}`;
            })
            .catch(error => {
                console.error('Error refreshing wallet:', error);
            });
    }

    // Event Handlers
    handleNewRound(data) {
        this.currentRound = data.roundId;
        this.gameState = 'waiting';
        this.multiplier = 1.00;
        this.currentBet = null;

        this.currentRoundDisplay.textContent = data.roundId.split('_')[1];
        this.multiplierValue.textContent = '1.00x';
        this.gameStatus.textContent = 'Place your bets!';
        this.crashAnimation.classList.remove('show');
        this.gameDisplay.classList.remove('active');

        // Reset controls
        this.placeBetBtn.disabled = false;
        this.cashOutBtn.disabled = true;

        // Countdown
        let timeLeft = data.bettingEndsIn / 1000;
        const countdownInterval = setInterval(() => {
            this.countdown.textContent = `Betting ends in ${timeLeft.toFixed(1)}s`;
            timeLeft -= 0.1;
            
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                this.countdown.textContent = '';
            }
        }, 100);
    }

    handleRoundStarted(data) {
        this.gameState = 'active';
        this.gameStatus.textContent = 'Game in progress...';
        this.gameDisplay.classList.add('active');
        this.placeBetBtn.disabled = true;
        
        if (this.currentBet) {
            this.cashOutBtn.disabled = false;
        }
    }

    handleMultiplierUpdate(data) {
        this.multiplier = data.multiplier;
        this.multiplierValue.textContent = `${data.multiplier.toFixed(2)}x`;
        this.multiplierValue.classList.add('growing');
        
        setTimeout(() => {
            this.multiplierValue.classList.remove('growing');
        }, 100);

        // Auto cashout check
        if (this.autoCashoutEnabled && this.currentBet && 
            data.multiplier >= this.autoCashoutValue) {
            this.cashOut();
        }
    }

    handlePlayerCashout(data) {
        this.addCashoutToList(data);
        
        if (data.playerId === this.playerData?.playerId) {
            this.currentBet = null;
            this.cashOutBtn.disabled = true;
            this.showNotification(
                `Cashed out at ${data.multiplier}x for $${data.payout.usd}`, 
                'success'
            );
        }
    }

    handleRoundCrashed(data) {
        this.gameState = 'crashed';
        this.gameDisplay.classList.remove('active');
        this.crashAnimation.classList.add('show');
        this.gameStatus.textContent = `Crashed at ${data.crashPoint.toFixed(2)}x`;
        
        // Show crash modal
        this.crashPoint.textContent = `${data.crashPoint.toFixed(2)}x`;
        
        if (this.currentBet) {
            this.yourResult.innerHTML = `
                <div style="color: #ff6b6b; font-weight: 600;">
                    <i class="fas fa-times-circle"></i>
                    You lost $${this.currentBet.usdAmount}
                </div>
            `;
        } else {
            this.yourResult.innerHTML = `
                <div style="color: #888;">
                    You didn't bet this round
                </div>
            `;
        }
        
        this.crashModal.classList.add('show');
        
        // Auto close modal after 3 seconds
        setTimeout(() => {
            this.crashModal.classList.remove('show');
        }, 3000);

        // Add to history
        this.addToHistory(data.crashPoint);
        
        // Reset bet state
        this.currentBet = null;
        this.cashOutBtn.disabled = true;
    }

    handlePlayerJoined(data) {
        this.playerData = data;
        this.updateWalletDisplay(data.wallet);
        this.showNotification(`Welcome, ${data.username}!`, 'success');
        
        // Request current game state
        this.socket.emit('game:state');
    }

    handleBetPlaced(data) {
        // Visual feedback for bet placement
        this.showNotification('Bet placed successfully!', 'success');
    }

    handleBetConfirmed(data) {
        this.currentBet = data;
        this.showNotification(
            `Bet confirmed: $${data.usdAmount} (${data.cryptoAmount.toFixed(8)} ${data.cryptocurrency})`,
            'success'
        );
        this.refreshWallet();
    }

    handleCashoutConfirmed(data) {
        this.showNotification(
            `Cashed out at ${data.multiplier.toFixed(2)}x!`,
            'success'
        );
        this.refreshWallet();
    }

    // UI Updates
    updateConnectionStatus(connected) {
        const statusElement = this.connectionStatus;
        const icon = statusElement.querySelector('i');
        const text = statusElement.querySelector('span');
        
        if (connected) {
            statusElement.classList.add('connected');
            text.textContent = 'Connected';
        } else {
            statusElement.classList.remove('connected');
            text.textContent = 'Disconnected';
        }
    }

    updateWalletDisplay(wallet) {
        const balanceItems = this.walletBalances.querySelectorAll('.balance-item');
        
        balanceItems.forEach(item => {
            const cryptoName = item.querySelector('.crypto-name').textContent;
            const cryptoAmount = item.querySelector('.crypto-amount');
            const usdValue = item.querySelector('.usd-value');
            
            if (wallet[cryptoName]) {
                cryptoAmount.textContent = wallet[cryptoName].amount.toFixed(8);
                usdValue.textContent = `$${wallet[cryptoName].usdValue.toFixed(2)}`;
            }
        });
    }

    addCashoutToList(data) {
        const cashoutItem = document.createElement('div');
        cashoutItem.className = 'cashout-item';
        cashoutItem.innerHTML = `
            <span class="player-name-display">${data.playerId.substring(0, 8)}...</span>
            <span class="cashout-multiplier">${data.multiplier.toFixed(2)}x</span>
        `;
        
        this.cashoutsList.insertBefore(cashoutItem, this.cashoutsList.firstChild);
        
        // Remove old items (keep only last 10)
        const items = this.cashoutsList.querySelectorAll('.cashout-item');
        if (items.length > 10) {
            items[items.length - 1].remove();
        }
        
        // Remove "no cashouts" message
        const noCashouts = this.cashoutsList.querySelector('.no-cashouts');
        if (noCashouts) {
            noCashouts.remove();
        }
    }

    addToHistory(crashPoint) {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        
        // Color coding based on crash point
        if (crashPoint < 2) {
            historyItem.classList.add('low');
        } else if (crashPoint < 5) {
            historyItem.classList.add('medium');
        } else {
            historyItem.classList.add('high');
        }
        
        historyItem.textContent = `${crashPoint.toFixed(2)}x`;
        
        this.historyList.insertBefore(historyItem, this.historyList.firstChild);
        
        // Remove old items (keep only last 50)
        const items = this.historyList.querySelectorAll('.history-item');
        if (items.length > 50) {
            items[items.length - 1].remove();
        }
        
        // Remove loading message
        const loading = this.historyList.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }

    loadGameHistory() {
        fetch('/api/game/history?limit=50')
            .then(response => response.json())
            .then(data => {
                this.historyList.innerHTML = '';
                
                if (data.rounds && data.rounds.length > 0) {
                    data.rounds.forEach(round => {
                        this.addToHistory(round.crashPoint);
                    });
                    
                    // Calculate stats
                    const crashes = data.rounds.map(r => r.crashPoint);
                    const avgCrash = crashes.reduce((a, b) => a + b, 0) / crashes.length;
                    const maxCrash = Math.max(...crashes);
                    
                    document.getElementById('avgCrash').textContent = `${avgCrash.toFixed(2)}x`;
                    document.getElementById('maxCrash').textContent = `${maxCrash.toFixed(2)}x`;
                } else {
                    this.historyList.innerHTML = '<div class="loading">No game history available</div>';
                }
            })
            .catch(error => {
                console.error('Error loading game history:', error);
                this.historyList.innerHTML = '<div class="loading">Failed to load history</div>';
            });
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        this.notifications.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
        
        // Remove on click
        notification.addEventListener('click', () => {
            notification.remove();
        });
    }

    generatePlayerId() {
        return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new CryptoCrashGame();
});