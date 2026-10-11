#!/usr/bin/env node
/**
 * 黒子 (kuroko) — GitHub Actions の中で働く自律エージェント
 * 1. agent.json の指示を読む
 * 2. ニュースRSSを集める
 * 3. 無料枠のLLM (Gemini / Groq) で日報を作る
 * 4. data/daily/ に書き込む (コミットはワークフロー側)
 * 依存ゼロ (Node 22 標準機能のみ)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const JST_OFFSET = 9 * 3600 * 1000;
const ymd = (d = new Date(Date.now() + JST_OFFSET)) => d.toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

const cfg = JSON.parse(readFileSync('agent.json', 'utf8'));
const geminiKey = process.env.GEMINI_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';
const discordWebhook = process.env.DISCORD_WEBHOOK || '';

const log = (...a) => console.log('[kuroko]', ...a);

async function fetchWithTimeout(url, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { signal: c.signal, headers: { 'user-agent': 'kuroko-agent/1.0' } });
  } finally {
    clearTimeout(t);
  }
}

/** RSS 2.0 と Atom の両方を雑に、しかし確実に読む */
function parseFeed(xml, source) {
  const out = [];
  const isAtom = /<feed[\s>]/.test(xml.slice(0, 600));
  const blocks = xml.split(isAtom ? /<entry[\s>]/ : /<item[\s>]/).slice(1);
  for (const b of blocks) {
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    let link = '';
    const href = b.match(/<link[^>]*href="([^"]+)"/);
    if (href) link = href[1];
    else link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1] || '';
    const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    if (title) out.push({ source, title: clean(title).slice(0, 160), link: clean(link) });
    if (out.length >= 6) break;
  }
  return out;
}

async function collectNews() {
  const feeds = Array.isArray(cfg.feeds) ? cfg.feeds : [];
  const items = [];
  for (const url of feeds) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      items.push(...parseFeed(xml, new URL(url).hostname));
    } catch (e) {
      log(`feed失敗: ${url} (${e.message})`);
    }
  }
  return items;
}

async function callGemini(model, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: cfg.persona || 'あなたは黒子。主人に仕えるagentです。' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini: 空の応答');
  return text;
}

async function callGroq(model, prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: cfg.persona || 'あなたは黒子。主人に仕えるagentです。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8, max_tokens: 2048
    })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq: 空の応答');
  return text;
}

async function callPollinations(model, prompt) {
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model || 'openai-fast',
      messages: [
        { role: 'system', content: cfg.persona || 'あなたは黒子。主人に仕えるagentです。' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new Error('Pollinations: 空の応答');
  return text;
}

/** 無料キーの有無とconfigから、試す順番を組む(最後に常にキーレスの保険) */
function buildAttempts() {
  const attempts = [];
  if (geminiKey) {
    for (const m of [process.env.MODEL || cfg.model, 'gemini-flash-latest', 'gemini-2.5-flash']) {
      if (m) attempts.push({ run: () => callGemini(m, prompt), label: `gemini/${m}` });
    }
  }
  if (groqKey) {
    attempts.push({ run: () => callGroq(process.env.MODEL || cfg.model || 'openai/gpt-oss-120b', prompt), label: 'groq' });
  }
  attempts.push({ run: () => callPollinations(process.env.MODEL || cfg.model || 'openai-fast', prompt), label: 'pollinations' });
  return attempts;
}

let news = [];
let prompt = '';

function writeReports(report, label, extra) {
  const dir = 'data/daily';
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
  const dates = [ymd(), ...existing.map((f) => f.replace('.json', ''))].filter((v, i, a) => a.indexOf(v) === i).slice(0, 60);
  const payload = {
    date: ymd(),
    generated_at: nowISO(),
    engine: label,
    report,
    recent_dates: dates,
    ...extra
  };
  writeFileSync(`${dir}/${ymd()}.json`, JSON.stringify(payload, null, 2));
  writeFileSync(`${dir}/latest.json`, JSON.stringify(payload, null, 2));
  return dates;
}

async function notifyDiscord(report) {
  if (!discordWebhook || cfg.notify_discord === false) return;
  try {
    const body = `🕯️ **黒子の日報 (${ymd()})**\n\n${report.slice(0, 1800)}`;
    const res = await fetch(discordWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: body })
    });
    log(`Discord通知: ${res.status}`);
  } catch (e) {
    log(`Discord通知失敗: ${e.message}`);
  }
}

async function main() {
  news = await collectNews();
  const newsText = news.length
    ? news.map((n) => `- [${n.source}] ${n.title}`).join('\n')
    : '(RSSを取得できませんでした。ニュースなしで構想してください)';

  prompt = [
    `今日は ${ymd()} (日本時間) です。`,
    '以下の材料と指示に従って、主人へ渡す本日の日報を書いてください。',
    '',
    '## 主人からの指示 (agent.json / directives)',
    (cfg.directives || []).map((d, i) => `${i + 1}. ${d}`).join('\n') || '(特になし)',
    '',
    '## 今日の新材料 (ニュース見出し)',
    newsText,
    '',
    'markdown形式で。見出しと箇条書きを活用し、リンクがある項目には来源ドメインを添えてください。'
  ].join('\n');

  const attempts = buildAttempts();
  if (attempts.length === 0) {
    writeReports(
      '## まだ働けません\n\nAPIキーが未設定です。\n\n**設定方法**: リポジトリの **Settings → Secrets and variables → Actions** で `GEMINI_API_KEY`(無料。Google AI Studioで発行)を登録すると、翌日の予定時刻から働きます。手動で試すには **Actions → 黒子 → Run workflow**。',
      'unconfigured',
      { ok: false }
    );
    console.error('[kuroko] APIキーなし: GEMINI_API_KEY または GROQ_API_KEY をSecretsに設定してください');
    process.exit(1);
  }

  let report = null, label = null, lastErr = null;
  for (const a of attempts) {
    try {
      log(`試行: ${a.label}`);
      report = await a.run();
      label = a.label;
      break;
    } catch (e) {
      lastErr = e;
      log(`失敗: ${e.message}`);
    }
  }

  if (report == null) {
    writeReports(`## うまく働けませんでした\n\n全てのAIモデルへの接続に失敗しました。\n\n\`\`\`\n${String(lastErr?.message || lastErr).slice(0, 400)}\n\`\`\`\n\n無料枠の制限(回数制限)の可能性があります。時間をおいて **Actions → Run workflow** をもう一度。`, 'error', { ok: false });
    process.exit(1);
  }

  const dates = writeReports(report, label, { ok: true });
  log(`日報作成: data/daily/${ymd()}.json (${dates.length}日分, engine=${label})`);
  await notifyDiscord(report);
}

main();
