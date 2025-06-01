import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
 console.error("❌ BOT_TOKEN must be defined in .env");
 process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });
const userStates = new Map();

console.log("🤖 Bot is running...");

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

// Helper: Get group members
const getGroupMembers = async (chatId) => {
 try {
  const members = await bot.getChatMembersCount(chatId);
  return members;
 } catch (err) {
  console.error("⚠️ Could not fetch group members:", err.message);
  return 0;
 }
};

// /start command
bot.onText(/\/start/, (msg) => {
 const chatId = msg.chat.id;
 bot.sendMessage(chatId, "👋 Welcome! Use /send to start sending messages to group members.");
});

// /send command - start the message sending process
bot.onText(/\/send/, async (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;

 // Reset user state
 userStates.set(userId, {
  step: 'waiting_for_group_id',
  messageText: null,
  selectedGroup: null,
  selectedMembers: new Set()
 });

 bot.sendMessage(chatId, "📝 Please enter the group ID where you want to send messages:");
});

// Handle all messages
bot.on('message', async (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;
 const userState = userStates.get(userId);

 if (!userState) return;

 switch (userState.step) {
  case 'waiting_for_group_id':
   const groupId = msg.text;
   try {
    // Verify if user is admin of the group
    const isAdmin = await isUserGroupAdmin(groupId, userId);
    if (!isAdmin) {
     bot.sendMessage(chatId, "⛔ You must be an admin of the group to use this feature.");
     userStates.delete(userId);
     return;
    }

    // Get group members
    const memberCount = await getGroupMembers(groupId);
    if (memberCount === 0) {
     bot.sendMessage(chatId, "⚠️ Could not fetch group members. Please check the group ID.");
     userStates.delete(userId);
     return;
    }

    userState.selectedGroup = groupId;
    userState.step = 'waiting_for_message';
    bot.sendMessage(chatId, "📝 Now, please enter the message you want to send:");
   } catch (err) {
    bot.sendMessage(chatId, "⚠️ Invalid group ID or error occurred. Please try again.");
    userStates.delete(userId);
   }
   break;

  case 'waiting_for_message':
   userState.messageText = msg.text;
   userState.step = 'selecting_members';

   // Get group members and create inline keyboard
   try {
    const members = await bot.getChatAdministrators(userState.selectedGroup);
    const inlineKeyboard = members.map(member => [{
     text: `${member.user.first_name} (${member.user.username || 'No username'})`,
     callback_data: `select_${member.user.id}`
    }]);

    bot.sendMessage(chatId, "👥 Select the members to send the message to:", {
     reply_markup: {
      inline_keyboard: inlineKeyboard
     }
    });
   } catch (err) {
    bot.sendMessage(chatId, "⚠️ Error fetching group members. Please try again.");
    userStates.delete(userId);
   }
   break;
 }
});

// Handle button clicks for member selection
bot.on('callback_query', async (callbackQuery) => {
 const data = callbackQuery.data;
 const userId = callbackQuery.from.id;
 const userState = userStates.get(userId);

 if (!userState || !data.startsWith('select_')) return;

 const selectedMemberId = data.split('_')[1];
 userState.selectedMembers.add(selectedMemberId);

 // Send confirmation
 await bot.answerCallbackQuery(callbackQuery.id, {
  text: "✅ Member selected! Click 'Send Message' when done selecting.",
  show_alert: true
 });

 // Add a "Send Message" button if not already present
 if (!userState.sentConfirmationButton) {
  await bot.editMessageReplyMarkup({
   inline_keyboard: [
    ...callbackQuery.message.reply_markup.inline_keyboard,
    [{ text: "📤 Send Message", callback_data: "send_message" }]
   ]
  }, {
   chat_id: callbackQuery.message.chat.id,
   message_id: callbackQuery.message.message_id
  });
  userState.sentConfirmationButton = true;
 }
});

// Handle final message sending
bot.on('callback_query', async (callbackQuery) => {
 const data = callbackQuery.data;
 const userId = callbackQuery.from.id;
 const userState = userStates.get(userId);

 if (!userState || data !== 'send_message') return;

 if (userState.selectedMembers.size === 0) {
  await bot.answerCallbackQuery(callbackQuery.id, {
   text: "⚠️ Please select at least one member!",
   show_alert: true
  });
  return;
 }

 // Send messages to selected members
 let successCount = 0;
 let failCount = 0;

 for (const memberId of userState.selectedMembers) {
  try {
   await bot.sendMessage(memberId, userState.messageText);
   successCount++;
  } catch (err) {
   console.error(`Failed to send message to ${memberId}:`, err.message);
   failCount++;
  }
 }

 // Send final report
 await bot.sendMessage(callbackQuery.message.chat.id,
  `📊 Message sending complete:\n✅ Successfully sent: ${successCount}\n❌ Failed: ${failCount}`
 );

 // Clean up
 userStates.delete(userId);
});
