import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

const botToken = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!botToken) {
 console.error("❌ BOT_TOKEN must be defined in .env");
 process.exit(1);
}

// Add reconnection options
const bot = new TelegramBot(botToken, {
 polling: {
  interval: 300, // Polling interval in ms
  autoStart: true,
  params: {
   timeout: 10 // Timeout in seconds
  }
 }
});

// Create a simple HTTP server
const server = http.createServer((req, res) => {
 res.writeHead(200, { 'Content-Type': 'text/plain' });
 res.end('Bot is running!');
});

// Start the server
server.listen(PORT, () => {
 console.log(`🌐 Server is running on port ${PORT}`);
 console.log("🤖 Bot is running...");
});

// Handle polling errors
bot.on('polling_error', (error) => {
 console.error('🔴 Polling error:', error.message);

 // If it's a timeout error, log it specifically
 if (error.message.includes('ETIMEDOUT')) {
  console.error('⚠️ Connection timeout. This might be due to:');
  console.error('1. Internet connection issues');
  console.error('2. Network restrictions');
  console.error('3. Telegram API server issues');
  console.error('4. Proxy settings (if any)');
 }
});

// Handle connection errors
bot.on('error', (error) => {
 console.error('🔴 Bot error:', error.message);
});

const userStates = new Map();

// Helper: Check if user is an admin of a group
const isUserGroupAdmin = async (chatId, userId) => {
 console.log(`🔍 Checking admin status for user ${userId} in group ${chatId}`);
 try {
  const admins = await bot.getChatAdministrators(chatId);
  const isAdmin = admins.some(admin => admin.user.id === userId);
  console.log(`✅ Admin check result for user ${userId}: ${isAdmin ? 'is admin' : 'is not admin'}`);
  return isAdmin;
 } catch (err) {
  console.error(`❌ Could not fetch admins for group ${chatId}:`, err.message);
  return false;
 }
};

// Helper: Get group members
const getGroupMembers = async (chatId) => {
 console.log(`👥 Fetching members for group ${chatId}`);
 try {
  const chat = await bot.getChat(chatId);
  console.log(`✅ Group ${chatId} info fetched successfully`);
  return chat.members_count || 0;
 } catch (err) {
  console.error(`❌ Could not fetch group info for ${chatId}:`, err.message);
  return 0;
 }
};

// /start command
bot.onText(/\/start/, (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;
 console.log(`👋 New user started bot: ${userId} (${msg.from.first_name})`);
 bot.sendMessage(chatId, "👋 Welcome! Use /send to start sending messages to group members.\nUse /groupid in a group to get its ID.");
});

// Add group ID command
bot.onText(/\/groupid/, (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;
 const isGroup = chatId < 0;

 console.log(`📊 Group ID request from user ${userId} in chat ${chatId}`);

 if (!isGroup) {
  console.log(`⚠️ User ${userId} tried to use /groupid in non-group chat`);
  return bot.sendMessage(chatId,
   "⚠️ This command only works in groups!\n\n" +
   "To get a group ID:\n" +
   "1. Add me to your group\n" +
   "2. Type /groupid in the group chat\n" +
   "3. I'll reply with the group ID"
  );
 }

 console.log(`✅ Sending group ID ${chatId} to user ${userId}`);
 bot.sendMessage(chatId,
  `📊 Group ID: ${chatId}\n\n` +
  `Use this ID when the bot asks for it in private chat.`
 );
});

// /send command - start the message sending process
bot.onText(/\/send/, async (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;

 console.log(`📝 User ${userId} started message sending process`);

 // Reset user state
 userStates.set(userId, {
  step: 'waiting_for_group_id',
  messageText: null,
  selectedGroup: null,
  selectedMembers: new Set()
 });

 console.log(`🔄 Set user ${userId} state to waiting_for_group_id`);
 bot.sendMessage(chatId, "📝 Please enter the group ID where you want to send messages:");
});

// Handle all messages
bot.on('message', async (msg) => {
 const chatId = msg.chat.id;
 const userId = msg.from.id;
 const userState = userStates.get(userId);

 if (!userState) return;

 console.log(`📨 Received message from user ${userId} in state: ${userState.step}`);

 switch (userState.step) {
  case 'waiting_for_group_id':
   const groupId = msg.text;
   console.log(`🔍 User ${userId} provided group ID: ${groupId}`);
   try {
    // Verify if user is admin of the group
    const isAdmin = await isUserGroupAdmin(groupId, userId);
    if (!isAdmin) {
     console.log(`⛔ User ${userId} is not admin of group ${groupId}`);
     bot.sendMessage(chatId, "⛔ You must be an admin of the group to use this feature.");
     userStates.delete(userId);
     return;
    }

    // Get group members
    const memberCount = await getGroupMembers(groupId);
    if (memberCount === 0) {
     console.log(`⚠️ Could not get member count for group ${groupId}`);
     bot.sendMessage(chatId, "⚠️ Could not fetch group members. Please check the group ID.");
     userStates.delete(userId);
     return;
    }

    userState.selectedGroup = groupId;
    userState.step = 'waiting_for_message';
    console.log(`✅ User ${userId} verified as admin, waiting for message`);
    bot.sendMessage(chatId, "📝 Now, please enter the message you want to send:");
   } catch (err) {
    console.error(`❌ Error processing group ID ${groupId} for user ${userId}:`, err.message);
    bot.sendMessage(chatId, "⚠️ Invalid group ID or error occurred. Please try again.");
    userStates.delete(userId);
   }
   break;

  case 'waiting_for_message':
   userState.messageText = msg.text;
   userState.step = 'selecting_members';
   console.log(`📝 User ${userId} provided message, fetching group members`);

   // Get group members and create inline keyboard
   try {
    const members = await bot.getChatAdministrators(userState.selectedGroup);
    console.log(`✅ Fetched ${members.length} members for group ${userState.selectedGroup}`);
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
    console.error(`❌ Error fetching group members for user ${userId}:`, err.message);
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
 console.log(`👤 User ${userId} selected member ${selectedMemberId}`);
 userState.selectedMembers.add(selectedMemberId);

 // Send confirmation
 await bot.answerCallbackQuery(callbackQuery.id, {
  text: "✅ Member selected! Click 'Send Message' when done selecting.",
  show_alert: true
 });

 // Add a "Send Message" button if not already present
 if (!userState.sentConfirmationButton) {
  console.log(`➕ Adding send button for user ${userId}`);
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

 console.log(`📤 User ${userId} initiated message sending to ${userState.selectedMembers.size} members`);

 if (userState.selectedMembers.size === 0) {
  console.log(`⚠️ User ${userId} tried to send without selecting members`);
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
   console.log(`📨 Sending message to member ${memberId}`);
   await bot.sendMessage(memberId, userState.messageText);
   successCount++;
   console.log(`✅ Successfully sent to member ${memberId}`);
  } catch (err) {
   console.error(`❌ Failed to send message to ${memberId}:`, err.message);
   failCount++;
  }
 }

 // Send final report
 console.log(`📊 Message sending complete for user ${userId}: ${successCount} success, ${failCount} failed`);
 await bot.sendMessage(callbackQuery.message.chat.id,
  `📊 Message sending complete:\n✅ Successfully sent: ${successCount}\n❌ Failed: ${failCount}`
 );

 // Clean up
 console.log(`🧹 Cleaning up state for user ${userId}`);
 userStates.delete(userId);
});