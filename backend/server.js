/**
 * Landscape Generator Backend
 * Express + SSE for long-running agent jobs
 * Deploy to Railway — no timeout limits
 *
 * Changes in this version:
 *  + Stage 1d: Dedicated Capability Agent — defines 5 capabilities per category
 *    BEFORE scoring, grounded in category context and vendor list. Eliminates
 *    generic/wrong capabilities that occurred when capability definition was
 *    bundled with scoring.
 *  + Stage 1e: Scoring Agent now scores against pre-defined capabilities only —
 *    no more capability invention, tighter prompts, fewer timeouts.
 *  + Old Stage 1d (scoring) → Stage 1e. Old Stage 1e (quality pass) → Stage 1f.
 *  + All prior fixes retained (withTimeout, makeRetry, heartbeat, cancel, etc.)
 */
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __dir = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(__dir, 'landscape-template.html'), 'utf8');

// ── LANDSCAPE LIBRARY ─────────────────────────────────────────────────────────
const LIBRARY_DIR = existsSync('/data') ? '/data/landscapes' : join(__dir, 'library');
if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true });

function libraryList() {
  try {
    return readdirSync(LIBRARY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const meta = JSON.parse(readFileSync(join(LIBRARY_DIR, f), 'utf8'));
          return { id: f.replace('.json',''), domain: meta.domain, savedAt: meta.savedAt,
                   vendorCount: meta.vendors?.length||0, categoryCount: meta.categories?.length||0 };
        } catch { return null; }
      }).filter(Boolean).sort((a,b) => b.savedAt.localeCompare(a.savedAt));
  } catch { return []; }
}

function librarySave(domain, data) {
  const id = `${domain.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)}-${Date.now()}`;
  const payload = { domain, savedAt: new Date().toISOString(), ...data };
  writeFileSync(join(LIBRARY_DIR, `${id}.json`), JSON.stringify(payload));
  return id;
}

function libraryGet(id) {
  const fp = join(LIBRARY_DIR, `${id}.json`);
  if (!existsSync(fp)) return null;
  return JSON.parse(readFileSync(fp, 'utf8'));
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// ── JOB STORE ─────────────────────────────────────────────────────────────────
const jobs = new Map();
const sseListeners = new Map();

function createJob(domain, mode) {
  const id = randomUUID();
  jobs.set(id, { id, domain, mode, status:'running', logs:[], result:null, error:null, cancelled:false, startedAt:new Date().toISOString() });
  return id;
}

function log(jobId, msg, level='info') {
  const job = jobs.get(jobId);
  if (!job) return;
  const entry = { t:Date.now(), msg, level };
  job.logs.push(entry);
  (sseListeners.get(jobId)||[]).forEach(res => { try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch {} });
}

function finalize(jobId, result) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'review'; job.result = result;
  log(jobId, '✓ Pipeline complete — ready for review', 'success');
  (sseListeners.get(jobId)||[]).forEach(res => { try { res.write(`data: ${JSON.stringify({msg:'__DONE__',level:'system'})}\n\n`); res.end(); } catch {} });
}

function fail(jobId, error) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'error'; job.error = error;
  log(jobId, `✗ ${error}`, 'error');
  (sseListeners.get(jobId)||[]).forEach(res => { try { res.write(`data: ${JSON.stringify({msg:'__ERROR__',level:'system'})}\n\n`); res.end(); } catch {} });
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok:true, jobs:jobs.size, uptime:process.uptime() }));

app.post('/api/job/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  if (job.status !== 'running') return res.status(400).json({ error:'Job not running' });
  job.cancelled = true;
  job.status = 'cancelled';
  log(req.params.id, 'Run cancelled by user', 'error');
  (sseListeners.get(req.params.id)||[]).forEach(r => {
    try { r.write('data: ' + JSON.stringify({msg:'__CANCELLED__',level:'system'}) + '\n\n'); r.end(); } catch {}
  });
  res.json({ ok:true });
});

app.get('/api/library', (_, res) => res.json(libraryList()));

app.get('/api/library/:id', (req, res) => {
  const data = libraryGet(req.params.id);
  if (!data) return res.status(404).json({ error:'Not found' });
  res.json(data);
});

app.post('/api/library', (req, res) => {
  const { domain, categories, vendors, capabilities } = req.body;
  if (!domain || !categories || !vendors || !capabilities)
    return res.status(400).json({ error:'domain, categories, vendors, capabilities required' });
  const id = librarySave(domain, { categories, vendors, capabilities });
  res.json({ id });
});

app.delete('/api/library/:id', (req, res) => {
  const fp = join(LIBRARY_DIR, `${req.params.id}.json`);
  if (!existsSync(fp)) return res.status(404).json({ error:'Not found' });
  try { unlinkSync(fp); res.json({ ok:true }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/generate', (req, res) => {
  const { domain, brief, persona='CIO', apiKey } = req.body;
  if (!domain || !brief) return res.status(400).json({ error:'domain and brief required' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error:'Anthropic API key required' });
  const jobId = createJob(domain, 'build');
  res.json({ jobId });
  buildPipeline(jobId, domain, brief, persona, key).catch(e => {
    if (e.message !== '__CANCELLED__') fail(jobId, e.message);
  });
});

app.post('/api/refresh', (req, res) => {
  const { domain, existingData, brief='', persona='CIO', apiKey } = req.body;
  if (!domain || !existingData) return res.status(400).json({ error:'domain and existingData required' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error:'Anthropic API key required' });
  const jobId = createJob(domain, 'refresh');
  res.json({ jobId });
  refreshPipeline(jobId, domain, existingData, brief, persona, key).catch(e => {
    if (e.message !== '__CANCELLED__') fail(jobId, e.message);
  });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  job.logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  if (job.status !== 'running') {
    const sig = job.status === 'cancelled' ? '__CANCELLED__' : '__DONE__';
    res.write(`data: ${JSON.stringify({msg:sig,level:'system'})}\n\n`);
    return res.end();
  }
  if (!sseListeners.has(req.params.id)) sseListeners.set(req.params.id, []);
  sseListeners.get(req.params.id).push(res);
  req.on('close', () => { const l=sseListeners.get(req.params.id)||[]; const i=l.indexOf(res); if(i>=0) l.splice(i,1); });
});

app.get('/api/job/:id/result', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  res.json({ id:job.id, status:job.status, domain:job.domain, mode:job.mode, error:job.error, result:job.result });
});

app.post('/api/job/:id/approve', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'review') return res.status(400).json({ error:'Job not in review state' });
  if (req.body.result) job.result = req.body.result;
  job.status = 'approved';
  try {
    const { categories, vendors, capabilities } = job.result;
    const libId = librarySave(job.domain, { categories, vendors, capabilities });
    job.libraryId = libId;
  } catch(e) { console.error('Library save failed:', e.message); }
  res.json({ ok:true, libraryId: job.libraryId });
});

