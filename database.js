/**
 * Database — MongoDB (Render + MongoDB Atlas uchun)
 * npm install mongoose
 */

const mongoose = require('mongoose');

let isConnected = false;

async function connect() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  isConnected = true;
  console.log('✅ MongoDB ulandi');
}

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('⚠️ MongoDB uzildi, qayta ulanmoqda...');
  setTimeout(connect, 3000);
});

// ============================================================
// SCHEMALAR
// ============================================================

const UserSchema = new mongoose.Schema({
  user_id:    { type: Number, unique: true, required: true },
  username:   { type: String, default: null },
  first_name: { type: String, default: '' },
  balance:    { type: Number, default: 0 },
  state:      { type: mongoose.Schema.Types.Mixed, default: null },
  created_at: { type: Date, default: Date.now },
});

const OrderSchema = new mongoose.Schema({
  user_id:      { type: Number, required: true },
  api_order_id: { type: String, default: null },
  service_id:   { type: String },
  service_name: { type: String },
  link:         { type: String },
  quantity:     { type: Number },
  cost:         { type: Number },
  status:       { type: String, default: 'Pending' },
  created_at:   { type: Date, default: Date.now },
});

const PaymentSchema = new mongoose.Schema({
  user_id:    { type: Number, required: true },
  amount:     { type: Number },
  method:     { type: String },
  status:     { type: String, default: 'pending' },
  payload:    { type: String },
  created_at: { type: Date, default: Date.now },
});

const SettingSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: { type: String },
});

const User    = mongoose.model('User',    UserSchema);
const Order   = mongoose.model('Order',   OrderSchema);
const Payment = mongoose.model('Payment', PaymentSchema);
const Setting = mongoose.model('Setting', SettingSchema);

// ============================================================
// FUNKSIYALAR
// ============================================================
module.exports = {
  connect,

  // ---- FOYDALANUVCHILAR ----
  async addUser(userId, username, firstName) {
    await connect();
    await User.updateOne(
      { user_id: userId },
      { $setOnInsert: { user_id: userId, username, first_name: firstName } },
      { upsert: true }
    );
  },

  async getUser(userId) {
    await connect();
    return User.findOne({ user_id: userId }).lean();
  },

  async getUserBalance(userId) {
    await connect();
    const user = await User.findOne({ user_id: userId }, 'balance').lean();
    return user?.balance || 0;
  },

  async addBalance(userId, amount) {
    await connect();
    await User.updateOne({ user_id: userId }, { $inc: { balance: amount } });
  },

  async deductBalance(userId, amount) {
    await connect();
    await User.updateOne({ user_id: userId }, { $inc: { balance: -amount } });
  },

  async getAllUsers() {
    await connect();
    return User.find({}, 'user_id').lean();
  },

  async getUserOrdersCount(userId) {
    await connect();
    return Order.countDocuments({ user_id: userId });
  },

  async getUserTotalSpent(userId) {
    await connect();
    const res = await Order.aggregate([
      { $match: { user_id: userId } },
      { $group: { _id: null, total: { $sum: '$cost' } } }
    ]);
    return res[0]?.total || 0;
  },

  // ---- STATE ----
  async setUserState(userId, state) {
    await connect();
    await User.updateOne({ user_id: userId }, { $set: { state } });
  },

  async getUserState(userId) {
    await connect();
    const user = await User.findOne({ user_id: userId }, 'state').lean();
    return user?.state || null;
  },

  async clearUserState(userId) {
    await connect();
    await User.updateOne({ user_id: userId }, { $set: { state: null } });
  },

  // ---- BUYURTMALAR ----
  async saveOrder(userId, apiOrderId, serviceId, serviceName, link, quantity, cost) {
    await connect();
    const order = new Order({
      user_id: userId, api_order_id: apiOrderId,
      service_id: serviceId, service_name: serviceName,
      link, quantity, cost
    });
    await order.save();
    return order;
  },

  async getUserOrders(userId, limit = 5) {
    await connect();
    return Order.find({ user_id: userId }).sort({ created_at: -1 }).limit(limit).lean();
  },

  async getAllOrders(limit = 20) {
    await connect();
    const orders = await Order.find().sort({ created_at: -1 }).limit(limit).lean();
    for (const o of orders) {
      const user = await User.findOne({ user_id: o.user_id }, 'username first_name').lean();
      o.username   = user?.username;
      o.first_name = user?.first_name;
    }
    return orders;
  },

  // ---- TO'LOVLAR ----
  async savePayment(userId, amount, method, payload) {
    await connect();
    const payment = new Payment({ user_id: userId, amount, method, payload });
    await payment.save();
    return payment._id.toString();
  },

  async updatePaymentStatus(paymentId, status) {
    await connect();
    await Payment.updateOne({ _id: paymentId }, { $set: { status } });
  },

  // ---- STATISTIKA ----
  async getStats() {
    await connect();
    const [users, orders, revenueRes, todayOrders] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$cost' } } }]),
      Order.countDocuments({
        created_at: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt:  new Date(new Date().setHours(23, 59, 59, 999)),
        }
      }),
    ]);
    return {
      users,
      orders,
      revenue:      revenueRes[0]?.total || 0,
      today_orders: todayOrders,
    };
  },

  // ---- SOZLAMALAR ----
  async getSetting(key) {
    await connect();
    const s = await Setting.findOne({ key }).lean();
    return s?.value || null;
  },

  async setSetting(key, value) {
    await connect();
    await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  },
};
