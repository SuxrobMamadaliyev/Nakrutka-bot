/**
 * Admin Panel
 */

const db = require('./database');
const { seenSMS } = require('./seensms');

const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
  : [parseInt(process.env.ADMIN_ID)];

function isAdmin(userId) {
  return ADMIN_IDS.includes(parseInt(userId));
}

async function adminPanel(bot, query) {
  const chatId = query.message.chat.id;
  const stats = await db.getStats();
  const apiBalance = await seenSMS.getBalance().catch(() => ({ balance: '?', currency: 'UZS' }));

  await bot.editMessageText(
    `🔧 <b>Admin Panel</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${stats.users}</b>\n` +
    `🛒 Buyurtmalar: <b>${stats.orders}</b>\n` +
    `💰 Aylanma: <b>${stats.revenue?.toLocaleString()} so'm</b>\n` +
    `📅 Bugun: <b>${stats.today_orders}</b> buyurtma\n` +
    `🔑 API Balans: <b>${apiBalance.balance} ${apiBalance.currency}</b>`,
    {
      chat_id: chatId,
      message_id: query.message.message_id,
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
            { text: '📊 Statistika', callback_data: 'admin_stats' },
            { text: '⚙️ Sozlamalar', callback_data: 'admin_settings' }
          ],
          [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
        ]
      }
    }
  );
}

async function handleAdminCallback(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (!isAdmin(userId)) return;

  // ---- TO'LOV TASDIQLASH ----
  if (data.startsWith('admin_confirm_pay_')) {
    const parts = data.split('_');
    const paymentId = parts[3];
    const targetUserId = parts[4];
    const amount = parseFloat(parts[5]);

    db.updatePaymentStatus(paymentId, 'confirmed');
    db.addBalance(targetUserId, amount);

    await bot.editMessageText(
      `✅ To'lov tasdiqlandi!\n💰 ${amount.toLocaleString()} so'm | User: ${targetUserId}`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    await bot.sendMessage(targetUserId,
      `✅ <b>To'lovingiz tasdiqlandi!</b>\n\n` +
      `💰 Balansingizga <b>${amount.toLocaleString()} so'm</b> qo'shildi.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
    return;
  }

  if (data.startsWith('admin_reject_pay_')) {
    const parts = data.split('_');
    const paymentId = parts[3];
    const targetUserId = parts[4];

    db.updatePaymentStatus(paymentId, 'rejected');

    await bot.editMessageText(
      `❌ To'lov rad etildi. User: ${targetUserId}`,
      { chat_id: chatId, message_id: query.message.message_id }
    );

    await bot.sendMessage(targetUserId,
      `❌ Afsuski, to'lovingiz tasdiqlanmadi.\nBatafsil ma'lumot uchun adminga murojaat qiling.`
    ).catch(() => {});
    return;
  }

  switch (data) {

    // ---- FOYDALANUVCHILAR ----
    case 'admin_users': {
      const stats = db.getStats();
      const recentUsers = db.getAllUsers().slice(-10);
      await bot.editMessageText(
        `👥 <b>Foydalanuvchilar</b>\n\n` +
        `Jami: <b>${stats.users}</b> ta\n` +
        `So'nggi ro'yxatdan o'tganlar: <b>${recentUsers.length}</b>`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '◀️ Admin panelga', callback_data: 'admin_panel' }]
            ]
          }
        }
      );
      break;
    }

    // ---- BUYURTMALAR ----
    case 'admin_orders': {
      const orders = db.getAllOrders(10);
      let text = `🛒 <b>So'nggi 10 ta buyurtma:</b>\n\n`;
      for (const o of orders) {
        text += `#${o.api_order_id} | @${o.username || o.user_id}\n`;
        text += `  ${o.service_name} | ${o.quantity} | ${o.cost.toLocaleString()} so'm\n`;
        text += `  ${new Date(o.created_at).toLocaleString('uz-UZ')}\n\n`;
      }
      await bot.editMessageText(text || 'Buyurtmalar yo\'q', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Admin panelga', callback_data: 'admin_panel' }]]
        }
      });
      break;
    }

    // ---- BALANS QO'SHISH ----
    case 'admin_add_balance': {
      await db.setUserState(userId, { step: 'admin_add_balance_id' });
      await bot.editMessageText(
        `💰 <b>Balans qo'shish</b>\n\nFoydalanuvchi ID ni kiriting:`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'admin_panel' }]]
          }
        }
      );
      break;
    }

    // ---- BROADCAST ----
    case 'admin_broadcast': {
      await db.setUserState(userId, { step: 'admin_broadcast' });
      await bot.editMessageText(
        `📢 <b>Xabar yuborish</b>\n\nBarcha foydalanuvchilarga yuboriladigan xabarni yozing:`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'admin_panel' }]]
          }
        }
      );
      break;
    }

    // ---- STATISTIKA ----
    case 'admin_stats': {
      const stats = db.getStats();
      const apiBal = await seenSMS.getBalance().catch(() => ({ balance: '?', currency: 'UZS' }));
      await bot.editMessageText(
        `📊 <b>Statistika</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${stats.users}</b>\n` +
        `🛒 Jami buyurtmalar: <b>${stats.orders}</b>\n` +
        `💰 Jami aylanma: <b>${stats.revenue?.toLocaleString()} so'm</b>\n` +
        `📅 Bugungi buyurtmalar: <b>${stats.today_orders}</b>\n\n` +
        `🔑 SeenSMS API Balans: <b>${apiBal.balance} ${apiBal.currency}</b>`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Yangilash', callback_data: 'admin_stats' }],
              [{ text: '◀️ Admin panelga', callback_data: 'admin_panel' }]
            ]
          }
        }
      );
      break;
    }

    // ---- SOZLAMALAR ----
    case 'admin_settings': {
      const channels = process.env.REQUIRED_CHANNELS || 'Yo\'q';
      await bot.editMessageText(
        `⚙️ <b>Sozlamalar</b>\n\n` +
        `📢 Majburiy kanallar: <code>${channels}</code>\n\n` +
        `<i>Sozlamalarni o'zgartirish uchun .env faylini tahrirlang va botni qayta ishga tushiring.</i>`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '◀️ Admin panelga', callback_data: 'admin_panel' }]]
          }
        }
      );
      break;
    }

    case 'admin_panel': {
      await adminPanel(bot, query);
      break;
    }
  }
}

