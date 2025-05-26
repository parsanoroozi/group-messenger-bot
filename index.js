import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
 console.error("❌ BOT_TOKEN must be defined in .env");
 process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });
const knownUsers = new Map();

console.log("🤖 Bot is running...");

// Store users who interact with the bot
bot.on('message', (msg) => {
 if (!msg.from || knownUsers.has(msg.from.id)) return;

 knownUsers.set(msg.from.id, {
  username: msg.from.username,
  first_name: msg.from.first_name
 });

 console.log(`🆕 New user: ${msg.from.first_name} (${msg.from.id})`);
});

// Helper: Check if user is an admin of a group
const isUserGroupAdmin = async (chatId, userId) => {
 try {
  const admins = await bot.getChatAdministrators(chatId);
  return admins.some(admin => admin.user.id === userId);
 } catch (err) {
  console.error("⚠️ Could not fetch admins:", err.message);
  return false;
 }
};

// /startmsg command — send to selected users
bot.onText(/\/startmsg/, async (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;

 const isGroup = chatId < 0;
 let isAdmin = true;

 if (isGroup) {
  isAdmin = await isUserGroupAdmin(chatId, userId);
 }

 if (!isAdmin) {
  return bot.sendMessage(chatId, "⛔ Only group admins can use this command.");
 }

 bot.sendMessage(chatId, "📝 Please send the message you'd like to broadcast:");

 bot.once('message', (reply) => {
  if (reply.from.id !== userId) return;
  const messageText = reply.text;
  showUserSelection(chatId, messageText);
 });
});

// Show inline keyboard of known users
function showUserSelection(chatId, messageText) {
 if (knownUsers.size === 0) {
  return bot.sendMessage(chatId, "⚠️ No known users available.");
 }

 const inlineKeyboard = [];

 for (const [userId, user] of knownUsers.entries()) {
  const label = user.first_name || user.username || `ID ${userId}`;
  const encodedMessage = Buffer.from(messageText).toString('base64');
  const callbackData = `sendto_${userId}_${encodedMessage}`;
  inlineKeyboard.push([{ text: label, callback_data: callbackData }]);
 }

 bot.sendMessage(chatId, "👤 Select user(s) to send the message to:", {
  reply_markup: {
   inline_keyboard: inlineKeyboard
  }
 });
}

// Handle button click
bot.on('callback_query', async (callbackQuery) => {
 const data = callbackQuery.data;

 if (!data.startsWith("sendto_")) return;

 const [, userId, encodedMessage] = data.split("_");
 const messageText = Buffer.from(encodedMessage, 'base64').toString();

 try {
  await bot.sendMessage(userId, messageText);
  await bot.answerCallbackQuery(callbackQuery.id, { text: "✅ Message sent!" });
 } catch (err) {
  console.error("❌ Failed to send message:", err.message);
  await bot.answerCallbackQuery(callbackQuery.id, { text: "❌ Failed to send." });
 }
});
