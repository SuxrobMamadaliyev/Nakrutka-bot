/**
 * SeenSMS Nakrutka Bot — Webhook, MongoDB, Render
 * Bitta fayl — hamma narsa shu yerda
 * npm install node-telegram-bot-api mongoose express dotenv
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express     = require('express');
const mongoose    = require('mongoose');
const https       = require('https');

const BOT_TOKEN  = process.env.BOT_TOKEN;
const RENDER_URL = process.env.RENDER_URL;
const PORT       = process.env.PORT || 3000;

// ============================================================
// MONGODB
// ============================================================
const UserSchema = new mongoose.Schema({
  user_id:    { type: Number, unique: true },
  username:   String,
  first_name: String,
  balance:    { type: Number, default: 0 },
  state:      { type: mongoose.Schema.Types.Mixed, default: null },
  created_at: { type: Date, default: Date.now },
});
const OrderSchema = new mongoose.Schema({
  user_id:      Number,
  api_order_id: String,
  service_id:   String,
  service_name: String,
  link:         String,
  quantity:     Number,
  cost:         Number,
  status:       { type: String, default: 'Pending' },
  created_at:   { type: Date, default: Date.now },
});
const PaymentSchema = new mongoose.Schema({
  user_id:    Number,
  amount:     Number,
  method:     String,
  status:     { type: String, default: 'pending' },
  created_at: { type: Date, default: Date.now },
});

const User    = mongoose.model('User',    UserSchema);
const Order   = mongoose.model('Order',   OrderSchema);
const Payment = mongoose.model('Payment', PaymentSchema);

async function dbConnect() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB ulandi');
}

// ============================================================
// DB FUNKSIYALAR
// ============================================================
const db = {
  async addUser(userId, username, firstName) {
    await dbConnect();
    await User.updateOne({ user_id: userId }, { $setOnInsert: { user_id: userId, username, first_name: firstName } }, { upsert: true });
  },
  async getUser(userId) {
    await dbConnect();
    return User.findOne({ user_id: userId }).lean();
  },
  async getUserBalance(userId) {
    await dbConnect();
    const u = await User.findOne({ user_id: userId }, 'balance').lean();
    return u?.balance || 0;
  },
  async addBalance(userId, amount) {
    await dbConnect();
    await User.updateOne({ user_id: userId }, { $inc: { balance: amount } });
  },
  async deductBalance(userId, amount) {
    await dbConnect();
    await User.updateOne({ user_id: userId }, { $inc: { balance: -amount } });
  },
  async getAllUsers() {
    await dbConnect();
    return User.find({}, 'user_id').lean();
  },
  async setUserState(userId, state) {
    await dbConnect();
    await User.updateOne({ user_id: userId }, { $set: { state } });
  },
  async getUserState(userId) {
    await dbConnect();
    const u = await User.findOne({ user_id: userId }, 'state').lean();
    return u?.state || null;
  },
  async clearUserState(userId) {
    await dbConnect();
    await User.updateOne({ user_id: userId }, { $set: { state: null } });
  },
  async saveOrder(userId, apiOrderId, serviceId, serviceName, link, quantity, cost) {
    await dbConnect();
    await new Order({ user_id: userId, api_order_id: apiOrderId, service_id: serviceId, service_name: serviceName, link, quantity, cost }).save();
  },
  async getUserOrders(userId, limit = 5) {
    await dbConnect();
    return Order.find({ user_id: userId }).sort({ created_at: -1 }).limit(limit).lean();
  },
  async getAllOrders(limit = 20) {
    await dbConnect();
    const orders = await Order.find().sort({ created_at: -1 }).limit(limit).lean();
    for (const o of orders) {
      const u = await User.findOne({ user_id: o.user_id }, 'username first_name').lean();
      o.username = u?.username; o.first_name = u?.first_name;
    }
    return orders;
  },
  async getUserOrdersCount(userId) {
    await dbConnect();
    return Order.countDocuments({ user_id: userId });
  },
  async getUserTotalSpent(userId) {
    await dbConnect();
    const r = await Order.aggregate([{ $match: { user_id: userId } }, { $group: { _id: null, total: { $sum: '$cost' } } }]);
    return r[0]?.total || 0;
  },
  async savePayment(userId, amount, method) {
    await dbConnect();
    const p = await new Payment({ user_id: userId, amount, method }).save();
    return p._id.toString();
  },
  async updatePaymentStatus(paymentId, status) {
    await dbConnect();
    await Payment.updateOne({ _id: paymentId }, { $set: { status } });
  },
  async getStats() {
    await dbConnect();
    const [users, orders, rev, today] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: null, t: { $sum: '$cost' } } }]),
      Order.countDocuments({ created_at: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
    ]);
    return { users, orders, revenue: rev[0]?.t || 0, today_orders: today };
  },
};

// ============================================================
// SEENSMS API
// ============================================================
let _cache = null, _cacheTime = 0;

function apiRequest(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ key: process.env.SEENSMS_API_KEY, ...params }).toString();
    const req = https.request({
      hostname: 'seensms.uz', path: '/api/v1', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

const smm = {
  async getAllServices() {
    if (_cache && Date.now() - _cacheTime < 10 * 60 * 1000) return _cache;
    const r = await apiRequest({ action: 'services' });
    _cache = Array.isArray(r) ? r : [];
    _cacheTime = Date.now();
    return _cache;
  },
  async getCategories() {
    const s = await this.getAllServices();
    return [...new Set(s.map(x => x.category))].filter(Boolean).sort();
  },
  async getServicesByCategory(cat) {
    const s = await this.getAllServices();
    return s.filter(x => x.category?.toLowerCase().includes(cat.toLowerCase()));
  },
  async getBalance() { return apiRequest({ action: 'balance' }); },
  async addOrder(serviceId, link, quantity) { return apiRequest({ action: 'add', service: serviceId, link, quantity }); },
  async checkMultipleOrders(ids) {
    if (!ids.length) return {};
    return apiRequest({ action: 'status', orders: ids.join(',') });
  },
};

// ============================================================
// YORDAMCHI
// ============================================================
const ADMIN_IDS = (process.env.ADMIN_IDS || process.env.ADMIN_ID || '').split(',').map(x => parseInt(x.trim())).filter(Boolean);
const CHANNELS  = (process.env.REQUIRED_CHANNELS || '').split(',').map(x => x.trim()).filter(Boolean);

function isAdmin(userId) { return ADMIN_IDS.includes(parseInt(userId)); }

function catEmoji(cat) {
  const m = { Instagram:'📸', TikTok:'📱', Telegram:'✈️', YouTube:'▶️', Facebook:'👍', Twitter:'🐦', X:'🐦', VK:'💙', Spotify:'🎵' };
  for (const [k, v] of Object.entries(m)) if (cat.includes(k)) return v;
  return '📌';
}
function statusEmoji(s) {
  return { Pending:'⏳', 'In progress':'🔄', Completed:'✅', Partial:'⚠️', Canceled:'❌' }[s] || '📌';
}

async function checkSub(bot, userId) {
  if (!CHANNELS.length) return true;
  for (const ch of CHANNELS) {
    try {
      const m = await bot.getChatMember(ch, userId);
      if (['left','kicked'].includes(m.status)) return false;
    } catch { return false; }
  }
  return true;
}

function subKeyboard() {
  const btns = CHANNELS.map(ch => ([{ text: `📢 ${ch}`, url: `https://t.me/${ch.replace('@','')}` }]));
  btns.push([{ text: '✅ Tekshirish', callback_data: 'check_sub' }]);
  return { inline_keyboard: btns };
}

// ============================================================
// BOT + EXPRESS
// ============================================================
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
app.get('/', (_, res) => res.send('✅ SeenSMS Bot ishlayapti'));

app.listen(PORT, async () => {
  console.log(`🌐 Port ${PORT}`);
  await dbConnect();
  await bot.setWebHook(`${RENDER_URL}/webhook/${BOT_TOKEN}`);
  console.log('✅ Webhook ulandi');
});

// ============================================================
// ASOSIY MENYU
// ============================================================
async function mainMenu(bot, chatId, name) {
  const bal = await db.getUserBalance(chatId);
  return bot.sendMessage(chatId,
    `🏠 <b>Asosiy menyu</b>\n\n👤 <b>${name}</b>\n💰 Balans: <b>${bal.toLocaleString()} so'm</b>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '🛒 Buyurtma berish', callback_data: 'order_menu' }, { text: '📊 Buyurtmalarim', callback_data: 'my_orders' }],
      [{ text: '💰 Balans to\'ldirish', callback_data: 'top_up' }, { text: '👤 Profil', callback_data: 'profile' }],
      [{ text: '📋 Xizmatlar', callback_data: 'services_menu' }, { text: '💬 Yordam', callback_data: 'support' }],
    ]}}
  );
}

// ============================================================
// /start
// ============================================================
bot.onText(/\/start/, async (msg) => {
  const { id: chatId, from: { id: userId, first_name, username } } = { id: msg.chat.id, from: msg.from };
  await db.addUser(userId, username, first_name);
  const ok = await checkSub(bot, userId);
  if (!ok) return bot.sendMessage(chatId, `👋 Salom, <b>${first_name}</b>!\n\n✅ Obuna bo'ling:`, { parse_mode: 'HTML', reply_markup: subKeyboard() });
  await mainMenu(bot, chatId, first_name);
});

// ============================================================
// /admin
// ============================================================
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;
  const stats  = await db.getStats();
  const apiBal = await smm.getBalance().catch(() => ({ balance: '?', currency: 'UZS' }));
  bot.sendMessage(chatId,
    `🔧 <b>Admin Panel</b>\n\n👥 Foydalanuvchilar: <b>${stats.users}</b>\n🛒 Buyurtmalar: <b>${stats.orders}</b>\n💰 Aylanma: <b>${stats.revenue?.toLocaleString()} so'm</b>\n📅 Bugun: <b>${stats.today_orders}</b>\n🔑 API Balans: <b>${apiBal.balance} ${apiBal.currency}</b>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '🛒 Buyurtmalar', callback_data: 'admin_orders' }, { text: '💰 Balans qo\'shish', callback_data: 'admin_add_balance' }],
      [{ text: '📢 Xabar yuborish', callback_data: 'admin_broadcast' }, { text: '📊 Statistika', callback_data: 'admin_stats' }],
    ]}}
  );
});

// ============================================================
// CALLBACK
// ============================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const userId = query.from.id;
  const data   = query.data;
  await bot.answerCallbackQuery(query.id);

  // Obuna tekshirish
  if (data !== 'check_sub') {
    const ok = await checkSub(bot, userId);
    if (!ok) return bot.sendMessage(chatId, `⚠️ Avval kanallarga obuna bo'ling!`, { reply_markup: subKeyboard() });
  }

  const edit = (text, kb) => bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
  const BACK = [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }];

  // ---- OBUNA ----
  if (data === 'check_sub') {
    const ok = await checkSub(bot, userId);
    if (ok) { await bot.deleteMessage(chatId, msgId).catch(() => {}); return mainMenu(bot, chatId, query.from.first_name); }
    return bot.answerCallbackQuery(query.id, { text: '❌ Hali obuna bo\'lmadingiz!', show_alert: true });
  }

  if (data === 'main_menu') {
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    return mainMenu(bot, chatId, query.from.first_name);
  }

  // ---- XIZMATLAR ----
  if (data === 'services_menu') {
    const cats = await smm.getCategories();
    return edit(`📋 <b>Kategoriyalar</b>\n\nTanlang:`, [...cats.map(c => ([{ text: `${catEmoji(c)} ${c}`, callback_data: `cat_${c}` }])), [BACK[0]]]);
  }

  if (data.startsWith('cat_')) {
    const cat  = data.slice(4);
    const list = await smm.getServicesByCategory(cat);
    return edit(`📋 <b>${cat}</b>\n\nXizmat tanlang:`, [
      ...list.slice(0, 10).map(s => ([{ text: `${s.name} | ${s.rate} so'm/1000`, callback_data: `svc_${s.service}` }])),
      [{ text: '◀️ Orqaga', callback_data: 'services_menu' }, BACK[0]]
    ]);
  }

  if (data.startsWith('svc_')) {
    const sid = data.slice(4);
    const all = await smm.getAllServices();
    const svc = all.find(s => String(s.service) === sid);
    if (!svc) return;
    await db.setUserState(userId, { step: 'waiting_link', serviceId: sid });
    return edit(
      `🛒 <b>${svc.name}</b>\n\n💰 ${svc.rate} so'm/1000\n📊 Min: <b>${svc.min}</b> | Max: <b>${svc.max}</b>\n\n🔗 Havola yuboring:`,
      [[{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]]
    );
  }

  // ---- BUYURTMA MENYUSI ----
  if (data === 'order_menu') {
    return edit(`🛒 <b>Buyurtma</b>\n\nIjtimoiy tarmoqni tanlang:`, [
      [{ text: '📸 Instagram', callback_data: 'cat_Instagram' }, { text: '📱 TikTok', callback_data: 'cat_TikTok' }],
      [{ text: '✈️ Telegram',  callback_data: 'cat_Telegram'  }, { text: '▶️ YouTube', callback_data: 'cat_YouTube' }],
      [{ text: '👍 Facebook',  callback_data: 'cat_Facebook'  }, { text: '🐦 Twitter', callback_data: 'cat_Twitter' }],
      [{ text: '📋 Barcha xizmatlar', callback_data: 'services_menu' }],
      BACK,
    ]);
  }

  // ---- TASDIQLASH ----
  if (data === 'confirm_order') {
    const state = await db.getUserState(userId);
    if (!state || state.step !== 'confirm_order') return;
    const bal = await db.getUserBalance(userId);
    if (bal < state.cost) return bot.sendMessage(chatId, `❌ Balans yetarli emas!`);
    await bot.sendMessage(chatId, `⏳ Buyurtma berilmoqda...`);
    const result = await smm.addOrder(state.serviceId, state.link, state.quantity);
    if (result.order) {
      await db.deductBalance(userId, state.cost);
      const all = await smm.getAllServices();
      const svc = all.find(s => String(s.service) === state.serviceId);
      await db.saveOrder(userId, result.order, state.serviceId, svc?.name, state.link, state.quantity, state.cost);
      await db.clearUserState(userId);
      return bot.sendMessage(chatId,
        `✅ <b>Buyurtma berildi!</b>\n\n🆔 #${result.order}\n📊 ${state.quantity.toLocaleString()} ta\n💰 ${state.cost.toLocaleString()} so'm`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📊 Buyurtmalarim', callback_data: 'my_orders' }], BACK] }}
      );
    }
    return bot.sendMessage(chatId, `❌ Xatolik: ${result.error || 'Noma\'lum'}`, { reply_markup: { inline_keyboard: [BACK] } });
  }

  // ---- BUYURTMALARIM ----
  if (data === 'my_orders') {
    const orders = await db.getUserOrders(userId, 5);
    if (!orders.length) return edit(`📊 <b>Buyurtmalarim</b>\n\n❌ Hali buyurtma yo'q.`, [[{ text: '🛒 Buyurtma berish', callback_data: 'order_menu' }], BACK]);
    const ids = orders.map(o => o.api_order_id).filter(Boolean);
    const sts = ids.length ? await smm.checkMultipleOrders(ids) : {};
    let txt = `📊 <b>So'nggi buyurtmalar:</b>\n\n`;
    for (const o of orders) {
      const st = sts[o.api_order_id] || {};
      txt += `${statusEmoji(st.status || o.status)} <b>#${o.api_order_id}</b> — ${o.service_name}\n`;
      txt += `   ${o.quantity} ta | ${o.cost.toLocaleString()} so'm | ${st.status || o.status}\n\n`;
    }
    return edit(txt, [[{ text: '🔄 Yangilash', callback_data: 'my_orders' }], BACK]);
  }

  // ---- BALANS ----
  if (data === 'top_up') {
    return edit(`💰 <b>Balans to'ldirish</b>\n\nTo'lov tizimini tanlang:`, [
      [{ text: '💳 Click', callback_data: 'pay_click' }, { text: '💳 Payme', callback_data: 'pay_payme' }],
      BACK,
    ]);
  }

  if (data === 'pay_click' || data === 'pay_payme') {
    const method = data === 'pay_click' ? 'Click' : 'Payme';
    await db.setUserState(userId, { step: 'waiting_amount', payMethod: method });
    return edit(`💰 <b>${method}</b>\n\nMiqdor tanlang yoki yozing (so'mda):`, [
      [{ text: "10,000",  callback_data: 'amt_10000'  }, { text: "25,000",  callback_data: 'amt_25000'  }, { text: "50,000",  callback_data: 'amt_50000'  }],
      [{ text: "100,000", callback_data: 'amt_100000' }, { text: "250,000", callback_data: 'amt_250000' }, { text: "500,000", callback_data: 'amt_500000' }],
      [{ text: '❌ Bekor qilish', callback_data: 'main_menu' }],
    ]);
  }

  if (data.startsWith('amt_')) {
    const amount = parseInt(data.slice(4));
    const state  = await db.getUserState(userId);
    const method = state?.payMethod || 'Click';
    await sendPayment(bot, chatId, userId, amount, method);
    return;
  }

  // ---- PROFIL ----
  if (data === 'profile') {
    const user   = await db.getUser(userId);
    const cnt    = await db.getUserOrdersCount(userId);
    const spent  = await db.getUserTotalSpent(userId);
    return edit(
      `👤 <b>Profil</b>\n\n🆔 ID: <code>${userId}</code>\n👤 ${user.first_name}\n💰 Balans: <b>${user.balance.toLocaleString()} so'm</b>\n🛒 Buyurtmalar: <b>${cnt}</b>\n💸 Sarflangan: <b>${spent.toLocaleString()} so'm</b>`,
      [[{ text: '💰 Balans to\'ldirish', callback_data: 'top_up' }], BACK]
    );
  }

  // ---- YORDAM ----
  if (data === 'support') {
    return edit(
      `💬 <b>Yordam</b>\n\n👤 Admin: @${process.env.ADMIN_USERNAME}\n⏰ 09:00 - 22:00`,
      [[{ text: '📩 Adminga yozish', url: `https://t.me/${process.env.ADMIN_USERNAME}` }], BACK]
    );
  }

  // ---- ADMIN CALLBACKLAR ----
  if (!isAdmin(userId)) return;

  if (data === 'admin_orders') {
    const orders = await db.getAllOrders(10);
    let txt = `🛒 <b>So'nggi 10 buyurtma:</b>\n\n`;
    for (const o of orders) txt += `#${o.api_order_id} | @${o.username || o.user_id} | ${o.service_name} | ${o.quantity} | ${o.cost?.toLocaleString()} so'm\n`;
    return edit(txt || 'Buyurtma yo\'q', [[{ text: '◀️ Orqaga', callback_data: 'admin_back' }]]);
  }

  if (data === 'admin_stats') {
    const s = await db.getStats();
    const b = await smm.getBalance().catch(() => ({ balance: '?', currency: 'UZS' }));
    return edit(
      `📊 <b>Statistika</b>\n\n👥 ${s.users} foydalanuvchi\n🛒 ${s.orders} buyurtma\n💰 ${s.revenue?.toLocaleString()} so'm aylanma\n📅 Bugun: ${s.today_orders}\n🔑 API: ${b.balance} ${b.currency}`,
      [[{ text: '🔄 Yangilash', callback_data: 'admin_stats' }], [{ text: '◀️ Orqaga', callback_data: 'admin_back' }]]
    );
  }

  if (data === 'admin_add_balance') {
    await db.setUserState(userId, { step: 'admin_add_balance_id' });
    return edit(`💰 Foydalanuvchi ID ni yuboring:`, [[{ text: '❌ Bekor', callback_data: 'admin_back' }]]);
  }

  if (data === 'admin_broadcast') {
    await db.setUserState(userId, { step: 'admin_broadcast' });
    return edit(`📢 Yubormoqchi bo'lgan xabarni yozing:`, [[{ text: '❌ Bekor', callback_data: 'admin_back' }]]);
  }

  if (data.startsWith('admin_confirm_pay_')) {
    const [,,,payId, targetId, amount] = data.split('_');
    await db.updatePaymentStatus(payId, 'confirmed');
    await db.addBalance(parseInt(targetId), parseFloat(amount));
    await bot.editMessageText(`✅ Tasdiqlandi! ${parseFloat(amount).toLocaleString()} so'm → ${targetId}`, { chat_id: chatId, message_id: msgId });
    await bot.sendMessage(parseInt(targetId), `✅ Balansingizga <b>${parseFloat(amount).toLocaleString()} so'm</b> qo'shildi!`, { parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  if (data.startsWith('admin_reject_pay_')) {
    const [,,,payId, targetId] = data.split('_');
    await db.updatePaymentStatus(payId, 'rejected');
    await bot.editMessageText(`❌ Rad etildi. User: ${targetId}`, { chat_id: chatId, message_id: msgId });
    await bot.sendMessage(parseInt(targetId), `❌ To'lovingiz tasdiqlanmadi. Admin bilan bog'laning.`).catch(() => {});
    return;
  }
});

// ============================================================
// TO'LOV YUBORISH
// ============================================================
async function sendPayment(bot, chatId, userId, amount, method) {
  const payId = await db.savePayment(userId, amount, method);
  const merchantId = method === 'Click' ? process.env.CLICK_MERCHANT_ID : process.env.PAYME_MERCHANT_ID;
  const serviceId  = process.env.CLICK_SERVICE_ID;

  let url;
  if (method === 'Click') {
    url = `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amount}&transaction_param=${payId}&return_url=https://t.me/${process.env.BOT_USERNAME}`;
  } else {
    const p = Buffer.from(JSON.stringify({ m: merchantId, ac: { order_id: payId }, a: amount * 100 })).toString('base64');
    url = `https://checkout.paycom.uz/${p}`;
  }

  await bot.sendMessage(chatId,
    `💳 <b>${method} orqali to'lov</b>\n\n💰 ${amount.toLocaleString()} so'm\n🔢 ID: ${payId}\n\nTo'lovdan keyin "To'ladim" tugmasini bosing:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: `💳 ${method} orqali to'lash`, url }],
      [{ text: '✅ To\'ladim', callback_data: `paid_${payId}` }],
      [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }],
    ]}}
  );

  // Adminga xabar
  const user = await db.getUser(userId);
  for (const adminId of ADMIN_IDS) {
    bot.sendMessage(adminId,
      `💰 <b>Yangi to'lov</b>\n\n👤 @${user?.username || userId}\n💳 ${method}\n💰 ${amount.toLocaleString()} so'm\n🔢 ${payId}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
        { text: '✅ Tasdiqlash', callback_data: `admin_confirm_pay_${payId}_${userId}_${amount}` },
        { text: '❌ Rad etish',  callback_data: `admin_reject_pay_${payId}_${userId}` },
      ]]}}
    ).catch(() => {});
  }
}

// ============================================================
// MATN XABARLARI
// ============================================================
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text   = msg.text.trim();

  const state = await db.getUserState(userId);
  if (!state) return;

  // ---- ADMIN: BALANS ----
  if (isAdmin(userId) && state.step === 'admin_add_balance_id') {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(chatId, '❌ Noto\'g\'ri ID!');
    await db.setUserState(userId, { step: 'admin_add_balance_amount', targetId: tid });
    return bot.sendMessage(chatId, `Miqdorni kiriting (so'mda):`);
  }

  if (isAdmin(userId) && state.step === 'admin_add_balance_amount') {
    const amount = parseFloat(text.replace(/\s|,/g, ''));
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Noto\'g\'ri miqdor!');
    await db.addBalance(state.targetId, amount);
    await db.clearUserState(userId);
    await bot.sendMessage(chatId, `✅ ${state.targetId} ga ${amount.toLocaleString()} so'm qo'shildi!`);
    await bot.sendMessage(state.targetId, `✅ Balansingizga <b>${amount.toLocaleString()} so'm</b> qo'shildi!`, { parse_mode: 'HTML' }).catch(() => {});
    return;
  }

  // ---- ADMIN: BROADCAST ----
  if (isAdmin(userId) && state.step === 'admin_broadcast') {
    await db.clearUserState(userId);
    const users = await db.getAllUsers();
    let sent = 0, fail = 0;
    await bot.sendMessage(chatId, `⏳ ${users.length} ta foydalanuvchiga yuborilmoqda...`);
    for (const u of users) {
      try { await bot.sendMessage(u.user_id, text, { parse_mode: 'HTML' }); sent++; }
      catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    return bot.sendMessage(chatId, `✅ Yuborildi!\n✅ ${sent} ta\n❌ ${fail} ta`);
  }

  const ok = await checkSub(bot, userId);
  if (!ok) return;

  // ---- HAVOLA ----
  if (state.step === 'waiting_link') {
    if (!text.startsWith('http://') && !text.startsWith('https://'))
      return bot.sendMessage(chatId, `❌ Noto'g'ri havola! http:// yoki https:// bilan boshlang.`);
    await db.setUserState(userId, { ...state, step: 'waiting_quantity', link: text });
    const all = await smm.getAllServices();
    const svc = all.find(s => String(s.service) === state.serviceId);
    return bot.sendMessage(chatId,
      `✅ Havola qabul qilindi!\n\n📊 Min: <b>${svc.min}</b> | Max: <b>${svc.max}</b>\n\nMiqdorni kiriting:`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]] } }
    );
  }

  // ---- MIQDOR ----
  if (state.step === 'waiting_quantity') {
    const qty = parseInt(text);
    if (isNaN(qty) || qty <= 0) return bot.sendMessage(chatId, `❌ Raqam kiriting.`);
    const all = await smm.getAllServices();
    const svc = all.find(s => String(s.service) === state.serviceId);
    if (qty < parseInt(svc.min) || qty > parseInt(svc.max))
      return bot.sendMessage(chatId, `❌ ${svc.min} — ${svc.max} oralig'ida bo'lishi kerak!`);
    const cost = Math.ceil((qty / 1000) * parseFloat(svc.rate));
    const bal  = await db.getUserBalance(userId);
    await db.setUserState(userId, { ...state, step: 'confirm_order', quantity: qty, cost });
    return bot.sendMessage(chatId,
      `🛒 <b>Tasdiqlang</b>\n\n📌 ${svc.name}\n🔗 <code>${state.link}</code>\n📊 ${qty.toLocaleString()} ta\n💰 ${cost.toLocaleString()} so'm\n💳 Balans: ${bal.toLocaleString()} so'm\n${bal < cost ? '❌ <b>Balans yetarli emas!</b>' : '✅ Balans yetarli'}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: bal >= cost ? [
        [{ text: '✅ Tasdiqlash', callback_data: 'confirm_order' }, { text: '❌ Bekor', callback_data: 'main_menu' }]
      ] : [
        [{ text: '💰 Balans to\'ldirish', callback_data: 'top_up' }],
        [{ text: '❌ Bekor', callback_data: 'main_menu' }]
      ]}}
    );
  }

  // ---- TO'LOV MIQDORI ----
  if (state.step === 'waiting_amount') {
    const amount = parseInt(text.replace(/\s|,/g, ''));
    if (isNaN(amount) || amount < 5000) return bot.sendMessage(chatId, `❌ Minimum 5,000 so'm!`);
    await sendPayment(bot, chatId, userId, amount, state.payMethod);
  }
});

console.log('🚀 Bot ishga tushdi...');