// Admin matnli xabarlar (broadcast, balans qo'shish)
async function handleAdminMessage(bot, msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!isAdmin(userId) || !text || text.startsWith('/')) return false;

  const state = await require('./database').getUserState(userId);
  if (!state) return false;

  // ---- ADMIN: BALANS QO'SHISH - ID ----
  if (state.step === 'admin_add_balance_id') {
    const targetId = parseInt(text);
    if (isNaN(targetId)) {
      await bot.sendMessage(chatId, '❌ Noto\'g\'ri ID!');
      return true;
    }
    await db.setUserState(userId, { step: 'admin_add_balance_amount', targetId });
    await bot.sendMessage(chatId, `Miqdorni kiriting (so'mda):`);
    return true;
  }

  // ---- ADMIN: BALANS QO'SHISH - MIQDOR ----
  if (state.step === 'admin_add_balance_amount') {
    const amount = parseFloat(text.replace(/\s/g, '').replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) {
      await bot.sendMessage(chatId, '❌ Noto\'g\'ri miqdor!');
      return true;
    }
    db.addBalance(state.targetId, amount);
    await db.clearUserState(userId);

    await bot.sendMessage(chatId,
      `✅ <b>${state.targetId}</b> ga <b>${amount.toLocaleString()} so'm</b> qo'shildi!`,
      { parse_mode: 'HTML' }
    );
    await bot.sendMessage(state.targetId,
      `✅ Balansingizga <b>${amount.toLocaleString()} so'm</b> qo'shildi!`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
    return true;
  }

  // ---- ADMIN: BROADCAST ----
  if (state.step === 'admin_broadcast') {
    await db.clearUserState(userId);
    const users = db.getAllUsers();
    let sent = 0, failed = 0;

    await bot.sendMessage(chatId, `⏳ ${users.length} ta foydalanuvchiga yuborilmoqda...`);

    for (const user of users) {
      try {
        await bot.sendMessage(user.user_id, `📢 ${text}`, { parse_mode: 'HTML' });
        sent++;
      } catch {
        failed++;
      }
      // Spam limitiga qarshi kechikish
      await new Promise(r => setTimeout(r, 50));
    }

    await bot.sendMessage(chatId,
      `✅ Xabar yuborildi!\n✅ Muvaffaqiyatli: ${sent}\n❌ Muvaffaqiyatsiz: ${failed}`
    );
    return true;
  }

  return false;
}

module.exports = { isAdmin, adminPanel, handleAdminCallback, handleAdminMessage };
