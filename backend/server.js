/**
 * Landscape Generator Backend
 * Express + SSE for long-running agent jobs
 * Deploy to Railway — no timeout limits
 */
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __dir = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(__dir, 'landscape-template.html'), 'utf8');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// ── JOB STORE ─────────────────────────────────────────────────────────────────
const jobs = new Map();
const sseListeners = new Map();

function createJob(domain, mode) {
  const id = randomUUID();
  jobs.set(id, { id, domain, mode, status:'running', logs:[], result:null, error:null, startedAt:new Date().toISOString() });
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

app.post('/api/generate', (req, res) => {
  const { domain, brief, persona='CIO', apiKey } = req.body;
  if (!domain || !brief) return res.status(400).json({ error:'domain and brief required' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error:'Anthropic API key required' });
  const jobId = createJob(domain, 'build');
  res.json({ jobId });
  buildPipeline(jobId, domain, brief, persona, key).catch(e => fail(jobId, e.message));
});

app.post('/api/refresh', (req, res) => {
  const { domain, existingData, brief='', persona='CIO', apiKey } = req.body;
  if (!domain || !existingData) return res.status(400).json({ error:'domain and existingData required' });
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error:'Anthropic API key required' });
  const jobId = createJob(domain, 'refresh');
  res.json({ jobId });
  refreshPipeline(jobId, domain, existingData, brief, persona, key).catch(e => fail(jobId, e.message));
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  job.logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  if (job.status !== 'running') { res.write(`data: ${JSON.stringify({msg:'__DONE__',level:'system'})}\n\n`); return res.end(); }
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
  res.json({ ok:true });
});

// ── DEPLOY TO VERCEL ──────────────────────────────────────────────────────────
app.post('/api/job/:id/deploy', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Not found' });
  if (!['approved','review'].includes(job.status)) return res.status(400).json({ error:'Approve the job first' });

  const vercelToken = req.body.vercelToken || process.env.VERCEL_TOKEN;
  if (!vercelToken) return res.status(400).json({ error:'Vercel token required. Add to .env or provide in request.' });

  try {
    const url = await deployToVercel(job.result, job.domain, vercelToken);
    job.status = 'deployed'; job.deployUrl = url;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function deployToVercel(landscapeData, domain, token) {
  const slug = domain.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
  const abbr = domain.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,3);
  const date = new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'});

  // Inject data into template
  const html = TEMPLATE
    .replace(/\{\{DOMAIN_NAME\}\}/g, domain)
    .replace(/\{\{DOMAIN_ABBR\}\}/g, abbr)
    .replace(/\{\{GENERATED_DATE\}\}/g, date)
    .replace('{{LANDSCAPE_JSON}}', JSON.stringify(landscapeData));

  const htmlB64 = Buffer.from(html, 'utf8').toString('base64');

  // POST to Vercel Deploy API
  const deployResp = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `landscape-${slug}`,
      files: [{ file: 'index.html', data: htmlB64, encoding: 'base64' }],
      target: 'production',
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null, devCommand: null }
    })
  });

  const deployData = await deployResp.json();
  if (!deployResp.ok) throw new Error(deployData.error?.message || JSON.stringify(deployData));

  // Poll until ready (max 90s)
  const deployId = deployData.id;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusResp = await fetch(`https://api.vercel.com/v13/deployments/${deployId}`, { headers:{'Authorization':`Bearer ${token}`} });
    const statusData = await statusResp.json();
    if (statusData.readyState === 'READY') return `https://${statusData.url}`;
    if (statusData.readyState === 'ERROR') throw new Error('Vercel deployment failed');
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

const CAT_COLORS = [
  ['#3B82F6','rgba(59,130,246,0.1)'],['#8B5CF6','rgba(139,92,246,0.1)'],
  ['#0D9488','rgba(13,148,136,0.1)'],['#D97706','rgba(217,119,6,0.1)'],
  ['#DC2626','rgba(220,38,38,0.1)'],['#475569','rgba(71,85,105,0.15)'],
  ['#0891B2','rgba(8,145,178,0.1)'],['#7C3AED','rgba(124,58,237,0.1)'],
  ['#059669','rgba(5,150,105,0.1)'],['#BE185D','rgba(190,24,93,0.1)'],
];

