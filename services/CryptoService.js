const axios = require('axios');
const logger = require('../config/logger');

class CryptoService {
  constructor() {
    this.priceCache = new Map();
    this.cacheTimeout = parseInt(process.env.PRICE_CACHE_DURATION) || 10000; // 10 seconds
    this.baseURL = process.env.CRYPTO_API_BASE_URL || 'https://api.coingecko.com/api/v3';
    
    // Supported cryptocurrencies mapping
    this.cryptoMapping = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'USDT': 'tether'
    };
  }

  async getPrice(cryptocurrency) {
    try {
      // Check cache first
      const cacheKey = cryptocurrency.toUpperCase();
      const cached = this.priceCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.price;
      }

      // Special case for USDT (always $1)
      if (cryptocurrency.toUpperCase() === 'USDT') {
        const price = 1.0;
        this.priceCache.set(cacheKey, {
          price,
          timestamp: Date.now()
        });
        return price;
      }

      // Fetch from API
      const coinId = this.cryptoMapping[cryptocurrency.toUpperCase()];
      if (!coinId) {
        throw new Error(`Unsupported cryptocurrency: ${cryptocurrency}`);
      }

      const response = await axios.get(`${this.baseURL}/simple/price`, {
        params: {
          ids: coinId,
          vs_currencies: 'usd'
        },
        timeout: 5000
      });

      const price = response.data[coinId]?.usd;
      if (!price) {
        throw new Error(`Price not found for ${cryptocurrency}`);
      }

      // Cache the price
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now()
      });

      logger.info(`Fetched price for ${cryptocurrency}: $${price}`);
      return price;

    } catch (error) {
      logger.error(`Error fetching price for ${cryptocurrency}:`, error.message);
      
      // Return cached price if available, even if expired
      const cached = this.priceCache.get(cryptocurrency.toUpperCase());
      if (cached) {
        logger.warn(`Using expired cached price for ${cryptocurrency}: $${cached.price}`);
        return cached.price;
      }

      // Fallback prices if API fails
      const fallbackPrices = {
        'BTC': 45000,
        'ETH': 3000,
        'USDT': 1
      };

      const fallbackPrice = fallbackPrices[cryptocurrency.toUpperCase()];
      if (fallbackPrice) {
        logger.warn(`Using fallback price for ${cryptocurrency}: $${fallbackPrice}`);
        return fallbackPrice;
      }

      throw new Error(`Unable to get price for ${cryptocurrency}`);
    }
  }

  async getPrices(cryptocurrencies) {
    const prices = {};
    
    for (const crypto of cryptocurrencies) {
      try {
        prices[crypto] = await this.getPrice(crypto);
      } catch (error) {
        logger.error(`Failed to get price for ${crypto}:`, error.message);
        prices[crypto] = null;
      }
    }

    return prices;
  }

  // Convert USD to crypto
  usdToCrypto(usdAmount, cryptoPrice) {
    return usdAmount / cryptoPrice;
  }

  // Convert crypto to USD
  cryptoToUsd(cryptoAmount, cryptoPrice) {
    return cryptoAmount * cryptoPrice;
  }

  // Get supported cryptocurrencies
  getSupportedCryptos() {
    return Object.keys(this.cryptoMapping);
  }

  // Clear price cache
  clearCache() {
    this.priceCache.clear();
    logger.info('Price cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    const stats = {
      size: this.priceCache.size,
      entries: []
    };

    for (const [crypto, data] of this.priceCache.entries()) {
      stats.entries.push({
        crypto,
        price: data.price,
        age: Date.now() - data.timestamp,
        expired: (Date.now() - data.timestamp) > this.cacheTimeout
      });
    }

    return stats;
  }
}

module.exports = CryptoService;