app.post('/api/job/:id/deploy', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  if (!['approved','review'].includes(job.status)) return res.status(400).json({ error:'Approve the job first' });
  const vercelToken = req.body.vercelToken || process.env.VERCEL_TOKEN;
  if (!vercelToken) return res.status(400).json({ error:'Vercel token required.' });
  try {
    const url = await deployToVercel(job.result, job.domain, vercelToken);
    job.status = 'deployed'; job.deployUrl = url;
    res.json({ url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function deployToVercel(landscapeData, domain, token) {
  const slug = domain.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
  const abbr = domain.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,3);
  const date = new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'});
  const html = TEMPLATE
    .replace(/\{\{DOMAIN_NAME\}\}/g, domain)
    .replace(/\{\{DOMAIN_ABBR\}\}/g, abbr)
    .replace(/\{\{GENERATED_DATE\}\}/g, date)
    .replace('{{LANDSCAPE_JSON}}', JSON.stringify(landscapeData));
  const htmlB64 = Buffer.from(html, 'utf8').toString('base64');
  const deployResp = await fetch('https://api.vercel.com/v13/deployments', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      name: `landscape-${slug}`,
      files: [{ file:'index.html', data:htmlB64, encoding:'base64' }],
      target: 'production',
      projectSettings: { framework:null, buildCommand:null, outputDirectory:null, installCommand:null, devCommand:null }
    })
  });
  const deployData = await deployResp.json();
  if (!deployResp.ok) throw new Error(deployData.error?.message || JSON.stringify(deployData));
  const deployId = deployData.id;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(`https://api.vercel.com/v13/deployments/${deployId}`, { headers:{'Authorization':`Bearer ${token}`} }).then(r=>r.json());
    if (s.readyState === 'READY') return `https://${s.url}`;
    if (s.readyState === 'ERROR') throw new Error('Vercel deployment failed');
  }
  return `https://landscape-${slug}.vercel.app`;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const extractText = r => r.content.filter(b=>b.type==='text').map(b=>b.text).join('');

function parseJSON(text) {
  let s = text.trim();
  if (s.includes('```')) {
    for (const p of s.split('```')) { const t=p.startsWith('json')?p.slice(4).trim():p.trim(); if(t.startsWith('{')){ s=t; break; } }
  }
  const a=s.indexOf('{'), b=s.lastIndexOf('}')+1;
  if(a>=0&&b>a) s=s.slice(a,b);
  return JSON.parse(s);
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

// ── TIMEOUT WRAPPER ───────────────────────────────────────────────────────────
// Promise.race — fires regardless of SDK version or Railway connection behaviour.
// Do NOT replace with SDK timeout= alone — proven unreliable on Railway.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT:${label} after ${ms/1000}s`)), ms)
    )
  ]);
}

// ── RETRY FACTORY ─────────────────────────────────────────────────────────────
// Module-level so both pipelines use it.
// maxRetries default 4 for rate limits; vendor/scoring calls pass 2 to fail fast.
// Backoff: 30s, 60s, 120s, 240s for 429s. Flat 20s for timeouts.
function makeRetry(logFn, cancelFn) {
  return async function withRetry(fn, label, maxRetries=4) {
    for (let attempt=0; attempt<=maxRetries; attempt++) {
      cancelFn();
      try {
        return await fn();
      } catch(e) {
        if (e.message === '__CANCELLED__') throw e;
        const is429     = e.status===429 || (e.message||'').includes('rate_limit');
        const isTimeout = (e.message||'').startsWith('TIMEOUT:') ||
                          (e.message||'').toLowerCase().includes('timeout') ||
                          e.code==='ETIMEDOUT';
        if ((is429||isTimeout) && attempt<maxRetries) {
          const wait = is429 ? Math.pow(2, attempt+1)*15000 : 20000;
          logFn(`  [${label}] ${is429?'Rate limit':'Timeout'} — waiting ${wait/1000}s, retry ${attempt+1}/${maxRetries}...`, 'error');
          await sleep(wait);
        } else {
          throw e;
        }
      }
    }
  };
}

const CAT_COLORS = [
  ['#3B82F6','rgba(59,130,246,0.1)'],['#8B5CF6','rgba(139,92,246,0.1)'],
  ['#0D9488','rgba(13,148,136,0.1)'],['#D97706','rgba(217,119,6,0.1)'],
  ['#DC2626','rgba(220,38,38,0.1)'],['#475569','rgba(71,85,105,0.15)'],
  ['#0891B2','rgba(8,145,178,0.1)'],['#7C3AED','rgba(124,58,237,0.1)'],
  ['#059669','rgba(5,150,105,0.1)'],['#BE185D','rgba(190,24,93,0.1)'],
];

