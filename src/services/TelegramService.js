// src/services/TelegramService.js
const TelegramBot = require('node-telegram-bot-api');

/**
 * Telegram Service - Reliable messaging using Telegram Bot API
 * Uses HTTP API - no keyboard simulation, 100% reliable
 */
class TelegramService {
    constructor(token, logger = console.log) {
        this.log = logger;
        this.token = token;
        this.bot = null;
        this.chatCache = new Map(); // username -> chat_id mapping

        if (!token) {
            this.log('⚠️ TELEGRAM_BOT_TOKEN not set in .env');
            this.log('📝 To set up:');
            this.log('   1. Open Telegram and search for @BotFather');
            this.log('   2. Send /newbot and follow instructions');
            this.log('   3. Copy API token to .env file');
            return;
        }

        try {
            // Create bot instance (no polling, we only send messages)
            this.bot = new TelegramBot(token, { polling: false });
            this.log('✅ Telegram bot initialized');
        } catch (error) {
            this.log(`❌ Failed to initialize Telegram bot: ${error.message}`);
        }
    }

    /**
     * Send message to a user by username or chat ID
     */
    async sendMessage(usernameOrChatId, message) {
        if (!this.bot) {
            throw new Error('Telegram bot not initialized. Add TELEGRAM_BOT_TOKEN to .env');
        }

        this.log(`📤 Sending Telegram message to: ${usernameOrChatId}`);

        try {
            let chatId;

            // If it's a number or looks like a chat ID, use directly
            if (typeof usernameOrChatId === 'number' || /^\d+$/.test(usernameOrChatId)) {
                chatId = usernameOrChatId;
            }
            // If it starts with @, it's a username - try to resolve
            else if (usernameOrChatId.startsWith('@')) {
                const username = usernameOrChatId.substring(1);

                // Check cache first
                if (this.chatCache.has(username)) {
                    chatId = this.chatCache.get(username);
                    this.log(`✅ Found chat ID in cache for @${username}`);
                } else {
                    // Try to get chat ID from recent updates
                    chatId = await this.getChatIdFromUsername(username);
                    if (chatId) {
                        this.chatCache.set(username, chatId);
                    }
                }
            }
            // Plain text - assume it's a username without @
            else {
                const username = usernameOrChatId;
                if (this.chatCache.has(username)) {
                    chatId = this.chatCache.get(username);
                } else {
                    chatId = await this.getChatIdFromUsername(username);
                    if (chatId) {
                        this.chatCache.set(username, chatId);
                    }
                }
            }

            if (!chatId) {
                throw new Error(`Could not find chat ID for ${usernameOrChatId}. Ask them to send /start to your bot first.`);
            }

            // Send message
            await this.bot.sendMessage(chatId, message);
            this.log(`✅ Message sent to ${usernameOrChatId} (chat_id: ${chatId})`);

            return true;
        } catch (error) {
            this.log(`❌ Failed to send Telegram message: ${error.message}`);
            throw new Error(`Telegram send failed: ${error.message}`);
        }
    }

    /**
     * Get chat ID from username by checking recent updates
     */
    async getChatIdFromUsername(username) {
        try {
            this.log(`🔍 Looking for chat ID for username: ${username}`);

            // Get recent updates
            const updates = await this.bot.getUpdates({ limit: 100 });

            // Find message from this username
            for (const update of updates.reverse()) {
                if (update.message && update.message.from) {
                    const from = update.message.from;
                    if (from.username && from.username.toLowerCase() === username.toLowerCase()) {
                        this.log(`✅ Found chat ID: ${from.id} for @${username}`);
                        return from.id;
                    }
                }
            }

            this.log(`⚠️ No messages found from @${username} in recent updates`);
            return null;
        } catch (error) {
            this.log(`❌ Error getting updates: ${error.message}`);
            return null;
        }
    }

    /**
     * Get bot info (for testing)
     */
    async getBotInfo() {
        if (!this.bot) {
            throw new Error('Bot not initialized');
        }

        try {
            const me = await this.bot.getMe();
            this.log(`🤖 Bot info: @${me.username} (${me.first_name})`);
            return me;
        } catch (error) {
            throw new Error(`Failed to get bot info: ${error.message}`);
        }
    }
}

module.exports = TelegramService;
