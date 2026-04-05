require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
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
if (!fs.readJsonSync(CONV_FILE,   { throws: false })) fs.writeJsonSync(CONV_FILE, {});

// ── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Luna — V&DG Management LLC's Chief Development & Strategy Officer (CDSO). You serve Vanna Gonzalez (Chairman & CEO), the only human at V&DG. You coordinate the AI executive team: Leo (CEO/COO), Atlas (CFO), Themis (Chief Legal), Orion (CTO/CISO), Nova (Chief of Staff).

⚡ YOUR ROLE:
- Strategic planning, business development, market expansion
- Coordinate cross-functional initiatives across the AI team
- Product roadmap strategy for all V&DG portfolio companies
- Partnership development and deal structuring strategy
- OKRs, KPIs, and sprint planning for the organization
- Long-term vision and market positioning

🏢 V&DG PORTFOLIO:
1. RateWire B2B FX API — LIVE, ~$8K/mo MRR | ratewire.io
2. Vibe Travel Stack — APPROVED Apr 3, LAUNCHING ASAP | $35/mo B2C bundle
3. Soul Resonances LLC — spiritual wellness content brand | YouTube, TikTok, Patreon
4. The Asset Frequency LLC — financial intelligence brand
5. Aura Loop — YouTube @auraloop-88
6. Ki Healthcare Consulting LLC (FL) — hospital sales & implementation
7. TriageRobot Corp — Hospital Command Center (HCC) predictive analytics SaaS | Pilot $50K / Full $120K/yr

📊 CURRENT METRICS:
- MRR: ~$13,100 | Goal: $1M Net Profit Sprint (active)
- Projected 30-day MRR: $37,500+

💡 STRATEGY STYLE:
- Think in systems, not tasks
- Always connect strategy to revenue impact
- Prioritize the highest-ROI moves for V&DG
- Be direct: give Vanna a clear recommendation, not a list of options
- No preamble. Lead with the insight or recommendation.
- When asked to plan, produce a real plan — not a template.`;

// ── Helpers ────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

function getMemories() {
  return fs.readJsonSync(MEMORY_FILE, { throws: false }) || [];
}

function loadHistory(userId) {
  const all = fs.readJsonSync(CONV_FILE, { throws: false }) || {};
  return all[userId] || [];
}

function saveHistory(userId, history) {
  const all = fs.readJsonSync(CONV_FILE, { throws: false }) || {};
  all[userId] = history.slice(-50);
  fs.writeJsonSync(CONV_FILE, all, { spaces: 2 });
}

async function callClaude(messages, systemPrompt) {
  const res = await axios.post(
    `${VDG_GATEWAY_URL}/ai/chat`,
    { model: DEFAULT_MODEL, system: systemPrompt, messages, max_tokens: 4096 },
    {
      headers: {
        Authorization: `Bearer ${VDG_INTERNAL_KEY}`,
        'Content-Type': 'application/json',
        'x-vdg-product': 'luna'
      },
      timeout: 120000
    }
  );
  return res.data?.content?.[0]?.text || res.data?.choices?.[0]?.message?.content || '';
}

// ── Auth ───────────────────────────────────────────────────────────────────
bot.use((ctx, next) => {
  if (!ALLOWED_USER_ID || ctx.from?.id?.toString() === ALLOWED_USER_ID.toString()) {
    return next();
  }
  return ctx.reply('⛔ Unauthorized');
});

// ── Commands ───────────────────────────────────────────────────────────────
bot.command('start', (ctx) => {
  ctx.reply(`🌙 *Luna online* — Chief Development & Strategy Officer, V&DG Management LLC.

I drive strategy, coordinate the AI executive team, and map the highest-ROI path forward for every initiative.

Current focus: $1M Net Profit Sprint · Vibe Travel Stack launch · TriageRobot hospital pipeline.

What are we building?`, { parse_mode: 'Markdown' });
});

bot.command('clear', (ctx) => {
  saveHistory(ctx.from.id, []);
  ctx.reply('🗑️ Conversation cleared.');
});

bot.command('status', (ctx) => {
  const memories = getMemories();
  ctx.reply(`🌙 Luna — LIVE\nRole: Chief Development & Strategy Officer\nModel: ${DEFAULT_MODEL}\nMemories loaded: ${memories.length}\nGateway: ${VDG_GATEWAY_URL}`);
});

bot.command('team', (ctx) => {
  ctx.reply(`👥 *V&DG AI Executive Team*\n\n• Leo — CEO/COO (execution, deals, affiliates)\n• Luna — CDSO (strategy, dev, coordination) ← you're here\n• Atlas — CFO (financial modeling, MRR)\n• Themis — Chief Legal (IP, HIPAA, contracts)\n• Orion — CTO/CISO (tech, deployments, security)\n• Nova — Chief of Staff (comms, briefings)\n\nAll reporting to Vanna Gonzalez, Chairman.`, { parse_mode: 'Markdown' });
});

// ── Message Handler ────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const userMessage = ctx.message.text;

  await ctx.sendChatAction('typing');

  try {
    const memories = getMemories();
    const memoryContext = memories.length > 0
      ? '\n\nLONG-TERM MEMORY:\n' + memories.map(m => `- [${m.category}] ${m.text}`).join('\n')
      : '';

    const history = loadHistory(userId);
    history.push({ role: 'user', content: userMessage });

    const fullSystem = SYSTEM_PROMPT + memoryContext;
    const reply = await callClaude(history, fullSystem);

    history.push({ role: 'assistant', content: reply });
    saveHistory(userId, history);

    // Split long messages
    const MAX = 4000;
    if (reply.length <= MAX) {
      await ctx.reply(reply);
    } else {
      const chunks = [];
      for (let i = 0; i < reply.length; i += MAX) chunks.push(reply.slice(i, i + MAX));
      for (const chunk of chunks) await ctx.reply(chunk);
    }
  } catch (err) {
    console.error('Luna error:', err.message);
    await ctx.reply(`⚠️ Error: ${err.message}. The gateway may be waking up — try again in 30 seconds.`);
  }
});

// ── Launch ─────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log('🌙 Luna is live'));
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
