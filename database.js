/**
 * Database — SQLite (faylga asoslangan, o'rnatish shart emas)
 * npm install better-sqlite3
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'bot.db'));

// Jadvallar yaratish
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    user_id INTEGER UNIQUE,
    username TEXT,
    first_name TEXT,
    balance REAL DEFAULT 0,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    api_order_id TEXT,
    service_id TEXT,
    service_name TEXT,
    link TEXT,
    quantity INTEGER,
    cost REAL,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    method TEXT,
    status TEXT DEFAULT 'pending',
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = {
  // ---- FOYDALANUVCHILAR ----
  addUser(userId, username, firstName) {
    db.prepare(`
      INSERT OR IGNORE INTO users (user_id, username, first_name)
      VALUES (?, ?, ?)
    `).run(userId, username, firstName);
  },

  getUser(userId) {
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  },

  getUserBalance(userId) {
    const user = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(userId);
    return user?.balance || 0;
  },

  addBalance(userId, amount) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, userId);
  },

  deductBalance(userId, amount) {
    db.prepare('UPDATE users SET balance = balance - ? WHERE user_id = ?').run(amount, userId);
  },

  getAllUsers() {
    return db.prepare('SELECT user_id FROM users').all();
  },

  getUserOrdersCount(userId) {
    const res = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?').get(userId);
    return res?.cnt || 0;
  },

  getUserTotalSpent(userId) {
    const res = db.prepare('SELECT SUM(cost) as total FROM orders WHERE user_id = ?').get(userId);
    return res?.total || 0;
  },

  // ---- STATE (holat) ----
  setUserState(userId, state) {
    db.prepare('UPDATE users SET state = ? WHERE user_id = ?').run(JSON.stringify(state), userId);
  },

  getUserState(userId) {
    const user = db.prepare('SELECT state FROM users WHERE user_id = ?').get(userId);
    try { return user?.state ? JSON.parse(user.state) : null; }
    catch { return null; }
  },

  clearUserState(userId) {
    db.prepare('UPDATE users SET state = NULL WHERE user_id = ?').run(userId);
  },

  // ---- BUYURTMALAR ----
  saveOrder(userId, apiOrderId, serviceId, serviceName, link, quantity, cost) {
    db.prepare(`
      INSERT INTO orders (user_id, api_order_id, service_id, service_name, link, quantity, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, apiOrderId, serviceId, serviceName, link, quantity, cost);
  },

  getUserOrders(userId, limit = 5) {
    return db.prepare(`
      SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  },

  getAllOrders(limit = 20) {
    return db.prepare(`
      SELECT o.*, u.username, u.first_name
      FROM orders o LEFT JOIN users u ON o.user_id = u.user_id
      ORDER BY o.created_at DESC LIMIT ?
    `).all(limit);
  },

  // ---- TO'LOVLAR ----
  savePayment(userId, amount, method, payload) {
    const res = db.prepare(`
      INSERT INTO payments (user_id, amount, method, payload)
      VALUES (?, ?, ?, ?)
    `).run(userId, amount, method, payload);
    return res.lastInsertRowid;
  },

  updatePaymentStatus(paymentId, status) {
    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, paymentId);
  },

  // ---- STATISTIKA ----
  getStats() {
    const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get()?.cnt || 0;
    const orders = db.prepare('SELECT COUNT(*) as cnt FROM orders').get()?.cnt || 0;
    const revenue = db.prepare('SELECT SUM(cost) as total FROM orders').get()?.total || 0;
    const todayOrders = db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE date(created_at) = date('now')
    `).get()?.cnt || 0;
    return { users, orders, revenue, today_orders: todayOrders };
  },

  // ---- SOZLAMALAR ----
  getSetting(key) {
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  },
};
