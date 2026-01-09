/**
 * Telegram Bot Entry Point
 * 
 * Provides a Telegram interface to control media-bot.
 * Works in multiple groups and private chats.
 */

import { Bot, Context, session, GrammyError, HttpError } from 'grammy';
import { pino } from 'pino';
import { config } from './config.js';
import { registerCommands } from './commands/index.js';

const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
  },
});

// Session data type
interface SessionData {
  awaitingInput?: string;
  currentJobId?: string;
}

// Custom context type
export type BotContext = Context & {
  session: SessionData;
};

async function main(): Promise<void> {
  if (!config.botToken) {
    logger.fatal('TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  logger.info('Starting Telegram bot...');

  // Create bot instance
  const bot = new Bot<BotContext>(config.botToken);

  // Session middleware
  bot.use(session({
    initial: (): SessionData => ({}),
  }));

  // Auto-reply middleware - makes all replies tag the original message
  bot.use(async (ctx, next) => {
    const originalReply = ctx.reply.bind(ctx);
    
    // @ts-ignore - Override reply to auto-add reply_parameters
    ctx.reply = async (text: string, other?: any) => {
      const messageId = ctx.message?.message_id;
      if (messageId) {
        return originalReply(text, {
          ...other,
          reply_parameters: { message_id: messageId, ...(other?.reply_parameters || {}) },
        });
      }
      return originalReply(text, other);
    };
    
    await next();
  });

  // Access control middleware - allows all members in allowed groups
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const chatType = ctx.chat?.type;
    const userId = ctx.from?.id?.toString();
    
    // Check if this is a private chat
    if (chatType === 'private') {
      if (config.allowPrivate) {
        // Allow all private chats
        await next();
      } else if (userId && userId === config.adminId) {
        // Only admin in private if private chats disabled
        await next();
      } else {
        logger.warn({ userId }, 'Private chat not allowed');
        await ctx.reply('This bot only works in group chats.');
      }
      return;
    }
    
    // Check if this is a group/supergroup
    if (chatType === 'group' || chatType === 'supergroup') {
      // If no allowed groups configured, allow all groups
      if (config.allowedGroups.length === 0) {
        await next();
        return;
      }
      
      // Check if group is in allowed list
      if (chatId && config.allowedGroups.includes(chatId)) {
        await next();
      } else {
        logger.warn({ chatId, chatType }, 'Group not in allowed list');
        // Don't reply in unauthorized groups to avoid spam
      }
      return;
    }
    
    // Allow channel posts (for future use)
    if (chatType === 'channel') {
      await next();
      return;
    }
    
    // Default: allow
    await next();
  });

  // Register all commands
  registerCommands(bot, logger);

  // Error handling
  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error({ err: err.error }, `Error handling update ${ctx.update.update_id}`);
    
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error({ err: e }, 'Error in request');
    } else if (e instanceof HttpError) {
      logger.error({ err: e }, 'Could not contact Telegram');
    } else {
      logger.error({ err: e }, 'Unknown error');
    }
  });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info({ signal }, 'Shutting down bot...');
      await bot.stop();
      process.exit(0);
    });
  }

  // Start bot
  await bot.start({
    onStart: (botInfo) => {
      logger.info({ 
        username: botInfo.username,
        adminId: config.adminId ?? 'not set',
        allowedGroups: config.allowedGroups.length > 0 ? config.allowedGroups : 'all groups allowed',
        allowPrivate: config.allowPrivate,
      }, 'Bot started');
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
