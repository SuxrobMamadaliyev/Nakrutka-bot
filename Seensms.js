/**
 * SeenSMS API Wrapper
 */

const https = require('https');

class SeenSMS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this._servicesCache = null;
    this._cacheTime = 0;
  }

  async request(params) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({ key: this.apiKey, ...params }).toString();
      const options = {
        hostname: 'seensms.uz',
        path: '/api/v1',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('JSON parse xatolik: ' + data)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async getAllServices() {
    const now = Date.now();
    if (this._servicesCache && now - this._cacheTime < 10 * 60 * 1000) {
      return this._servicesCache;
    }
    const res = await this.request({ action: 'services' });
    this._servicesCache = Array.isArray(res) ? res : [];
    this._cacheTime = now;
    return this._servicesCache;
  }

  async getCategories() {
    const services = await this.getAllServices();
    const cats = [...new Set(services.map(s => s.category))].filter(Boolean);
    return cats.sort();
  }

  async getServicesByCategory(category) {
    const services = await this.getAllServices();
    return services.filter(s =>
      s.category && s.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  async getBalance() {
    return this.request({ action: 'balance' });
  }

  async addOrder(serviceId, link, quantity) {
    return this.request({ action: 'add', service: serviceId, link, quantity });
  }

  async checkOrder(orderId) {
    return this.request({ action: 'status', order: orderId });
  }

  async checkMultipleOrders(orderIds) {
    if (!orderIds.length) return {};
    return this.request({ action: 'status', orders: orderIds.join(',') });
  }

  async refillOrder(orderId) {
    return this.request({ action: 'refill', order: orderId });
  }

  async cancelOrder(orderId) {
    return this.request({ action: 'cancel', order: orderId });
  }
}

const seenSMS = new SeenSMS(process.env.SEENSMS_API_KEY);
module.exports = { seenSMS };
