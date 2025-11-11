const Storage = require('./storage');

class Config {
  constructor() {
    this.storage = new Storage();
  }

  get(key) {
    return this.storage.getConfig(key);
  }

  set(key, value) {
    this.storage.setConfig(key, value);
  }

  getAll() {
    return this.storage.getAllConfig();
  }

  getMaxRetries() {
    return parseInt(this.get('max_retries') || '3', 10);
  }

  getBackoffBase() {
    return parseFloat(this.get('backoff_base') || '2');
  }

  setMaxRetries(value) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) {
      throw new Error('max_retries must be a non-negative integer');
    }
    this.set('max_retries', num.toString());
  }

  setBackoffBase(value) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      throw new Error('backoff_base must be a positive number');
    }
    this.set('backoff_base', num.toString());
  }
}

module.exports = Config;

