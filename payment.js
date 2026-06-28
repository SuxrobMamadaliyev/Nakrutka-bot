/**
 * Click va Payme to'lov handleri
 * Telegram Stars orqali yoki to'lov havolasi yuborish
 */

const db = require('./database');

/**
 * To'lov havolasi yaratish va yuborish
 */
async function handlePayment(bot, chatId, userId, amount, method) {
  // To'lovni bazaga saqlash
  const paymentId = db.savePayment(userId, amount, method, `${method}_${Date.now()}`);

  if (method === 'Click') {
    const clickLink = generateClickLink(amount, paymentId, userId);
    await bot.sendMessage(chatId,
      `💳 <b>Click orqali to'lov</b>\n\n` +
      `💰 Miqdor: <b>${amount.toLocaleString()} so'm</b>\n` +
      `🔢 To'lov ID: <b>${paymentId}</b>\n\n` +
      `👇 Quyidagi tugmani bosing va to'lovni amalga oshiring.\n` +
      `To'lovdan keyin admin tasdiqlashi bilan balansingiz to'ldiriladi.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Click orqali to\'lash', url: clickLink }],
            [{ text: '✅ To\'ladim', callback_data: `paid_${paymentId}` }],
            [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  } else if (method === 'Payme') {
    const paymeLink = generatePaymeLink(amount, paymentId, userId);
    await bot.sendMessage(chatId,
      `💳 <b>Payme orqali to'lov</b>\n\n` +
      `💰 Miqdor: <b>${amount.toLocaleString()} so'm</b>\n` +
      `🔢 To'lov ID: <b>${paymentId}</b>\n\n` +
      `👇 Quyidagi tugmani bosing va to'lovni amalga oshiring.\n` +
      `To'lovdan keyin admin tasdiqlashi bilan balansingiz to'ldiriladi.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Payme orqali to\'lash', url: paymeLink }],
            [{ text: '✅ To\'ladim', callback_data: `paid_${paymentId}` }],
            [{ text: '🏠 Bosh menyu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }

  // Adminga xabar yuborish
  const adminId = process.env.ADMIN_ID;
  if (adminId) {
    const user = db.getUser(userId);
    await bot.sendMessage(adminId,
      `💰 <b>Yangi to'lov so'rovi</b>\n\n` +
      `👤 Foydalanuvchi: @${user?.username || userId} (${userId})\n` +
      `💳 Usul: ${method}\n` +
      `💰 Miqdor: ${amount.toLocaleString()} so'm\n` +
      `🔢 To'lov ID: ${paymentId}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Tasdiqlash', callback_data: `admin_confirm_pay_${paymentId}_${userId}_${amount}` },
              { text: '❌ Rad etish', callback_data: `admin_reject_pay_${paymentId}_${userId}` }
            ]
          ]
        }
      }
    );
  }
}

/**
 * Click to'lov havolasi
 * O'z merchant ID va service ID ni qo'shing
 */
function generateClickLink(amount, paymentId, userId) {
  const merchantId = process.env.CLICK_MERCHANT_ID || 'YOUR_MERCHANT_ID';
  const serviceId = process.env.CLICK_SERVICE_ID || 'YOUR_SERVICE_ID';
  const amountTiyin = amount; // so'm
  return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${amountTiyin}&transaction_param=${paymentId}&return_url=https://t.me/${process.env.BOT_USERNAME}`;
}

/**
 * Payme to'lov havolasi
 * O'z merchant ID ni qo'shing
 */
function generatePaymeLink(amount, paymentId, userId) {
  const merchantId = process.env.PAYME_MERCHANT_ID || 'YOUR_MERCHANT_ID';
  const amountTiyin = amount * 100; // tiyin
  const params = Buffer.from(
    JSON.stringify({ m: merchantId, ac: { order_id: paymentId }, a: amountTiyin })
  ).toString('base64');
  return `https://checkout.paycom.uz/${params}`;
}

function handlePreCheckout(bot, query) {
  bot.answerPreCheckoutQuery(query.id, true);
}

async function handleSuccessfulPayment(bot, msg) {
  const userId = msg.from.id;
  const amount = msg.successful_payment.total_amount / 100;
  await db.addBalance(userId, amount);
  await bot.sendMessage(msg.chat.id,
    `✅ <b>To'lov muvaffaqiyatli!</b>\n\n` +
    `💰 Balansingizga <b>${amount.toLocaleString()} so'm</b> qo'shildi.`,
    { parse_mode: 'HTML' }
  );
}

module.exports = { handlePayment, handlePreCheckout, handleSuccessfulPayment };
