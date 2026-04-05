require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios     = require('axios');
const fs        = require('fs-extra');
const path      = require('path');
const http      = require('http');

// ââ Config âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
const VDG_GATEWAY_URL = process.env.VDG_GATEWAY_URL || 'http://localhost:3099/v1';
const VDG_INTERNAL_KEY = process.env.VDG_INTERNAL_KEY || 'vdg_internal_2026';
const DEFAULT_MODEL   = process.env.DEFAULT_MODEL    || 'claude-sonnet-4-6';
const VDG_DATA_DIR    = process.env.VDG_DATA_DIR     || '/tmp/vdg-data';

if (!BOT_TOKEN) { console.error('ERROR: TELEGRAM_BOT_TOKEN not set'); process.exit(1); }

fs.ensureDirSync(VDG_DATA_DIR);
const MEMORY_FILE = path.join(VDG_DATA_DIR, 'memory.json');
const CONV_FILE   = path.join(VDG_DATA_DIR, 'luna_conversations.json');
fs.ensureFileSync(MEMORY_FILE);
fs.ensureFileSync(CONV_FILE);
if (!fs.readJsonSync(MEMORY_FILE, { throws: false })) fs.writeJsonSync(MEMORY_FILE, []);
if (!fs.readJsonSync(CONV_FILE,   { throws: false })) fs.writeJsonSync(CONV_FILE,   {});

const SYSTEM_PROMPT = `You are Luna, V&DG Management LLC's Chief of Staff & CDSO (Chief Development & Strategy Officer). You serve Vanna Gonzalez (Chairman & CEO). You coordinate the AI executive team: Leo (CEO/COO), Atlas (CFO), Themis (Chief Legal), Orion (CTO/CISO), Nova (Chief Engagement & Customer Service Officer). Be direct, lead with insights, no preamble. Connect everything to revenue impact.`;

const bot = new Telegraf(BOT_TOKEN);

function getMemories() { return fs.readJsonSync(MEMORY_FILE, { throws: false }) || []; }
function loadHistory(userId) { const all = fs.readJsonSync(CONV_FILE, { throws: false }) || {}; return all[userId] || []; }
function saveHistory(userId, history) { const all = fs.readJsonSync(CONV_FILE, { throws: false }) || {}; all[userId] = history.slice(-50); fs.writeJsonSync(CONV_FILE, all, { spaces: 2 }); }
async function callClaude(messages, systemPrompt) {
  const res = await axios.post(`${VDG_GATEWAY_URL}/ai/chat`, { model: DEFAULT_MODEL, system: systemPrompt, messages, max_tokens: 4096 }, { headers: { Authorization: `Bearer ${VDG_INTERNAL_KEY}`, 'Content-Type': 'application/json', 'x-vdg-product': 'luna' }, timeout: 120000 });
  return res.data?.content?.[0]?.text || res.data?.choices?.[0]?.message?.content || '';
}

bot.use((ctx, next) => { if (!ALLOWED_USER_ID || ctx.from?.id?.toString() === ALLOWED_USER_ID.toString()) { return next(); } return ctx.reply('â Unauthorized'); });
bot.command('start', (ctx) => { ctx.reply('ð *Luna online* â CDSO, V&DG Management LLC. What are we building?', { parse_mode: 'Markdown' }); });
bot.command('clear', (ctx) => { saveHistory(ctx.from.id, []); ctx.reply('ðï¸ Conversation cleared.'); });
bot.command('status', (ctx) => { const memories = getMemories(); ctx.reply(`ð Luna â LIVE\nModel: ${DEFAULT_MODEL}\nMemories: ${memories.length}\nGateway: ${VDG_GATEWAY_URL}`); });

bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userMessage = ctx.message.text;
  await ctx.sendChatAction('typing');
  try {
    const memories = getMemories();
    const memoryContext = memories.length > 0 ? '\n\nMEMORY:\n' + memories.map(m => `- [${m.category}] ${m.text}`).join('\n') : '';
    const history = loadHistory(userId);
    history.push({ role: 'user', content: userMessage });
    const reply = await callClaude(history, SYSTEM_PROMPT + memoryContext);
    history.push({ role: 'assistant', content: reply });
    saveHistory(userId, history);
    const MAX = 4000;
    if (reply.length <= MAX) { await ctx.reply(reply); } else { for (let i = 0; i < reply.length; i += MAX) await ctx.reply(reply.slice(i, i + MAX)); }
  } catch (err) { console.error('Luna error:', err.message); await ctx.reply(`â ï¸ Error: ${err.message}. Try again in 30s.`); }
});

// ââ Launch ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Keepalive HTTP server required by Render Web Service (port binding)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Luna is alive')).listen(PORT, () => {
  console.log('keepalive server on :' + PORT);
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || ('localhost:' + PORT);
  const isLocal = host.startsWith('localhost');
  const pinger = isLocal ? http : require('https');
  setInterval(() => {
    const url = (isLocal ? 'http://' : 'https://') + host + '/';
    pinger.get(url, (r) => console.log('keep-alive: ' + r.statusCode)).on('error', (e) => console.log('keep-alive err: ' + e.message));
  }, 840000);
});

// Start Telegram polling â dropPendingUpdates prevents 409 on cold start
bot.launch({ dropPendingUpdates: true }).then(() => console.log('ð Luna is live'));
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
