/**
 * Majburiy obuna tekshirish
 */

const REQUIRED_CHANNELS = process.env.REQUIRED_CHANNELS
  ? process.env.REQUIRED_CHANNELS.split(',').map(c => c.trim())
  : []; // Misol: '@mening_kanalim,@boshqa_kanal'

async function checkSubscription(bot, userId) {
  if (!REQUIRED_CHANNELS.length) return true;

  for (const channel of REQUIRED_CHANNELS) {
    try {
      const member = await bot.getChatMember(channel, userId);
      if (['left', 'kicked'].includes(member.status)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function subscriptionKeyboard(userId) {
  const buttons = REQUIRED_CHANNELS.map(channel => ([{
    text: `📢 ${channel}`,
    url: `https://t.me/${channel.replace('@', '')}`
  }]));

  buttons.push([{ text: '✅ Tekshirish', callback_data: 'check_sub' }]);

  return { inline_keyboard: buttons };
}

module.exports = { checkSubscription, subscriptionKeyboard };
