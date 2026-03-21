// telegram-alert.ts
// Utility to send Telegram alerts via Bot API
// Usage: import and call sendTelegramAlert(message)

/**
 * Sends a message to a Telegram chat using a bot.
 *
 * @param {string} message - The message to send
 * @param {string} [botToken] - Optional: Telegram bot token (default: from env)
 * @param {string} [chatId] - Optional: Telegram chat ID (default: from env)
 * @returns {Promise<boolean>} - True if sent, false if error
 */
export async function sendTelegramAlert(
  message: string,
  botToken?: string,
  chatId?: string
): Promise<boolean> {
  // Use environment variables if not provided
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error('Telegram bot token or chat ID missing');
    return false;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Telegram API error:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Telegram alert failed:', e);
    return false;
  }
}