// ── VALIDATION PASS ───────────────────────────────────────────────────────────
function validateResult(result) {
  const issues = [];
  const { categories=[], vendors=[], capabilities=[] } = result;
  if (categories.length < 7) issues.push(`Only ${categories.length} categories (min 7)`);
  if (vendors.length < 40) issues.push(`Only ${vendors.length} vendors (min 40)`);
  if (capabilities.length < 20) issues.push(`Only ${capabilities.length} capabilities (min 20)`);
  // Check for vendors with no category
  const orphans = vendors.filter(v => !categories.find(c => c.id === v.cat));
  if (orphans.length) issues.push(`${orphans.length} vendors with invalid category ID`);
  // Check score ranges
  let badScores = 0;
  capabilities.forEach(cap => Object.values(cap.scores||{}).forEach(s => { if(s<0||s>100) badScores++; }));
  if (badScores) issues.push(`${badScores} capability scores out of 0-100 range`);
  return issues;
}

// ── BUILD PIPELINE ────────────────────────────────────────────────────────────
async function buildPipeline(jobId, domain, brief, persona, apiKey) {
  const client = new Anthropic({ apiKey });
  const L = (m,lv='info') => log(jobId,m,lv);
  L(`New landscape: ${domain} | Persona: ${persona}`);

  // 1a — Categories
  L(''); L('── Stage 1a: Category Agent ──────────────────', 'stage');
  const catResp = await client.messages.create({
    model:'claude-sonnet-4-20250514', max_tokens:8000,
    system:`You are a senior technology analyst. Build a MECE value-chain taxonomy of 8-10 categories for the given technology domain. Categories flow left to right: discovery/awareness → execution → optimization/renewal. Market sizes from Gartner/IDC/MarketsandMarkets. Phase labels are short ALL CAPS verbs (DISCOVER, MAP, GOVERN, OPTIMIZE, RENEW etc). Output ONLY valid JSON, no preamble.`,
    tools:[{type:'web_search_20250305',name:'web_search'}],
    messages:[{role:'user',content:`Domain: ${domain}\nPersona: ${persona}\nBrief:\n${brief}\n\nOutput: {"categories":[{"id":1,"phase":"VERB","name":"Full Name","short":"Short (2-3 words)","market":"$XB","cagr":"X%","desc":"2-3 sentence description of what this category does and why it matters to the buyer.","capabilities_preview":["5 specific capability names"],"gartner":"Official Gartner segment name"}]}`}]
  });
  const catData = parseJSON(extractText(catResp));
  const categories = catData.categories.map((c,i) => ({...c, id:i+1, color:CAT_COLORS[i%10][0], dim:CAT_COLORS[i%10][1]}));
  L(`✓ ${categories.length} categories`, 'success');

  // 1b — Vendors (parallel per category)
  L(''); L(`── Stage 1b: Vendor Agent (${categories.length} parallel calls) ──`, 'stage');
  const vSchema = `{"vendors":[{"name":"str","type":"Legacy|AI-Native|Analyst","status":"Public|Private|Acquired|Division","ticker":"str|null","hq":"City, Country","founded":2015,"funding":150,"valuation":null,"round_type":"Series B|null","round_amount":50,"round_date":"Jan 2024|null","acq_price":null,"acquirer":null,"employees":500,"arr":80,"investors":"VC Names","agentic":true,"desc":"2 clear sentences. What it does and why buyers buy it.","products":"Product A, Product B, Product C","capabilities":"Cap 1; Cap 2; Cap 3; Cap 4"}]}`;

  const vendorResults = await Promise.allSettled(categories.map(async cat => {
    L(`  [${cat.phase}] Discovering vendors...`);
    const r = await client.messages.create({
      model:'claude-sonnet-4-20250514', max_tokens:8000,
      system:`Research and profile 10-15 vendors for this technology market category. Use web search to verify financial data. If you cannot verify a figure, use null — null is better than a wrong number. Type definitions: Legacy=founded pre-2016 or traditional SaaS; AI-Native=LLM/ML-first product or founded to solve the problem with AI; Analyst=research/advisory firm. Output ONLY valid JSON.`,
      tools:[{type:'web_search_20250305',name:'web_search'}],
      messages:[{role:'user',content:`Domain: ${domain}\nCategory: ${cat.name} [${cat.phase} phase]\nDescription: ${cat.desc}\nKey capabilities: ${(cat.capabilities_preview||[]).join(', ')}\nBuyer: ${persona}\n\nFind 10-15 vendors. Balance ~50% Legacy, ~45% AI-Native, ~5% Analyst. Use web search to verify: funding raised, last valuation, ARR, acquisition details for each.\n\n${vSchema}`}]
    });
    const d = parseJSON(extractText(r));
    const vends = (d.vendors||[]).map(v => ({...v, cat:cat.id}));
    L(`  [${cat.phase}] ✓ ${vends.length} vendors`);
    return vends;
  }));

  const vendors = [];
  vendorResults.forEach((r,i) => {
    if(r.status==='fulfilled') vendors.push(...r.value);
    else L(`  [Cat ${categories[i].id}] ✗ ${r.reason?.message}`, 'error');
  });
  vendors.forEach((v,i) => { v.id=i+1; });
  L(`✓ ${vendors.length} total vendors`, 'success');

  // 1c — Scoring (batched)
  L(''); L('── Stage 1c: Scoring Agent ───────────────────', 'stage');
  const allVendorNames = [...new Set(vendors.map(v=>v.name))];
  const capabilities = [];
  const batches = [];
  for(let i=0; i<categories.length; i+=3) batches.push(categories.slice(i,i+3));

  for(const batch of batches) {
    const bIds = batch.map(c=>c.id);
    L(`  Scoring [${bIds.join(',')}]...`);
    const bVendors = vendors.filter(v=>bIds.includes(v.cat));
    const r = await client.messages.create({
      model:'claude-sonnet-4-20250514', max_tokens:12000,
      system:`You are a technology analyst scoring vendor capabilities 0-100. Scale: 90-100=Best-in-Class (only 1 per capability), 75-89=Strong, 60-74=Capable, 45-59=Present, 30-44=Limited, 0=Not applicable. Differentiate clearly — avoid clustering scores in the 60-75 band. AI-Native vendors should score higher on AI/automation capabilities. Legacy vendors should score higher on enterprise integrations and compliance. Output ONLY valid JSON.`,
      messages:[{role:'user',content:`Domain: ${domain}

Categories to score:
${batch.map(c=>`Cat ${c.id} [${c.phase}] ${c.name}\n  Preview caps: ${(c.capabilities_preview||[]).join(', ')}`).join('\n\n')}

Vendors in these categories:
${bVendors.map(v=>`  [${v.type}] ${v.name} (Cat ${v.cat}): ${(v.desc||'').slice(0,90)}`).join('\n')}

ALL vendor names for scores dict: ${allVendorNames.join(', ')}

Define 4-6 capabilities per category. Score ALL vendors in every capability's scores dict (use 0 if not applicable).
Output: {"capabilities":[{"cat":1,"name":"Specific Capability Name","definition":"One sentence what this does and why it matters.","scores":{"VendorName":85,"Other":0}}]}`}]
    });
    try {
      const d = parseJSON(extractText(r));
      capabilities.push(...(d.capabilities||[]));
      L(`  ✓ [${bIds.join(',')}]: ${(d.capabilities||[]).length} capabilities`);
    } catch(e) { L(`  ✗ Scoring parse error: ${e.message}`, 'error'); }
  }
  L(`✓ ${capabilities.length} capabilities scored`, 'success');

  // Validation pass
  L(''); L('── Validation ────────────────────────────────', 'stage');
  const issues = validateResult({ categories, vendors, capabilities });
  if (issues.length) {
    issues.forEach(i => L(`  ⚠ ${i}`, 'error'));
    L(`  ${issues.length} issues found — review before deploying`, 'error');
  } else {
    L('  ✓ All checks passed', 'success');
  }

  finalize(jobId, { categories, vendors, capabilities, meta:{ domain, persona, generatedAt:new Date().toISOString(), issues } });
}

