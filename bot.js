/**
 * SeenSMS Nakrutka Telegram Bot
 * 
 * O'rnatish:
 *   npm install node-telegram-bot-api axios dotenv
 * 
 * Ishlatish:
 *   node bot.js
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const db = require('./database');
const { seenSMS } = require('./seensms');
const { isAdmin, adminPanel, handleAdminCallback } = require('./admin');
const { checkSubscription, subscriptionKeyboard } = require('./subscription');
const { handlePayment, handlePreCheckout, handleSuccessfulPayment } = require('./payment');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ============================================================
// START
// ============================================================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;

  // Foydalanuvchini bazaga qo'shish
  await db.addUser(userId, username, msg.from.first_name);

  // Majburiy obuna tekshirish
  const subscribed = await checkSubscription(bot, userId);
  if (!subscribed) {
    return bot.sendMessage(chatId,
      `👋 Salom, <b>${msg.from.first_name}</b>!\n\n` +
      `✅ Botdan foydalanish uchun quyidagi kanallarga obuna bo'ling:`,
      {
        parse_mode: 'HTML',
        reply_markup: await subscriptionKeyboard(userId)
      }
    );
  }

  await sendMainMenu(bot, chatId, msg.from.first_name);
});

// ============================================================
// ASOSIY MENYU
// ============================================================
async function sendMainMenu(bot, chatId, name) {
  const balance = await db.getUserBalance(chatId);

  await bot.sendMessage(chatId,
    `🏠 <b>Asosiy menyu</b>\n\n` +
    `👤 Foydalanuvchi: <b>${name}</b>\n` +
    `💰 Balans: <b>${balance.toLocaleString()} so'm</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🛒 Buyurtma berish', callback_data: 'order_menu' },
            { text: '📊 Mening buyurtmalarim', callback_data: 'my_orders' }
          ],
          [
            { text: '💰 Balans to\'ldirish', callback_data: 'top_up' },
            { text: '👤 Profil', callback_data: 'profile' }
          ],
          [
            { text: '📋 Xizmatlar', callback_data: 'services_menu' },
            { text: '💬 Yordam', callback_data: 'support' }
          ]
        ]
      }
    }
  );
}

// ============================================================
// CALLBACK HANDLER
// ============================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  // Majburiy obuna tekshirish
  if (data !== 'check_sub') {
    const subscribed = await checkSubscription(bot, userId);
    if (!subscribed) {
      return bot.sendMessage(chatId,
        `⚠️ Botdan foydalanish uchun avval kanallarga obuna bo'ling!`,
        {
          reply_markup: await subscriptionKeyboard(userId)
        }
      );
    }
  }

  // Admin callback
  if (data.startsWith('admin_')) {
    return handleAdminCallback(bot, query);
  }

  switch (data) {

    // ---- OBUNA TEKSHIRISH ----
    case 'check_sub': {
      const subscribed = await checkSubscription(bot, userId);
      if (subscribed) {
        await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
        await sendMainMenu(bot, chatId, query.from.first_name);
      } else {
        await bot.answerCallbackQuery(query.id, { text: '❌ Hali obuna bo\'lmadingiz!', show_alert: true });
      }
      break;
    }

    // ---- ASOSIY MENYU ----
    case 'main_menu': {
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await sendMainMenu(bot, chatId, query.from.first_name);
      break;
    }

    // ---- XIZMATLAR MENYUSI ----
    case 'services_menu': {
      const categories = await seenSMS.getCategories();
      const keyboard = categories.map(cat => ([{
        text: `${getCategoryEmoji(cat)} ${cat}`,
        callback_data: `cat_${cat}`
      }]));
      keyboard.push([{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]);

      await bot.editMessageText(
        `📋 <b>Xizmatlar kategoriyalari</b>\n\nKerakli kategoriyani tanlang:`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
      break;
    }

    // ---- KATEGORIYA ----
    default: {
      if (data.startsWith('cat_')) {
        const category = data.replace('cat_', '');
        const services = await seenSMS.getServicesByCategory(category);

        const keyboard = services.slice(0, 10).map(s => ([{
          text: `${s.name} | ${s.rate} so'm/1000`,
          callback_data: `svc_${s.service}`
        }]));
        keyboard.push([
          { text: '◀️ Orqaga', callback_data: 'services_menu' },
          { text: '🏠 Bosh menyu', callback_data: 'main_menu' }
        ]);

        await bot.editMessageText(
          `📋 <b>${category}</b>\n\nXizmatni tanlang:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
          }
        );
        break;
      }

      if (data.startsWith('svc_')) {
        const serviceId = data.replace('svc_', '');
        const services = await seenSMS.getAllServices();
        const service = services.find(s => String(s.service) === String(serviceId));

        if (!service) return;

        await db.setUserState(userId, { step: 'waiting_link', serviceId });

        await bot.editMessageText(
          `🛒 <b>${service.name}</b>\n\n` +
          `💰 Narx: <b>${service.rate} so'm/1000</b>\n` +
          `📊 Min: <b>${service.min}</b> | Max: <b>${service.max}</b>\n\n` +
          `🔗 Endi havola (link) yuboring:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]]
            }
          }
        );
        break;
      }

      // ---- BUYURTMA MENYUSI ----
      if (data === 'order_menu') {
        await bot.editMessageText(
          `🛒 <b>Buyurtma berish</b>\n\nIjtimoiy tarmoqni tanlang:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📸 Instagram', callback_data: 'cat_Instagram' },
                  { text: '📱 TikTok', callback_data: 'cat_TikTok' }
                ],
                [
                  { text: '✈️ Telegram', callback_data: 'cat_Telegram' },
                  { text: '▶️ YouTube', callback_data: 'cat_YouTube' }
                ],
                [
                  { text: '👍 Facebook', callback_data: 'cat_Facebook' },
                  { text: '🐦 Twitter/X', callback_data: 'cat_Twitter' }
                ],
                [
                  { text: '📋 Barcha xizmatlar', callback_data: 'services_menu' }
                ],
                [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        break;
      }

      // ---- MENING BUYURTMALARIM ----
      if (data === 'my_orders') {
        const orders = await db.getUserOrders(userId, 5);
        if (!orders.length) {
          await bot.editMessageText(
            `📊 <b>Mening buyurtmalarim</b>\n\n❌ Hali buyurtma bermagansiz.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🛒 Buyurtma berish', callback_data: 'order_menu' }],
                  [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
                ]
              }
            }
          );
          break;
        }

        // Har bir buyurtma holatini API dan tekshirish
        const orderIds = orders.map(o => o.api_order_id).filter(Boolean);
        let statuses = {};
        if (orderIds.length) {
          statuses = await seenSMS.checkMultipleOrders(orderIds);
        }

        let text = `📊 <b>So'nggi 5 ta buyurtma:</b>\n\n`;
        for (const order of orders) {
          const st = statuses[order.api_order_id] || {};
          const statusEmoji = getStatusEmoji(st.status || order.status);
          text += `${statusEmoji} <b>#${order.api_order_id || order.id}</b>\n`;
          text += `   Xizmat: ${order.service_name}\n`;
          text += `   Miqdor: ${order.quantity}\n`;
          text += `   Holat: ${st.status || order.status}\n`;
          if (st.remains) text += `   Qolgan: ${st.remains}\n`;
          text += `\n`;
        }

        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Yangilash', callback_data: 'my_orders' }],
              [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
            ]
          }
        });
        break;
      }

      // ---- BALANS TO'LDIRISH ----
      if (data === 'top_up') {
        await bot.editMessageText(
          `💰 <b>Balans to'ldirish</b>\n\nTo'lov tizimini tanlang:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Click', callback_data: 'pay_click' },
                  { text: '💳 Payme', callback_data: 'pay_payme' }
                ],
                [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        break;
      }

      if (data === 'pay_click' || data === 'pay_payme') {
        const method = data === 'pay_click' ? 'Click' : 'Payme';
        await db.setUserState(userId, { step: 'waiting_amount', payMethod: method });
        await bot.editMessageText(
          `💰 <b>${method} orqali to'lov</b>\n\n` +
          `Minimum: <b>5,000 so'm</b>\n` +
          `Maximum: <b>10,000,000 so'm</b>\n\n` +
          `Qancha so'm to'ldirmoqchisiz? (raqam yuboring):`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '10,000', callback_data: 'amt_10000' },
                  { text: '25,000', callback_data: 'amt_25000' },
                  { text: '50,000', callback_data: 'amt_50000' }
                ],
                [
                  { text: '100,000', callback_data: 'amt_100000' },
                  { text: '250,000', callback_data: 'amt_250000' },
                  { text: '500,000', callback_data: 'amt_500000' }
                ],
                [{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        break;
      }

      if (data.startsWith('amt_')) {
        const amount = parseInt(data.replace('amt_', ''));
        const state = await db.getUserState(userId);
        const method = state?.payMethod || 'Click';
        await handlePayment(bot, chatId, userId, amount, method);
        break;
      }

      // ---- PROFIL ----
      if (data === 'profile') {
        const user = await db.getUser(userId);
        const orders = await db.getUserOrdersCount(userId);
        const spent = await db.getUserTotalSpent(userId);

        await bot.editMessageText(
          `👤 <b>Profil</b>\n\n` +
          `🆔 ID: <code>${userId}</code>\n` +
          `👤 Ism: <b>${user.first_name}</b>\n` +
          `📅 Ro'yxatdan o'tgan: <b>${new Date(user.created_at).toLocaleDateString('uz-UZ')}</b>\n` +
          `💰 Balans: <b>${user.balance.toLocaleString()} so'm</b>\n` +
          `🛒 Jami buyurtmalar: <b>${orders}</b>\n` +
          `💸 Jami sarflangan: <b>${spent.toLocaleString()} so'm</b>`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Balans to\'ldirish', callback_data: 'top_up' }],
                [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        break;
      }

      // ---- YORDAM ----
      if (data === 'support') {
        await bot.editMessageText(
          `💬 <b>Yordam</b>\n\n` +
          `❓ Savol yoki muammo bo'lsa:\n\n` +
          `👤 Admin: @${process.env.ADMIN_USERNAME}\n` +
          `⏰ Ish vaqti: 09:00 - 22:00`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📩 Adminga yozish', url: `https://t.me/${process.env.ADMIN_USERNAME}` }],
                [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
              ]
            }
          }
        );
        break;
      }

      // ---- ADMIN ----
      if (data === 'admin' && isAdmin(userId)) {
        await adminPanel(bot, query);
        break;
      }
    }
  }
});

// ============================================================
// MATN XABARLARI (link va miqdor kiritish)
// ============================================================
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const subscribed = await checkSubscription(bot, userId);
  if (!subscribed) return;

  const state = await db.getUserState(userId);
  if (!state) return;

  // ---- HAVOLA KUTILMOQDA ----
  if (state.step === 'waiting_link') {
    if (!text.startsWith('http://') && !text.startsWith('https://')) {
      return bot.sendMessage(chatId, `❌ Noto'g'ri havola! http:// yoki https:// bilan boshlang.`);
    }

    await db.setUserState(userId, { ...state, step: 'waiting_quantity', link: text });

    const services = await seenSMS.getAllServices();
    const service = services.find(s => String(s.service) === String(state.serviceId));

    await bot.sendMessage(chatId,
      `✅ Havola qabul qilindi!\n\n` +
      `📊 Min: <b>${service.min}</b> | Max: <b>${service.max}</b>\n\n` +
      `Miqdorni kiriting:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]]
        }
      }
    );
    return;
  }

  // ---- MIQDOR KUTILMOQDA ----
  if (state.step === 'waiting_quantity') {
    const quantity = parseInt(text);
    if (isNaN(quantity) || quantity <= 0) {
      return bot.sendMessage(chatId, `❌ Noto'g'ri miqdor! Raqam kiriting.`);
    }

    const services = await seenSMS.getAllServices();
    const service = services.find(s => String(s.service) === String(state.serviceId));

    if (quantity < parseInt(service.min) || quantity > parseInt(service.max)) {
      return bot.sendMessage(chatId,
        `❌ Miqdor ${service.min} dan ${service.max} gacha bo'lishi kerak!`
      );
    }

    const cost = Math.ceil((quantity / 1000) * parseFloat(service.rate));
    const userBalance = await db.getUserBalance(userId);

    await db.setUserState(userId, { ...state, step: 'confirm_order', quantity, cost });

    await bot.sendMessage(chatId,
      `🛒 <b>Buyurtmani tasdiqlang</b>\n\n` +
      `📌 Xizmat: <b>${service.name}</b>\n` +
      `🔗 Havola: <code>${state.link}</code>\n` +
      `📊 Miqdor: <b>${quantity.toLocaleString()}</b>\n` +
      `💰 Narx: <b>${cost.toLocaleString()} so'm</b>\n` +
      `💳 Balans: <b>${userBalance.toLocaleString()} so'm</b>\n` +
      `${userBalance < cost ? '❌ <b>Balans yetarli emas!</b>' : '✅ Balans yetarli'}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: userBalance >= cost ? [
            [
              { text: '✅ Tasdiqlash', callback_data: 'confirm_order' },
              { text: '❌ Bekor qilish', callback_data: 'main_menu' }
            ]
          ] : [
            [{ text: '💰 Balans to\'ldirish', callback_data: 'top_up' }],
            [{ text: '❌ Bekor qilish', callback_data: 'main_menu' }]
          ]
        }
      }
    );
    return;
  }

  // ---- TO'LOV MIQDORI ----
  if (state.step === 'waiting_amount') {
    const amount = parseInt(text.replace(/\s/g, '').replace(/,/g, ''));
    if (isNaN(amount) || amount < 5000) {
      return bot.sendMessage(chatId, `❌ Minimum to'lov 5,000 so'm!`);
    }
    await handlePayment(bot, chatId, userId, amount, state.payMethod);
    return;
  }
});

// ============================================================
// BUYURTMANI TASDIQLASH CALLBACK
// ============================================================
bot.on('callback_query', async (query) => {
  if (query.data !== 'confirm_order') return;

  const userId = query.from.id;
  const chatId = query.message.chat.id;
  await bot.answerCallbackQuery(query.id);

  const state = await db.getUserState(userId);
  if (!state || state.step !== 'confirm_order') return;

  const userBalance = await db.getUserBalance(userId);
  if (userBalance < state.cost) {
    return bot.sendMessage(chatId, `❌ Balans yetarli emas!`);
  }

  // Buyurtma berish
  await bot.sendMessage(chatId, `⏳ Buyurtma berilmoqda...`);

  const result = await seenSMS.addOrder(state.serviceId, state.link, state.quantity);

  if (result.order) {
    // Balansdan ayirish
    await db.deductBalance(userId, state.cost);

    // Buyurtmani bazaga saqlash
    const services = await seenSMS.getAllServices();
    const service = services.find(s => String(s.service) === String(state.serviceId));
    await db.saveOrder(userId, result.order, state.serviceId, service?.name, state.link, state.quantity, state.cost);

    await db.clearUserState(userId);

    await bot.sendMessage(chatId,
      `✅ <b>Buyurtma muvaffaqiyatli berildi!</b>\n\n` +
      `🆔 Buyurtma ID: <b>#${result.order}</b>\n` +
      `📊 Miqdor: <b>${state.quantity.toLocaleString()}</b>\n` +
      `💰 To'landi: <b>${state.cost.toLocaleString()} so'm</b>\n` +
      `💳 Qolgan balans: <b>${(userBalance - state.cost).toLocaleString()} so'm</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 Buyurtmalarim', callback_data: 'my_orders' }],
            [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId,
      `❌ Xatolik yuz berdi: ${result.error || 'Noma\'lum xatolik'}\n\nIltimos qaytadan urinib ko'ring.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]]
        }
      }
    );
  }
});

// ============================================================
// TO'LOV HANDLERLARI
// ============================================================
bot.on('pre_checkout_query', (query) => handlePreCheckout(bot, query));
bot.on('successful_payment', (msg) => handleSuccessfulPayment(bot, msg));

// ============================================================
// ADMIN BUYRUQLARI
// ============================================================
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const chatId = msg.chat.id;

  const stats = await db.getStats();
  await bot.sendMessage(chatId,
    `🔧 <b>Admin Panel</b>\n\n` +
    `👥 Jami foydalanuvchilar: <b>${stats.users}</b>\n` +
    `🛒 Jami buyurtmalar: <b>${stats.orders}</b>\n` +
    `💰 Jami aylanma: <b>${stats.revenue?.toLocaleString()} so'm</b>\n` +
    `📅 Bugungi buyurtmalar: <b>${stats.today_orders}</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👥 Foydalanuvchilar', callback_data: 'admin_users' },
            { text: '🛒 Buyurtmalar', callback_data: 'admin_orders' }
          ],
          [
            { text: '💰 Balans qo\'shish', callback_data: 'admin_add_balance' },
            { text: '📢 Xabar yuborish', callback_data: 'admin_broadcast' }
          ],
          [
            { text: '⚙️ Sozlamalar', callback_data: 'admin_settings' },
            { text: '📊 Statistika', callback_data: 'admin_stats' }
          ]
        ]
      }
    }
  );
});

// ============================================================
// YORDAMCHI FUNKSIYALAR
// ============================================================
function getCategoryEmoji(category) {
  const emojis = {
    'Instagram': '📸', 'TikTok': '📱', 'Telegram': '✈️',
    'YouTube': '▶️', 'Facebook': '👍', 'Twitter': '🐦',
    'X': '🐦', 'VK': '💙', 'Spotify': '🎵'
  };
  for (const [key, emoji] of Object.entries(emojis)) {
    if (category.includes(key)) return emoji;
  }
  return '📌';
}

function getStatusEmoji(status) {
  const map = {
    'Pending': '⏳', 'In progress': '🔄', 'Completed': '✅',
    'Partial': '⚠️', 'Canceled': '❌', 'Processing': '🔄'
  };
  return map[status] || '📌';
}

console.log('🚀 SeenSMS Bot ishga tushdi...');