function validateResult(result) {
  const issues = [];
  const { categories=[], vendors=[], capabilities=[] } = result;
  if (categories.length < 7) issues.push(`Only ${categories.length} categories (min 7)`);
  if (vendors.length < 40)   issues.push(`Only ${vendors.length} vendors (min 40)`);
  if (capabilities.length < 20) issues.push(`Only ${capabilities.length} capabilities (min 20)`);
  const orphans = vendors.filter(v => !categories.find(c => c.id===v.cat));
  if (orphans.length) issues.push(`${orphans.length} vendors with invalid category ID`);
  let badScores = 0;
  capabilities.forEach(cap => Object.values(cap.scores||{}).forEach(s => { if(s<0||s>100) badScores++; }));
  if (badScores) issues.push(`${badScores} capability scores out of 0-100 range`);
  return issues;
}

// ── BUILD PIPELINE ────────────────────────────────────────────────────────────
async function buildPipeline(jobId, domain, brief, persona, apiKey) {
  const MODEL = 'claude-sonnet-4-6';

  const client   = new Anthropic({ apiKey, timeout:100000 });
  const wsClient = new Anthropic({ apiKey, timeout:130000, defaultHeaders:{ 'anthropic-beta':'web-search-2025-03-05' } });

  const L = (m,lv='info') => log(jobId,m,lv);
  const checkCancelled = () => { if (jobs.get(jobId)?.cancelled) throw new Error('__CANCELLED__'); };
  const withRetry = makeRetry(L, checkCancelled);

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  let currentStage = 'starting';
  const heartbeat = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') { clearInterval(heartbeat); return; }
    L(`  ⏳ Still running [${currentStage}] — waiting for API response...`, 'info');
  }, 60000);

  const done = (result) => { clearInterval(heartbeat); finalize(jobId, result); };
  const bail = (msg)    => { clearInterval(heartbeat); fail(jobId, msg); };

  try {
    L(`New landscape: ${domain} | Persona: ${persona}`);

    // ── Stage 1a: Category Agent ────────────────────────────────────────────
    checkCancelled();
    L(''); L('── Stage 1a: Category Agent ──────────────────', 'stage');
    currentStage = '1a-categories';

    const catData = await withRetry(async () => {
      const r = await withTimeout(
        client.messages.create({
          model:MODEL, max_tokens:3000,
          system:`You are a senior technology analyst. Build a MECE value-chain taxonomy of 8-10 categories for the given technology domain from your training knowledge. Categories flow left to right: discovery/awareness → execution → optimization/renewal. Market sizes from Gartner/IDC/MarketsandMarkets. Phase labels are short ALL CAPS verbs (DISCOVER, MAP, GOVERN, OPTIMIZE, RENEW etc). Output ONLY valid JSON, no preamble.`,
          messages:[{role:'user',content:`Domain: ${domain}\nPersona: ${persona}\nBrief:\n${brief}\n\nOutput: {"categories":[{"id":1,"phase":"VERB","name":"Full Name","short":"Short (2-3 words)","market":"$XB","cagr":"X%","desc":"2-3 sentence description of what this category does and why it matters to the buyer.","capabilities_preview":["5 specific capability names"],"gartner":"Official Gartner segment name"}]}`}]
        }),
        90000, 'categories'
      );
      return parseJSON(extractText(r));
    }, 'categories');

    const categories = catData.categories.map((c,i) => ({...c, id:i+1, color:CAT_COLORS[i%10][0], dim:CAT_COLORS[i%10][1]}));
    L(`✓ ${categories.length} categories`, 'success');

    // ── Stage 1b: Vendor Agent (sequential, 5s gap) ─────────────────────────
    checkCancelled();
    L(''); L('── Stage 1b: Vendor Agent (sequential) ──', 'stage');

    const vSchema = `{"vendors":[{"name":"str","type":"Legacy|AI-Native|Analyst","status":"Public|Private|Acquired|Division","ticker":"str|null","hq":"City, Country","founded":2015,"funding":150,"valuation":null,"round_type":"Series B|null","round_amount":50,"round_date":"Jan 2024|null","acq_price":null,"acquirer":null,"employees":500,"arr":80,"investors":"VC Names","agentic":true,"desc":"2 clear sentences. What it does and why buyers buy it.","products":"Product A, Product B, Product C","capabilities":"Cap 1; Cap 2; Cap 3; Cap 4"}]}`;

    async function fetchVendorsForCat(cat) {
      L(`  [${cat.phase}] Discovering vendors...`);
      currentStage = `1b-vendors-${cat.phase}`;
      return withRetry(async () => {
        const r = await withTimeout(
          client.messages.create({
            model:MODEL, max_tokens:6000,
            system:`You are a senior technology analyst. Profile 8-12 vendors for this market category from your training knowledge. For public companies include known revenue/ARR. For private companies use last known funding round. Set unknown financials to null — null is better than a wrong number. Legacy=founded pre-2016 or traditional SaaS; AI-Native=LLM/ML-first product, founded post-2018 with AI core; Analyst=research/advisory firm. Output ONLY valid JSON.`,
            messages:[{role:'user',content:`Domain: ${domain}\nCategory: ${cat.name} [${cat.phase} phase]\nDescription: ${cat.desc}\nKey capabilities: ${(cat.capabilities_preview||[]).join(', ')}\nBuyer: ${persona}\n\nFind 8-12 vendors. Balance ~50% Legacy, ~45% AI-Native, ~5% Analyst.\n\n${vSchema}`}]
          }),
          90000, cat.phase
        );
        const d = parseJSON(extractText(r));
        const vends = (d.vendors||[]).map(v => ({...v, cat:cat.id}));
        L(`  [${cat.phase}] ✓ ${vends.length} vendors`);
        return vends;
      }, cat.phase, 2);
    }

    const vendors = [];
    for (let i=0; i<categories.length; i++) {
      checkCancelled();
      try {
        vendors.push(...await fetchVendorsForCat(categories[i]));
      } catch(e) {
        if (e.message==='__CANCELLED__') throw e;
        L(`  [${categories[i].phase}] ✗ Failed: ${e.message}`, 'error');
      }
      if (i < categories.length-1) await sleep(5000);
    }
    vendors.forEach((v,i) => { v.id=i+1; });
    L(`✓ ${vendors.length} total vendors`, 'success');

    // ── Stage 1c: Verification (knowledge-based gap-check) ──────────────────
    checkCancelled();
    L(''); L('── Stage 1c: Verification Agent (knowledge gap-check) ──', 'stage');
    L('  Checking for missing vendors from training knowledge...');

    const verifySchema = `{"new_vendors":[{"name":"str","type":"AI-Native|Legacy","status":"Private|Public","hq":"City, Country","founded":2020,"funding":30,"valuation":null,"round_type":"Series A|null","round_amount":30,"round_date":"Jan 2025|null","acq_price":null,"acquirer":null,"employees":80,"arr":null,"investors":"VC Names","agentic":true,"cat":1,"desc":"2 sentences.","products":"Product A, B","capabilities":"Cap 1; Cap 2"}]}`;

    const verifiedNewVendors = [];
    const existingNames = new Set(vendors.map(v => v.name.toLowerCase()));
    const catBatchesV = [];
    for (let i=0; i<categories.length; i+=3) catBatchesV.push(categories.slice(i,i+3));

    for (let bi=0; bi<catBatchesV.length; bi++) {
      checkCancelled();
      const batch = catBatchesV[bi];
      currentStage = `1c-verify-batch${bi+1}`;
      L(`  Verifying batch ${bi+1}/${catBatchesV.length}: [${batch.map(c=>c.phase).join(', ')}]`);
      const existingInBatch = vendors.filter(v => batch.some(c => c.id===v.cat)).map(v => v.name);
      try {
        const rv = await withRetry(async () => withTimeout(
          client.messages.create({
            model:MODEL, max_tokens:4000,
            system:`You are a technology analyst reviewing a vendor landscape for gaps. From your training knowledge, identify notable vendors MISSED in the initial pass — especially AI-native startups founded post-2020, niche specialists, and recently acquired companies. Output ONLY valid JSON.`,
            messages:[{role:'user',content:`Domain: ${domain}
Categories: ${batch.map(c=>`[${c.phase}] ${c.name}`).join(' | ')}

Already in landscape (DO NOT repeat): ${existingInBatch.join(', ')}

From your training knowledge, identify 2-5 notable vendors missing from these categories. Focus on:
1. AI-native startups with significant funding or traction
2. Established vendors frequently cited in analyst reports
3. Recently acquired companies that were notable independents

Assign each to the most relevant cat ID (${batch.map(c=>`${c.id}=${c.phase}`).join(', ')}).

${verifySchema}`}]
          }),
          90000, `verify-${bi+1}`
        ), `verify-${bi+1}`, 2);

        const dv = parseJSON(extractText(rv));
        const newOnes = (dv.new_vendors||[]).filter(v => !existingNames.has(v.name.toLowerCase()));
        newOnes.forEach(v => existingNames.add(v.name.toLowerCase()));
        verifiedNewVendors.push(...newOnes);
        L(`  ✓ Batch ${bi+1}: +${newOnes.length} new vendors`, 'success');
      } catch(e) {
        if (e.message==='__CANCELLED__') throw e;
        L(`  ✗ Verify batch ${bi+1} failed: ${e.message}`, 'error');
      }
      if (bi < catBatchesV.length-1) await sleep(5000);
    }

    if (verifiedNewVendors.length > 0) {
      const startId = vendors.length+1;
      verifiedNewVendors.forEach((v,i) => { v.id=startId+i; });
      vendors.push(...verifiedNewVendors);
      L(`✓ Verification complete — +${verifiedNewVendors.length} added (${vendors.length} total)`, 'success');
    } else {
      L('✓ Verification complete — no gaps found', 'success');
    }

    // ── Stage 1d: Capability Agent (dedicated, 3 cats per batch) ────────────
    // Defines capabilities BEFORE scoring so the Scoring Agent never has to
    // invent them. This is the key fix for generic/wrong capabilities.
    checkCancelled();
    L(''); L('── Stage 1d: Capability Agent ────────────────', 'stage');
    L('  Defining capability dimensions per category...');

    const definedCapabilities = []; // populated here, scores added in Stage 1e
    const capBatches = [];
    for (let i=0; i<categories.length; i+=3) capBatches.push(categories.slice(i,i+3));

    for (let bi=0; bi<capBatches.length; bi++) {
      checkCancelled();
      const batch = capBatches[bi];
      currentStage = `1d-capabilities-batch${bi+1}`;
      L(`  Defining batch ${bi+1}/${capBatches.length}: [${batch.map(c=>c.phase).join(', ')}]`);

      try {
        const r = await withRetry(async () => withTimeout(
          client.messages.create({
            model:MODEL, max_tokens:4000,
            system:`You are a senior technology analyst defining capability dimensions for vendor evaluation matrices. 

Rules:
- Each capability must be SPECIFIC to this category — not generic across all enterprise tech
- Capabilities should clearly differentiate vendors (some score 85+, others score below 50)
- Name the capability precisely: "Agentless Network Scanning" not "Scanning", "ML-Based Anomaly Detection" not "AI"
- Cover the full spectrum: core function, advanced features, enterprise readiness, depth of integration, and AI/automation
- A buyer reading the capability name should immediately know what is being evaluated

Output ONLY valid JSON, no preamble.`,
            messages:[{role:'user',content:`Domain: ${domain}
Buyer persona: ${persona}

Categories to define capabilities for:
${batch.map(c => `
Cat ${c.id} [${c.phase}] ${c.name}
  What it does: ${c.desc}
  Vendors in this category: ${vendors.filter(v=>v.cat===c.id).slice(0,6).map(v=>`${v.name} [${v.type}]`).join(', ')}
  Initial capability hints: ${(c.capabilities_preview||[]).join(', ')}`).join('\n')}

For EACH category above, define EXACTLY 5 capabilities that ${persona}s use to evaluate vendors in this space.

Output: {"capabilities": [{"cat": 1, "name": "Precise Capability Name", "definition": "One sentence: what this measures and what distinguishes a top score (85+) from a low score (under 50)."}]}`}]
          }),
          90000, `capabilities-batch${bi+1}`
        ), `capabilities-batch${bi+1}`, 2);

        const d = parseJSON(extractText(r));
        const newCaps = (d.capabilities||[]).map(cap => ({ ...cap, scores: {} }));
        definedCapabilities.push(...newCaps);
        batch.forEach(cat => {
          const count = newCaps.filter(c => c.cat===cat.id).length;
          L(`  [${cat.phase}] ✓ ${count} capabilities defined`);
        });
      } catch(e) {
        if (e.message==='__CANCELLED__') throw e;
        L(`  ✗ Capability batch ${bi+1} failed: ${e.message}`, 'error');
      }
      if (bi < capBatches.length-1) await sleep(5000);
    }

    // Stage 1d top-up: categories that got 0 capabilities defined
    const definedCatIds = new Set(definedCapabilities.map(c => c.cat));
    const missingCapCats = categories.filter(c => !definedCatIds.has(c.id));
    if (missingCapCats.length > 0) {
      L(`  ⚠ ${missingCapCats.length} categories missing capability definitions — topping up...`, 'error');
      for (const cat of missingCapCats) {
        checkCancelled();
        currentStage = `1d-captopup-${cat.phase}`;
        L(`  Cap definition top-up: [${cat.phase}]...`);
        try {
          const r = await withRetry(async () => withTimeout(
            client.messages.create({
              model:MODEL, max_tokens:2000,
              system:`You are a technology analyst defining evaluation capabilities for a vendor matrix. Output ONLY valid JSON.`,
              messages:[{role:'user',content:`Domain: ${domain}
Category: Cat ${cat.id} [${cat.phase}] ${cat.name}
Description: ${cat.desc}
Vendors: ${vendors.filter(v=>v.cat===cat.id).map(v=>`${v.name} [${v.type}]`).join(', ')}

Define EXACTLY 5 specific, differentiated capabilities for evaluating vendors in this category.
Output: {"capabilities": [{"cat": ${cat.id}, "name": "Precise Name", "definition": "One sentence with scoring guidance."}]}`}]
            }),
            60000, `captopup-${cat.phase}`
          ), `captopup-${cat.phase}`, 2);
          const d = parseJSON(extractText(r));
          const newCaps = (d.capabilities||[]).map(cap => ({ ...cap, scores: {} }));
          definedCapabilities.push(...newCaps);
          L(`  ✓ Cap definition top-up [${cat.phase}]: +${newCaps.length}`, 'success');
        } catch(e) {
          if (e.message==='__CANCELLED__') throw e;
          L(`  ✗ Cap top-up [${cat.phase}] failed: ${e.message}`, 'error');
        }
        if (missingCapCats.indexOf(cat) < missingCapCats.length-1) await sleep(5000);
      }
    }

    L(`✓ ${definedCapabilities.length} capabilities defined across ${categories.length} categories`, 'success');

    // ── Stage 1e: Scoring Agent (scores pre-defined capabilities only) ───────
    // Now only scores — no capability invention. Tighter prompts, faster calls.
    checkCancelled();
    L(''); L('── Stage 1e: Scoring Agent ───────────────────', 'stage');

    const scoreBatches = [];
    for (let i=0; i<categories.length; i+=2) scoreBatches.push(categories.slice(i,i+2));

    for (const batch of scoreBatches) {
      checkCancelled();
      const bIds = batch.map(c => c.id);
      currentStage = `1e-scoring-[${bIds.join(',')}]`;
      L(`  Scoring [${bIds.join(',')}]...`);

      const bVendors = vendors.filter(v => bIds.includes(v.cat));
      const bCaps    = definedCapabilities.filter(c => bIds.includes(c.cat));

      if (bCaps.length === 0) {
        L(`  ⚠ No capabilities defined for [${bIds.join(',')}], skipping`, 'error');
        continue;
      }

      try {
        const r = await withRetry(async () => withTimeout(
          client.messages.create({
            model:MODEL, max_tokens:10000,
            system:`You are a technology analyst scoring vendors 0-100 on defined capability dimensions.

Scoring scale:
- 90-100: Best-in-Class (award to MAX 1-2 vendors per capability)
- 75-89:  Strong
- 60-74:  Capable
- 45-59:  Present / basic support
- 30-44:  Limited / early-stage
- 0:      Not applicable / outside vendor focus

Rules:
- Differentiate clearly — spread scores across the full range, avoid clustering at 70-80
- AI-Native vendors score higher on AI/automation capabilities
- Legacy vendors score higher on enterprise compliance and deep integrations
- Score 0 when the capability is genuinely outside the vendor's scope

Output ONLY valid JSON, no preamble.`,
            messages:[{role:'user',content:`Domain: ${domain}

Pre-defined capabilities to score (use EXACT names):
${bCaps.map(c=>`[Cat ${c.cat}] "${c.name}": ${c.definition}`).join('\n')}

Vendors to score:
${bVendors.map(v=>`  [Cat ${v.cat}] [${v.type}] ${v.name}: ${(v.desc||'').slice(0,100)}`).join('\n')}

Score ONLY these vendors: ${bVendors.map(v=>v.name).join(', ')}
Score ONLY these capabilities (exact names): ${bCaps.map(c=>c.name).join(', ')}

Output: {"scores": [{"cap": "Exact Capability Name", "cat": 1, "vendor": "VendorName", "score": 85}]}`}]
          }),
          120000, `scoring-${bIds.join(',')}`
        ), `scoring-${bIds.join(',')}`, 2);

        const d = parseJSON(extractText(r));
        // Merge scores into the definedCapabilities objects
        (d.scores||[]).forEach(s => {
          const cap = definedCapabilities.find(c => c.cat===s.cat && c.name===s.cap);
          if (cap) cap.scores[s.vendor] = s.score;
        });
        L(`  ✓ [${bIds.join(',')}]: ${bVendors.length} vendors × ${bCaps.length} capabilities`);
      } catch(e) {
        if (e.message==='__CANCELLED__') throw e;
        L(`  ✗ Scoring [${bIds.join(',')}] failed: ${e.message}`, 'error');
      }
      await sleep(5000);
    }

    // Stage 1e top-up: re-score any categories that got 0 scores filled in
    const scoredCatIds = new Set(
      definedCapabilities
        .filter(c => Object.keys(c.scores||{}).length > 0)
        .map(c => c.cat)
    );
    const unscoredCats = categories.filter(c => !scoredCatIds.has(c.id));

    if (unscoredCats.length > 0) {
      L(`  ⚠ ${unscoredCats.length} categories unscored — running top-up...`, 'error');
      for (const cat of unscoredCats) {
        checkCancelled();
        currentStage = `1e-scoretopup-${cat.phase}`;
        L(`  Score top-up: [${cat.phase}]...`);
        const catVendors = vendors.filter(v => v.cat===cat.id);
        const catCaps    = definedCapabilities.filter(c => c.cat===cat.id);
        try {
          const r = await withRetry(async () => withTimeout(
            client.messages.create({
              model:MODEL, max_tokens:6000,
              system:`You are a technology analyst scoring vendors 0-100 on defined capabilities. Output ONLY valid JSON.`,
              messages:[{role:'user',content:`Domain: ${domain}
Category: Cat ${cat.id} [${cat.phase}] ${cat.name}

Capabilities (pre-defined):
${catCaps.map(c=>`"${c.name}": ${c.definition}`).join('\n')}

Vendors: ${catVendors.map(v=>`${v.name} [${v.type}]`).join(', ')}

Score ONLY these vendors on ONLY these capabilities.
Output: {"scores": [{"cap": "Exact Capability Name", "cat": ${cat.id}, "vendor": "VendorName", "score": 75}]}`}]
            }),
            90000, `scoretopup-${cat.phase}`
          ), `scoretopup-${cat.phase}`, 2);

          const d = parseJSON(extractText(r));
          (d.scores||[]).forEach(s => {
            const cap = definedCapabilities.find(c => c.cat===s.cat && c.name===s.cap);
            if (cap) cap.scores[s.vendor] = s.score;
          });
          L(`  ✓ Score top-up [${cat.phase}]: done`, 'success');
        } catch(e) {
          if (e.message==='__CANCELLED__') throw e;
          L(`  ✗ Score top-up [${cat.phase}] failed: ${e.message}`, 'error');
        }
        if (unscoredCats.indexOf(cat) < unscoredCats.length-1) await sleep(5000);
      }
    }

    // definedCapabilities now has scores merged in — this is the final capabilities array
    const capabilities = definedCapabilities;
    L(`✓ ${capabilities.length} capabilities scored`, 'success');

    // ── Stage 1f: Final Quality Pass ─────────────────────────────────────────
    checkCancelled();
    L(''); L('── Stage 1f: Final Quality Pass ──────────────────', 'stage');
    currentStage = '1f-quality-pass';

    // 1f-i: Vendor top-up — categories with fewer than 7 vendors
    const vendorCountByCat = {};
    categories.forEach(c => { vendorCountByCat[c.id] = vendors.filter(v => v.cat===c.id).length; });
    const sparseCategories = categories.filter(c => vendorCountByCat[c.id] < 7);

    if (sparseCategories.length > 0) {
      L(`  ⚠ ${sparseCategories.length} sparse categories (< 7 vendors) — topping up...`, 'error');
      const vSchemaTopup = `{"vendors":[{"name":"str","type":"Legacy|AI-Native|Analyst","status":"Public|Private|Acquired|Division","ticker":null,"hq":"City, Country","founded":2015,"funding":null,"valuation":null,"round_type":null,"round_amount":null,"round_date":null,"acq_price":null,"acquirer":null,"employees":null,"arr":null,"investors":"","agentic":false,"desc":"2 clear sentences.","products":"Product A","capabilities":"Cap 1; Cap 2"}]}`;
      for (const cat of sparseCategories) {
        checkCancelled();
        const have = vendorCountByCat[cat.id];
        const need = 8 - have;
        const existingInCat = vendors.filter(v => v.cat===cat.id).map(v => v.name);
        L(`  Top-up [${cat.phase}]: have ${have}, finding ${need} more...`);
        try {
          const r = await withRetry(async () => withTimeout(
            client.messages.create({
              model:MODEL, max_tokens:4000,
              system:`You are a senior technology analyst. Find additional vendors for a market category. Output ONLY valid JSON.`,
              messages:[{role:'user',content:`Domain: ${domain}
Category: [${cat.phase}] ${cat.name}
Description: ${cat.desc}

Already have these vendors (DO NOT repeat): ${existingInCat.join(', ')}

Find exactly ${need} additional vendors not listed above. Balance Legacy and AI-Native.
${vSchemaTopup}`}]
            }),
            90000, `vendor-topup-${cat.phase}`
          ), `vendor-topup-${cat.phase}`, 2);

          const d = parseJSON(extractText(r));
          const newVends = (d.vendors||[])
            .filter(v => !vendors.find(ev => ev.name.toLowerCase()===v.name.toLowerCase()))
            .map(v => ({...v, cat:cat.id}));
          const startId = vendors.length+1;
          newVends.forEach((v,i) => { v.id=startId+i; });
          vendors.push(...newVends);

          // Score new vendors against existing capabilities for this category
          if (newVends.length > 0) {
            const catCaps = capabilities.filter(c => c.cat===cat.id);
            if (catCaps.length > 0) {
              try {
                const rs = await withRetry(async () => withTimeout(
                  client.messages.create({
                    model:MODEL, max_tokens:3000,
                    system:`Score vendors 0-100 on defined capabilities. Output ONLY valid JSON.`,
                    messages:[{role:'user',content:`New vendors: ${newVends.map(v=>`${v.name} [${v.type}]`).join(', ')}
Capabilities: ${catCaps.map(c=>`"${c.name}": ${c.definition}`).join('\n')}
Output: {"scores":[{"cap":"Name","cat":${cat.id},"vendor":"Name","score":75}]}`}]
                  }),
                  60000, `topup-score-${cat.phase}`
                ), `topup-score-${cat.phase}`, 2);
                const ds = parseJSON(extractText(rs));
                (ds.scores||[]).forEach(s => {
                  const cap = capabilities.find(c => c.cat===s.cat && c.name===s.cap);
                  if (cap) cap.scores[s.vendor] = s.score;
                });
              } catch(e) {
                if (e.message==='__CANCELLED__') throw e;
                L(`  ⚠ Could not score top-up vendors for [${cat.phase}]`, 'error');
              }
            }
          }

          L(`  ✓ [${cat.phase}]: +${newVends.length} vendors (now ${have+newVends.length})`, 'success');
        } catch(e) {
          if (e.message==='__CANCELLED__') throw e;
          L(`  ✗ Vendor top-up [${cat.phase}] failed: ${e.message}`, 'error');
        }
        if (sparseCategories.indexOf(cat) < sparseCategories.length-1) await sleep(5000);
      }
    } else {
      L('  ✓ All categories have 7+ vendors', 'success');
    }

    // 1f-ii: Final counts summary
    L('');
    L(`  Final counts: ${categories.length} categories | ${vendors.length} vendors | ${capabilities.length} capabilities`, 'success');
    categories.forEach(c => {
      const vc = vendors.filter(v=>v.cat===c.id).length;
      const cc = capabilities.filter(cap=>cap.cat===c.id).length;
      const sc = capabilities.filter(cap=>cap.cat===c.id && Object.keys(cap.scores||{}).length>0).length;
      const flag = (vc < 7 || cc < 3) ? ' ⚠' : ' ✓';
      L(`    ${flag} [${c.phase}] ${vc} vendors, ${cc} capabilities (${sc} scored)`);
    });

    // ── Validation ────────────────────────────────────────────────────────────
    L(''); L('── Validation ────────────────────────────────', 'stage');
    const issues = validateResult({ categories, vendors, capabilities });
    if (issues.length) {
      issues.forEach(i => L(`  ⚠ ${i}`, 'error'));
      L(`  ${issues.length} issues found — review before deploying`, 'error');
    } else {
      L('  ✓ All checks passed', 'success');
    }

    done({ categories, vendors, capabilities, meta:{ domain, persona, generatedAt:new Date().toISOString(), issues } });

  } catch(e) {
    clearInterval(heartbeat);
    if (e.message !== '__CANCELLED__') bail(e.message);
  }
}