// ── REFRESH PIPELINE ──────────────────────────────────────────────────────────
async function refreshPipeline(jobId, domain, existingData, brief, persona, apiKey) {
  const client = new Anthropic({ apiKey });
  const L = (m,lv='info') => log(jobId,m,lv);
  const { categories, vendors, capabilities } = existingData;
  L(`Refreshing: ${domain} | ${vendors.length} existing vendors`);

  // Step 1 — Staleness check
  L(''); L('── Step 1: Staleness Check ───────────────────', 'stage');
  const staleResp = await client.messages.create({
    model:'claude-sonnet-4-20250514', max_tokens:5000,
    system:`Check for vendor status changes since mid-2024. Search for acquisitions, IPOs, shutdowns, major funding rounds. Output ONLY valid JSON.`,
    tools:[{type:'web_search_20250305',name:'web_search'}],
    messages:[{role:'user',content:`Check these ${domain} vendors for recent changes:\n${vendors.map(v=>v.name).join(', ')}\n\nOutput: {"changes":[{"name":"VendorName","change_type":"acquired|ipo|shutdown|funding","description":"Brief description of change","new_status":"Public|Private|Acquired","new_funding":150,"acquirer":"Name or null","acq_price":500}]}\n\nOnly include vendors with confirmed, verifiable changes.`}]
  });
  let changes = [];
  try { changes = parseJSON(extractText(staleResp)).changes||[]; } catch {}
  changes.forEach(c => L(`  ↻ ${c.name}: ${c.change_type} — ${c.description}`));
  L(`✓ ${changes.length} status changes found`, 'success');

  // Step 2 — New vendor discovery
  L(''); L('── Step 2: New Vendor Discovery ─────────────', 'stage');
  const existingNames = new Set(vendors.map(v=>v.name.toLowerCase()));
  const newVendorResp = await client.messages.create({
    model:'claude-sonnet-4-20250514', max_tokens:8000,
    system:`Find new AI-native startups and recently-funded vendors not yet in the landscape. Focus on last 12 months. Verify each via web search. Output ONLY valid JSON.`,
    tools:[{type:'web_search_20250305',name:'web_search'}],
    messages:[{role:'user',content:`Domain: ${domain}\nCategories: ${categories.map(c=>c.name).join(', ')}\n${brief?`Context: ${brief.slice(0,300)}`:''}

Already in landscape (DO NOT include): ${[...existingNames].slice(0,50).join(', ')}

Find 5-20 genuinely new vendors. Search for: "${domain} startups 2025", "${domain} funding 2025", new players in each category.

Output: {"vendors":[{"name":"str","type":"AI-Native|Legacy","status":"Private","hq":"City","founded":2023,"funding":20,"valuation":null,"round_type":"Series A","round_amount":20,"round_date":"Jun 2025","acq_price":null,"acquirer":null,"employees":40,"arr":null,"investors":"VCNames","agentic":true,"cat":1,"desc":"2 sentences. What it does and why buyers care.","products":"Product A","capabilities":"Cap 1; Cap 2"}]}`}]
  });
  let newVendors = [];
  try {
    const d = parseJSON(extractText(newVendorResp));
    newVendors = (d.vendors||[]).filter(v=>!existingNames.has(v.name.toLowerCase()));
  } catch {}
  newVendors.forEach(v => L(`  + ${v.name} [${v.type}] → Cat ${v.cat}`));
  L(`✓ ${newVendors.length} new vendors found`, 'success');

  // Step 3 — Score new vendors
  let updatedCaps = capabilities;
  if (newVendors.length > 0) {
    L(''); L('── Step 3: Scoring New Vendors ───────────────', 'stage');
    const scoreResp = await client.messages.create({
      model:'claude-sonnet-4-20250514', max_tokens:6000,
      system:`Score new vendors 0-100 on existing capability dimensions. Use the same scale: 90+=Best-in-Class, 75-89=Strong, 60-74=Capable, 45-59=Present, 30-44=Limited, 0=N/A. Output ONLY valid JSON.`,
      messages:[{role:'user',content:`New vendors:\n${newVendors.map(v=>`${v.name} [${v.type}] Cat${v.cat}: ${v.desc}`).join('\n')}\n\nExisting capabilities:\n${capabilities.map(c=>`Cat${c.cat} "${c.name}": ${c.definition||''}`).join('\n')}\n\nOutput: {"scores":[{"vendor":"Name","capability":"Exact cap name","score":75}]}`}]
    });
    try {
      const d = parseJSON(extractText(scoreResp));
      updatedCaps = capabilities.map(cap => {
        const newScores = {...cap.scores};
        (d.scores||[]).filter(s=>s.capability===cap.name).forEach(s=>{ newScores[s.vendor]=s.score; });
        return {...cap, scores:newScores};
      });
      L(`✓ Scored ${newVendors.length} new vendors`, 'success');
    } catch(e) { L(`  Warning: score parse: ${e.message}`, 'error'); }
  }

  // Apply staleness updates
  const updatedVendors = vendors.map(v => {
    const c = changes.find(ch=>ch.name.toLowerCase()===v.name.toLowerCase());
    if (!c) return v;
    return {...v, status:c.new_status||v.status, funding:c.new_funding||v.funding, acquirer:c.acquirer||v.acquirer, acq_price:c.acq_price||v.acq_price};
  });
  const maxId = Math.max(...vendors.map(v=>v.id||0));
  newVendors.forEach((v,i) => { v.id=maxId+i+1; });
  const allVendors = [...updatedVendors, ...newVendors];

  L(`\n  ${vendors.length} → ${allVendors.length} vendors | +${newVendors.length} added | ${changes.length} updated`, 'success');

  finalize(jobId, {
    categories, vendors:allVendors, capabilities:updatedCaps,
    meta:{ domain, persona, generatedAt:new Date().toISOString(), refreshMeta:{ addedVendors:newVendors.map(v=>v.name), updatedVendors:changes.map(c=>c.name) } }
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend :${PORT}`));