// ── REFRESH PIPELINE ──────────────────────────────────────────────────────────
async function refreshPipeline(jobId, domain, existingData, brief, persona, apiKey) {
  const MODEL = 'claude-sonnet-4-6';

  const client   = new Anthropic({ apiKey, timeout:100000 });
  const wsClient = new Anthropic({ apiKey, timeout:130000, defaultHeaders:{ 'anthropic-beta':'web-search-2025-03-05' } });

  const L = (m,lv='info') => log(jobId,m,lv);
  const checkCancelled = () => { if (jobs.get(jobId)?.cancelled) throw new Error('__CANCELLED__'); };
  const withRetry = makeRetry(L, checkCancelled);

  let currentStage = 'starting';
  const heartbeat = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') { clearInterval(heartbeat); return; }
    L(`  ⏳ Still running [${currentStage}] — waiting for API response...`, 'info');
  }, 60000);

  const done = (result) => { clearInterval(heartbeat); finalize(jobId, result); };

  try {
    const { categories, vendors, capabilities } = existingData;
    L(`Refreshing: ${domain} | ${vendors.length} existing vendors`);

    // Step 1 — Staleness check
    checkCancelled();
    L(''); L('── Step 1: Staleness Check ───────────────────', 'stage');
    currentStage = 'refresh-staleness';
    let changes = [];
    try {
      const r = await withRetry(async () => withTimeout(
        wsClient.messages.create({
          model:MODEL, max_tokens:5000,
          system:`Check for vendor status changes since mid-2024. Search for acquisitions, IPOs, shutdowns, major funding rounds. Output ONLY valid JSON.`,
          tools:[{type:'web_search_20250305',name:'web_search'}],
          messages:[{role:'user',content:`Check these ${domain} vendors for recent changes:\n${vendors.map(v=>v.name).join(', ')}\n\nOutput: {"changes":[{"name":"VendorName","change_type":"acquired|ipo|shutdown|funding","description":"Brief description","new_status":"Public|Private|Acquired","new_funding":150,"acquirer":"Name or null","acq_price":500}]}\n\nOnly include vendors with confirmed, verifiable changes.`}]
        }),
        120000, 'staleness'
      ), 'staleness');
      changes = parseJSON(extractText(r)).changes||[];
    } catch(e) {
      if (e.message==='__CANCELLED__') throw e;
      L(`  ✗ Staleness check failed: ${e.message}`, 'error');
    }
    changes.forEach(c => L(`  ↻ ${c.name}: ${c.change_type} — ${c.description}`));
    L(`✓ ${changes.length} status changes found`, 'success');

    // Step 2 — New vendor discovery
    checkCancelled();
    L(''); L('── Step 2: New Vendor Discovery ─────────────', 'stage');
    currentStage = 'refresh-new-vendors';
    const existingNames = new Set(vendors.map(v => v.name.toLowerCase()));
    let newVendors = [];
    try {
      const r = await withRetry(async () => withTimeout(
        wsClient.messages.create({
          model:MODEL, max_tokens:8000,
          system:`Find new AI-native startups and recently-funded vendors not yet in the landscape. Focus on last 12 months. Verify each via web search. Output ONLY valid JSON.`,
          tools:[{type:'web_search_20250305',name:'web_search'}],
          messages:[{role:'user',content:`Domain: ${domain}\nCategories: ${categories.map(c=>c.name).join(', ')}\n${brief?`Context: ${brief.slice(0,300)}`:''}

Already in landscape (DO NOT include): ${[...existingNames].slice(0,50).join(', ')}

Find 5-20 genuinely new vendors. Search for: "${domain} startups 2025", "${domain} funding 2025", new players in each category.

Output: {"vendors":[{"name":"str","type":"AI-Native|Legacy","status":"Private","hq":"City","founded":2023,"funding":20,"valuation":null,"round_type":"Series A","round_amount":20,"round_date":"Jun 2025","acq_price":null,"acquirer":null,"employees":40,"arr":null,"investors":"VCNames","agentic":true,"cat":1,"desc":"2 sentences.","products":"Product A","capabilities":"Cap 1; Cap 2"}]}`}]
        }),
        120000, 'new-vendors'
      ), 'new-vendors');
      const d = parseJSON(extractText(r));
      newVendors = (d.vendors||[]).filter(v => !existingNames.has(v.name.toLowerCase()));
    } catch(e) {
      if (e.message==='__CANCELLED__') throw e;
      L(`  ✗ New vendor discovery failed: ${e.message}`, 'error');
    }
    newVendors.forEach(v => L(`  + ${v.name} [${v.type}] → Cat ${v.cat}`));
    L(`✓ ${newVendors.length} new vendors found`, 'success');

    // Step 3 — Score new vendors
    let updatedCaps = capabilities;
    if (newVendors.length > 0) {
      checkCancelled();
      L(''); L('── Step 3: Scoring New Vendors ───────────────', 'stage');
      currentStage = 'refresh-scoring';
      try {
        const r = await withRetry(async () => withTimeout(
          client.messages.create({
            model:MODEL, max_tokens:6000,
            system:`Score new vendors 0-100 on existing capability dimensions. Scale: 90+=Best-in-Class, 75-89=Strong, 60-74=Capable, 45-59=Present, 30-44=Limited, 0=N/A. Output ONLY valid JSON.`,
            messages:[{role:'user',content:`New vendors:\n${newVendors.map(v=>`${v.name} [${v.type}] Cat${v.cat}: ${v.desc}`).join('\n')}\n\nExisting capabilities:\n${capabilities.map(c=>`Cat${c.cat} "${c.name}": ${c.definition||''}`).join('\n')}\n\nOutput: {"scores":[{"vendor":"Name","capability":"Exact cap name","score":75}]}`}]
          }),
          90000, 'scoring'
        ), 'scoring');
        const d = parseJSON(extractText(r));
        updatedCaps = capabilities.map(cap => {
          const newScores = {...cap.scores};
          (d.scores||[]).filter(s=>s.capability===cap.name).forEach(s=>{ newScores[s.vendor]=s.score; });
          return {...cap, scores:newScores};
        });
        L(`✓ Scored ${newVendors.length} new vendors`, 'success');
      } catch(e) {
        if (e.message==='__CANCELLED__') throw e;
        L(`  ✗ Scoring failed: ${e.message}`, 'error');
      }
    }

    const updatedVendors = vendors.map(v => {
      const c = changes.find(ch => ch.name.toLowerCase()===v.name.toLowerCase());
      if (!c) return v;
      return {...v, status:c.new_status||v.status, funding:c.new_funding||v.funding, acquirer:c.acquirer||v.acquirer, acq_price:c.acq_price||v.acq_price};
    });
    const maxId = Math.max(...vendors.map(v=>v.id||0));
    newVendors.forEach((v,i) => { v.id=maxId+i+1; });
    const allVendors = [...updatedVendors, ...newVendors];
    L(`  ${vendors.length} → ${allVendors.length} vendors | +${newVendors.length} added | ${changes.length} updated`, 'success');

    done({
      categories, vendors:allVendors, capabilities:updatedCaps,
      meta:{ domain, persona, generatedAt:new Date().toISOString(), refreshMeta:{ addedVendors:newVendors.map(v=>v.name), updatedVendors:changes.map(c=>c.name) } }
    });

  } catch(e) {
    clearInterval(heartbeat);
    if (e.message !== '__CANCELLED__') fail(jobId, e.message);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend :${PORT}`));
