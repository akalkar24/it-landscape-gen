import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#080C14;--surface:#0D1424;--s2:#111827;--s3:#1A2338;--border:rgba(255,255,255,0.07);--b2:rgba(255,255,255,0.12);--text:#E2E8FF;--muted:#5A6A88;--m2:#8899BB;--blue:#3B82F6;--green:#10B981;--amber:#F59E0B;--red:#EF4444;--fd:'DM Serif Display',serif;--fs:'Syne',sans-serif;--fm:'JetBrains Mono',monospace}
body{background:var(--bg);color:var(--text);font-family:var(--fs)}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1A2338}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
input,textarea,select{color-scheme:dark}
input[type=number]{-moz-appearance:textfield}
input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
.editable{cursor:text;border-radius:3px;padding:1px 3px;transition:background 0.15s}
.editable:hover{background:rgba(255,255,255,0.07)}
.editable:focus{background:rgba(59,130,246,0.1);outline:1px solid rgba(59,130,246,0.4);outline-offset:0}
`;

const SAMPLE_BRIEFS = {
  "IT Infrastructure Management": `Domain: IT Infrastructure Management

Scope: Tools CIOs use to discover, monitor, provision, automate, and govern servers, networks, storage, cloud services, containers, and infrastructure configuration across on-prem, cloud, and hybrid environments.

Key vendors:
Legacy: VMware (Broadcom), ServiceNow ITOM, BMC Helix, IBM Instana, IBM Turbonomic, HPE GreenLake, Cisco AppDynamics, Datadog, SolarWinds, Dynatrace, Splunk (Cisco), New Relic, PagerDuty, HashiCorp (IBM), Puppet
AI-Native: Pulumi, Env0, Harness, OpsRamp (HPE), Spot.io (NetApp), Finout, Cortex, Port, Firefly, Anodot
Analyst: Gartner, Forrester, IDC, GigaOm

Out of scope: Application APM, endpoint/DEX, identity, network security, storage hardware

Market dynamics: FinOps explosion, AIOps replacing threshold monitoring, IaC maturity, platform engineering rise, Kubernetes management growth`,
  "IT Service Management": `Domain: IT Service Management (ITSM)

Scope: Tools managing IT service delivery — incident management, change management, service catalog, AI-powered virtual agents, knowledge management, and ESM expansion into HR/Finance/Legal.

Key vendors:
Legacy: ServiceNow, BMC Helix ITSM, Ivanti, Jira Service Management, Freshservice, ManageEngine, TOPdesk, EasyVista, Cherwell
AI-Native: Moveworks, Aisera, Atomicwork, Rezolve.ai, Espressive, Leena AI
Analyst: Gartner, Forrester, HDI, Info-Tech Research Group

Out of scope: CMDB/infrastructure discovery, endpoint management, HR systems

Market dynamics: GenAI Tier 0/1 deflection, ServiceNow dominance, ESM expansion, Slack/Teams as primary ITSM channel`
};

// ── EXCEL EXPORT (client-side, no library needed — CSV fallback) ──────────────
function exportToExcel(result, domain) {
  // We'll create a multi-sheet workbook using the SheetJS CDN loaded dynamically
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  script.onload = () => {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Summary
    const sumRows = [
      ['Landscape Report', domain],
      ['Generated', new Date().toLocaleDateString()],
      [''],
      ['Metric', 'Count'],
      ['Total Categories', result.categories.length],
      ['Total Vendors', result.vendors.length],
      ['AI-Native Vendors', result.vendors.filter(v=>v.type==='AI-Native').length],
      ['Legacy Vendors', result.vendors.filter(v=>v.type==='Legacy').length],
      ['Analyst / Research', result.vendors.filter(v=>v.type==='Analyst').length],
      ['Agentic AI Vendors', result.vendors.filter(v=>v.agentic).length],
      ['Capabilities Tracked', result.capabilities.length],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sumRows);
    ws1['!cols'] = [{wch:30},{wch:30}];
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

    // ── Sheet 2: Categories
    const catHeaders = ['ID','Phase','Name','Short Name','Market TAM','CAGR','Description','Capabilities Preview','Gartner Market Name','Vendor Count'];
    const catData = result.categories.map(c => [
      c.id, c.phase, c.name, c.short||'', c.market, c.cagr, c.desc,
      (c.capabilities_preview||[]).join('; '), c.gartner||'',
      result.vendors.filter(v=>v.cat===c.id).length
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([catHeaders, ...catData]);
    ws2['!cols'] = [5,8,25,15,12,8,50,40,30,12].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws2, 'Categories');

    // ── Sheet 3: Vendors
    const vendorHeaders = ['ID','Name','Type','Agentic AI','Category','Phase','Status','HQ','Founded','Employees','Funding ($M)','Valuation ($M)','ARR ($M)','Round Type','Round Amount ($M)','Round Date','Ticker','Acquirer','Acq Price ($M)','Investors','Description','Core Products','Capabilities'];
    const vendorData = result.vendors.map(v => {
      const cat = result.categories.find(c=>c.id===v.cat)||{};
      return [v.id, v.name, v.type, v.agentic?'Yes':'', cat.name||'', cat.phase||'', v.status||'', v.hq||'', v.founded||'', v.employees||'', v.funding||'', v.valuation||'', v.arr||'', v.round_type||'', v.round_amount||'', v.round_date||'', v.ticker||'', v.acquirer||'', v.acq_price||'', v.investors||'', v.desc||'', v.products||'', v.capabilities||''];
    });
    const ws3 = XLSX.utils.aoa_to_sheet([vendorHeaders, ...vendorData]);
    ws3['!cols'] = [5,22,12,9,25,8,10,20,8,10,12,12,10,12,15,12,10,20,12,30,50,35,50].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws3, 'Vendors');

    // ── Sheet 4: Capability Matrix (heatmap format)
    const vendorNames = result.vendors.map(v=>v.name);
    const matrixHeader = ['Category','Phase','Capability','Definition', ...vendorNames];
    const matrixData = result.capabilities.map(cap => {
      const cat = result.categories.find(c=>c.id===cap.cat)||{};
      return [cat.name||'', cat.phase||'', cap.name, cap.definition||'', ...vendorNames.map(n=>(cap.scores||{})[n]||0)];
    });
    const ws4 = XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixData]);
    ws4['!cols'] = [{wch:25},{wch:10},{wch:30},{wch:50}, ...vendorNames.map(()=>({wch:12}))];
    XLSX.utils.book_append_sheet(wb, ws4, 'Capability Matrix');

    // ── Sheet 5: Schema Reference (for web team)
    const schemaRows = [
      ['JSON SCHEMA REFERENCE — for web team integration',''],[''],
      ['categories[]','Array of value-chain categories'],
      ['  .id','Integer — category ID (1-based)'],
      ['  .phase','ALL CAPS verb label (e.g. DISCOVER)'],
      ['  .name','Full category name'],
      ['  .short','Abbreviated name for compact UI'],
      ['  .market','TAM string (e.g. "$8.5B")'],
      ['  .cagr','CAGR string (e.g. "18%")'],
      ['  .color','Hex color for UI rendering'],
      ['  .dim','RGBA dim color for backgrounds'],
      ['  .desc','2-3 sentence description'],
      ['  .capabilities_preview','Array of 5 specific capability names'],
      ['  .gartner','Official Gartner market segment name'],
      [''],
      ['vendors[]','Array of vendor profiles'],
      ['  .id','Integer — sequential vendor ID'],
      ['  .cat','Integer — maps to categories[].id'],
      ['  .name','Official vendor/product name'],
      ['  .type','"Legacy" | "AI-Native" | "Analyst"'],
      ['  .status','"Public" | "Private" | "Acquired" | "Division"'],
      ['  .ticker','Stock ticker or null'],
      ['  .hq','City, Country'],
      ['  .founded','Integer year'],
      ['  .funding','Total funding raised USD millions (integer) or null'],
      ['  .valuation','Last private valuation USD millions or null'],
      ['  .arr','Annual recurring revenue USD millions or null'],
      ['  .agentic','Boolean — has agentic AI capabilities'],
      ['  .desc','2-sentence vendor description'],
      ['  .products','Comma-separated product names'],
      ['  .capabilities','Semicolon-separated capability phrases'],
      [''],
      ['capabilities[]','Array of scored capability dimensions'],
      ['  .cat','Integer — maps to categories[].id'],
      ['  .name','Capability name (specific noun phrase)'],
      ['  .definition','One sentence definition'],
      ['  .scores',`Object mapping vendor names → integer 0-100`],
      [''],
      ['Score Scale',''],
      ['90-100','Best-in-Class — market leader for this capability'],
      ['75-89','Strong — top tier, frequently cited as strength'],
      ['60-74','Capable — functional but not a primary differentiator'],
      ['45-59','Present — exists but limited depth'],
      ['30-44','Limited — minimal implementation'],
      ['0','Not applicable'],
    ];
    const ws5 = XLSX.utils.aoa_to_sheet(schemaRows);
    ws5['!cols'] = [{wch:35},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws5, 'Schema Reference');

    const filename = `${domain.replace(/\s+/g,'-').toLowerCase()}-landscape-${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  };
  document.head.appendChild(script);
}

// ── JSON DOWNLOAD (annotated for web team) ────────────────────────────────────
function downloadJSON(result, domain) {
  const output = {
    _schema_version: '1.0',
    _generated: new Date().toISOString(),
    _domain: domain,
    _notes: {
      categories: 'Value-chain taxonomy. Use .color and .dim for UI theming. .phase is the short label for the value chain strip.',
      vendors: 'Each vendor has .cat (maps to categories[].id) for filtering. Financial fields are USD millions integers or null.',
      capabilities: 'Each capability has .scores object mapping vendor names to 0-100 integers. 0 = not applicable.',
      score_scale: { '90-100':'Best-in-Class','75-89':'Strong','60-74':'Capable','45-59':'Present','30-44':'Limited','0':'N/A' }
    },
    ...result
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${domain.replace(/\s+/g,'-').toLowerCase()}-landscape.json`;
  a.click();
}

// ── INLINE EDIT HELPERS ───────────────────────────────────────────────────────
function EditableText({ value, onChange, style={}, multiline=false, type='text' }) {
  if (multiline) return (
    <textarea
      className="editable"
      defaultValue={value}
      onBlur={e => onChange(e.target.value)}
      rows={3}
      style={{ background:'transparent', border:'none', color:'inherit', fontFamily:'inherit', fontSize:'inherit', lineHeight:'inherit', resize:'vertical', width:'100%', ...style }}
    />
  );
  return (
    <span
      className="editable"
      contentEditable
      suppressContentEditableWarning
      onBlur={e => onChange(e.target.innerText)}
      style={style}
    >
      {value}
    </span>
  );
}

function EditableNumber({ value, onChange, style={} }) {
  return (
    <input
      type="number"
      defaultValue={value ?? ''}
      onBlur={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      placeholder="—"
      style={{ background:'transparent', border:'none', color:'inherit', fontFamily:'var(--fm)', fontSize:'inherit', width:70, textAlign:'right', ...style }}
    />
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("home");
  const [mode, setMode] = useState("build");
  const [form, setForm] = useState({ domain:"", brief:"", persona:"CIO", apiKey:"" });
  const [jobId, setJobId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [existingJson, setExistingJson] = useState("");
  const [refreshTab, setRefreshTab] = useState("library"); // library | upload | paste
  const [existingData, setExistingData] = useState(null);  // parsed landscape object
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [refreshInputLabel, setRefreshInputLabel] = useState(null); // display name of loaded landscape
  const xlsxFileRef = useRef(null);
  const [reviewTab, setReviewTab] = useState("vendors");
  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState(null);
  const [vercelToken, setVercelToken] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCat, setFilterCat] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const logsRef = useRef(null);

  useEffect(() => { logsRef.current?.scrollTo(0, logsRef.current.scrollHeight); }, [logs]);

  // Poll for result
  useEffect(() => {
  if (!jobId || view !== "running") return;
  const poll = setInterval(async () => {
  try {
  const d = await fetch(${API}/api/job/${jobId}/result).then(r=>r.json());
  if (d.status === 'review') {
  setResult(d.result); setJobStatus('review'); setView('review'); clearInterval(poll);
  } else if (d.status === 'error') {
  setError(d.error || 'Pipeline failed — check logs for details');
  setView('home');
  clearInterval(poll);
  } else if (d.status === 'cancelled') {
  // User hit Stop — cancelJob() already reset view, just stop polling
  clearInterval(poll);
  }
  } catch {}
  }, 3000);
  return () => clearInterval(poll);
  }, [jobId, view]);

  // Load library when switching to refresh mode
  useEffect(() => {
    if (mode !== 'refresh') return;
    setLibraryLoading(true);
    fetch(`${API}/api/library`).then(r=>r.json()).then(d=>{ setLibrary(d); setLibraryLoading(false); }).catch(()=>setLibraryLoading(false));
  }, [mode]);

  function parseExcelForRefresh(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const XLSX = window.XLSX;
            const wb = XLSX.read(e.target.result, { type:'array' });
            // Parse Categories tab (index 1 — first tab is Summary in APM export)
            const catSheet = wb.Sheets[wb.SheetNames.find(n=>n.toLowerCase().includes('categor'))||wb.SheetNames[1]];
            const catRows = XLSX.utils.sheet_to_json(catSheet||wb.Sheets[wb.SheetNames[0]], { header:1 });
            const CAT_COLORS = [["#3B82F6","rgba(59,130,246,0.1)"],["#8B5CF6","rgba(139,92,246,0.1)"],["#0D9488","rgba(13,148,136,0.1)"],["#D97706","rgba(217,119,6,0.1)"],["#DC2626","rgba(220,38,38,0.1)"],["#475569","rgba(71,85,105,0.15)"],["#0891B2","rgba(8,145,178,0.1)"],["#7C3AED","rgba(124,58,237,0.1)"],["#059669","rgba(5,150,105,0.1)"],["#BE185D","rgba(190,24,93,0.1)"]];
            const hdr = catRows[0]||[];
            const col = k => hdr.findIndex(h=>(h||'').toString().toLowerCase().includes(k.toLowerCase()));
            const categories = catRows.slice(1).filter(r=>r[col('name')||col('categor')]||r[1]).map((r,i)=>({
              id:i+1, phase:(r[col('phase')]||r[0]||'CAT'+(i+1)).toString().toUpperCase().slice(0,12),
              name:(r[col('name')]||r[col('categor')]||r[1]||'Category '+(i+1)).toString(),
              short:(r[col('short')]||r[2]||'').toString(),
              market:(r[col('market')]||r[3]||'').toString(), cagr:(r[col('cagr')]||r[4]||'').toString(),
              desc:(r[col('desc')]||r[5]||'').toString(),
              capabilities_preview:((r[col('capabilit')]||r[6])||'').toString().split(',').map(x=>x.trim()).filter(Boolean),
              gartner:(r[col('gartner')]||r[7]||'').toString(),
              color:CAT_COLORS[i%10][0], dim:CAT_COLORS[i%10][1]
            })).filter(c=>c.name&&!c.name.startsWith('─'));

            // Parse Vendors tab
            const vSheet = wb.Sheets[wb.SheetNames.find(n=>n.toLowerCase().includes('vendor'))||wb.SheetNames[2]];
            const vRows = XLSX.utils.sheet_to_json(vSheet||wb.Sheets[wb.SheetNames[1]], { header:1 });
            const vh = vRows[0]||[];
            const vc = k => vh.findIndex(h=>(h||'').toString().toLowerCase().includes(k.toLowerCase()));
            const catNameToId = Object.fromEntries(categories.map(c=>[c.name.toLowerCase().slice(0,20), c.id]));
            const vendors = vRows.slice(1).filter(r=>r[vc('vendor')||vc('name')]||r[3]).map((r,i)=>{
              const name = (r[vc('vendor')]||r[vc('name')]||r[3]||'').toString().trim();
              const catRaw = (r[vc('categor')]||r[2]||'').toString().toLowerCase().slice(0,20);
              const catId = Number(r[vc('cat id')]||r[1]) || catNameToId[catRaw] || Object.entries(catNameToId).find(([k])=>catRaw.includes(k.slice(0,10)))?.[1] || 1;
              return {
                id:i+1, cat:catId, name, type:(r[vc('type')]||r[4]||'Legacy').toString(),
                status:(r[vc('status')]||r[5]||'Private').toString(),
                founded:r[vc('founded')]?Number(r[vc('founded')]):null, hq:(r[vc('hq')]||r[7]||'').toString(),
                ticker:(r[vc('ticker')]||r[8]||null)||null,
                funding:r[vc('funding')]!=null?Number(r[vc('funding')])||null:null,
                valuation:r[vc('valuat')]!=null?Number(r[vc('valuat')])||null:null,
                arr:r[vc('arr')]!=null?Number(r[vc('arr')])||null:null,
                employees:r[vc('employ')]!=null?Number(r[vc('employ')])||null:null,
                investors:(r[vc('invest')]||'').toString(), agentic:(r[vc('agentic')]||'').toString().toLowerCase()==='yes',
                desc:(r[vc('desc')]||r[20]||'').toString(), products:(r[vc('product')]||r[21]||'').toString(),
                capabilities:(r[vc('capabilit')]||r[22]||'').toString()
              };
            }).filter(v=>v.name);

            // Parse Capability Matrix tab
            const capSheet = wb.Sheets[wb.SheetNames.find(n=>n.toLowerCase().includes('matrix')||n.toLowerCase().includes('capabilit'))||wb.SheetNames[3]];
            const capRows = XLSX.utils.sheet_to_json(capSheet||wb.Sheets[wb.SheetNames[2]], { header:1 });
            const capHdr = capRows[0]||[];
            const vendorColStart = 4;
            const vendorNamesInSheet = capHdr.slice(vendorColStart).map(v=>(v||'').toString());
            const capabilities = capRows.slice(1).filter(r=>r[2]&&!r[2].toString().startsWith('─')).map(r=>({
              cat: Number(r[0])||1,
              name:(r[2]||'').toString(),
              definition:(r[3]||'').toString(),
              scores: Object.fromEntries(vendorNamesInSheet.map((vn,i)=>[vn, Number(r[vendorColStart+i])||0]).filter(([k])=>k))
            }));

            resolve({ categories, vendors, capabilities });
          } catch(err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
      };
      if (window.XLSX) { script.onload(); } else { document.head.appendChild(script); }
    });
  }

  async function handleRefreshFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const data = JSON.parse(text);
        setExistingData(data);
        setRefreshInputLabel(`${file.name} (JSON)`);
        if (data.domain && !form.domain) setForm(p=>({...p, domain:data.domain}));
      } else {
        const data = await parseExcelForRefresh(file);
        setExistingData(data);
        setRefreshInputLabel(`${file.name} (Excel — ${data.vendors?.length||0} vendors, ${data.categories?.length||0} categories)`);
      }
    } catch(err) { setError('Could not parse file: ' + err.message); }
    e.target.value = '';
  }

  async function handleRefreshFromLibrary(item) {
    try {
      const data = await fetch(`${API}/api/library/${item.id}`).then(r=>r.json());
      setExistingData({ categories:data.categories, vendors:data.vendors, capabilities:data.capabilities });
      setRefreshInputLabel(`${item.domain} — saved ${new Date(item.savedAt).toLocaleDateString()}`);
      if (!form.domain) setForm(p=>({...p, domain:item.domain}));
    } catch(err) { setError('Could not load: ' + err.message); }
  }

  async function startJob() {
    setError(null); setLogs([]); setResult(null); setDeployUrl(null);
    try {
      const endpoint = mode === 'build' ? '/api/generate' : '/api/refresh';
      let body = { domain:form.domain, brief:form.brief, persona:form.persona, apiKey:form.apiKey };
      if (mode === 'refresh') {
        let parsed = existingData;
        if (!parsed && existingJson.trim()) { try { parsed = JSON.parse(existingJson); } catch { setError('Invalid JSON — check the paste tab'); return; } }
        if (!parsed) { setError('Load a landscape first — from library, file upload, or paste'); return; }
        body.existingData = parsed;
      }
      const resp = await fetch(`${API}${endpoint}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      const d = await resp.json();
      if (!resp.ok) { setError(d.error); return; }
      setJobId(d.jobId); setStartedAt(Date.now()); setElapsed(0); setView('running');
      const es = new EventSource(`${API}/api/job/${d.jobId}`);
      es.onmessage = e => {
      const entry = JSON.parse(e.data);
      if (entry.msg === '__DONE__') {
        es.close();
        return;
      }
      if (entry.msg === '__ERROR__') {
        es.close();
        setError('Pipeline failed — check the log above for details');
        setView('home');
        return;
      }
      if (entry.msg === '__CANCELLED__') {
        // cancelJob() already handles view transition, just close the stream
        es.close();
        return;
      }
      setLogs(prev => [...prev, entry]);
    };
    es.onerror = () => { es.close(); };
    
    } catch(e) { setError(e.message); }
  }

  // Elapsed timer — ticks every second while running
  useEffect(() => {
    if (view !== 'running' || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now()-startedAt)/1000)), 1000);
    return () => clearInterval(t);
  }, [view, startedAt]);

  async function cancelJob() {
    if (!jobId) return;
    try { await fetch(`${API}/api/job/${jobId}/cancel`, { method:'POST' }); } catch {}
    setView('home'); setJobId(null); setLogs([]); setStartedAt(null); setElapsed(0);
  }

  async function approve() {
    await fetch(`${API}/api/job/${jobId}/approve`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({result}) });
    setJobStatus('approved');
  }

  async function deploy() {
    if (!vercelToken && !process.env.VITE_HAS_VERCEL_TOKEN) {
      const t = prompt('Enter your Vercel token (from vercel.com/account/tokens):');
      if (!t) return;
      setVercelToken(t);
    }
    setDeploying(true);
    try {
      const resp = await fetch(`${API}/api/job/${jobId}/deploy`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ vercelToken, result }) });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error);
      setDeployUrl(d.url); setJobStatus('deployed');
    } catch(e) { alert('Deploy error: ' + e.message); }
    finally { setDeploying(false); }
  }

  // Inline edit helpers
  function updateVendor(vendorId, field, value) {
    setResult(prev => ({...prev, vendors: prev.vendors.map(v => v.id===vendorId ? {...v, [field]:value} : v)}));
  }
  function updateCapScore(capIdx, vendorName, value) {
    setResult(prev => ({...prev, capabilities: prev.capabilities.map((c,i) => i===capIdx ? {...c, scores:{...c.scores,[vendorName]:value}} : c)}));
  }

  // Filtered vendors
  const filteredVendors = result?.vendors?.filter(v => {
    if (filterType !== 'all' && v.type !== filterType) return false;
    if (filterCat !== null && v.cat !== filterCat) return false;
    if (searchQ) { const h = `${v.name} ${v.desc||''} ${v.products||''}`.toLowerCase(); if (!h.includes(searchQ.toLowerCase())) return false; }
    return true;
  }) || [];

  const LC = lv => ({stage:'#93C5FD',success:'#6EE7B7',error:'#FCA5A5',info:'#4B5A78'})[lv]||'#4B5A78';
  const Btn = ({onClick,children,color='#3B82F6',disabled=false,style={}}) => (
    <button onClick={onClick} disabled={disabled} style={{padding:'9px 20px',background:disabled?'rgba(59,130,246,0.2)':color,color:'#fff',border:'none',borderRadius:7,cursor:disabled?'not-allowed':'pointer',fontFamily:'var(--fs)',fontWeight:700,fontSize:13,...style}}>{children}</button>
  );
  const Tag = ({children,color='#3B82F6',bg}) => (
    <span style={{fontFamily:'var(--fm)',fontSize:8,fontWeight:700,color,background:bg||color+'18',border:`1px solid ${color}30`,padding:'2px 7px',borderRadius:3,letterSpacing:.5}}>{children}</span>
  );

  const SCORE_BG = s => !s?'rgba(255,255,255,0.04)':s>=90?'#14532D':s>=75?'#166534':s>=60?'#15803D':s>=45?'#854D0E':'#7C2D12';

  return (
    <>
      <style>{css}</style>

      {/* NAV */}
      <nav style={{position:'fixed',top:0,left:0,right:0,height:52,background:'rgba(8,12,20,0.95)',backdropFilter:'blur(20px)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 32px',zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,borderRadius:6,background:'linear-gradient(135deg,#3B82F6,#6D28D9)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--fm)',fontSize:10,fontWeight:700,color:'#fff'}}>LG</div>
          <span style={{fontFamily:'var(--fd)',fontSize:15}}>Landscape Generator</span>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {view==='review' && result?.meta?.issues?.length>0 && <span style={{fontFamily:'var(--fm)',fontSize:10,color:'#FCA5A5',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',padding:'4px 10px',borderRadius:5}}>⚠ {result.meta.issues.length} issues</span>}
          {view!=='home' && <button onClick={()=>{setView('home');setLogs([]);setJobId(null);setResult(null);setDeployUrl(null);}} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--muted)',padding:'5px 14px',borderRadius:6,cursor:'pointer',fontFamily:'var(--fm)',fontSize:11}}>← New</button>}
        </div>
      </nav>

      <div style={{paddingTop:52}}>

        {/* ── HOME ─────────────────────────────────────────────────────────── */}
        {view==='home' && (
          <div style={{maxWidth:740,margin:'0 auto',padding:'56px 32px',animation:'fadeUp 0.5s ease'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
              <div style={{width:32,height:1,background:'var(--blue)'}}/>
              <span style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--blue)',letterSpacing:4,textTransform:'uppercase'}}>CIO Intelligence Series</span>
            </div>
            <h1 style={{fontFamily:'var(--fd)',fontSize:clamp(36,52),lineHeight:1.1,marginBottom:10}}>Technology<br/><span style={{fontStyle:'italic',color:'#93C5FD'}}>Landscape Generator</span></h1>
            <p style={{color:'var(--m2)',fontSize:14,lineHeight:1.7,marginBottom:36,maxWidth:500}}>Generate comprehensive technology landscapes — 80-120 vendors, value-chain categories, and capability scoring — powered by Claude with live web research.</p>

            {/* Mode toggle */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:28}}>
              {[['build','🔨 New Landscape','Research and generate from scratch (~35 min)'],['refresh','↻ Refresh Existing','Update vendors and add new entrants (~15 min)']].map(([m,label,desc])=>(
                <div key={m} onClick={()=>setMode(m)} style={{padding:'16px 18px',background:mode===m?'rgba(59,130,246,0.08)':'var(--surface)',border:`1px solid ${mode===m?'rgba(59,130,246,0.3)':'var(--border)'}`,borderRadius:10,cursor:'pointer',transition:'all 0.15s'}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{label}</div>
                  <div style={{fontSize:12,color:'var(--m2)'}}>{desc}</div>
                </div>
              ))}
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {/* Domain */}
              <div>
                <label style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--muted)',letterSpacing:2,textTransform:'uppercase',display:'block',marginBottom:7}}>Domain Name *</label>
                <input value={form.domain} onChange={e=>setForm(p=>({...p,domain:e.target.value}))} placeholder="e.g. IT Infrastructure Management" style={{width:'100%',padding:'10px 13px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontFamily:'var(--fs)',fontSize:14,outline:'none'}}/>
              </div>

              {/* Brief */}
              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7}}>
                  <label style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--muted)',letterSpacing:2,textTransform:'uppercase'}}>Domain Brief *</label>
                  <div style={{display:'flex',gap:6}}>
                    {Object.keys(SAMPLE_BRIEFS).map(k=>(
                      <button key={k} onClick={()=>setForm(p=>({...p,brief:SAMPLE_BRIEFS[k],domain:p.domain||k}))} style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--blue)',background:'rgba(59,130,246,0.07)',border:'1px solid rgba(59,130,246,0.15)',padding:'3px 10px',borderRadius:4,cursor:'pointer'}}>Use {k.split(' ')[1]} brief</button>
                    ))}
                  </div>
                </div>
                <textarea value={form.brief} onChange={e=>setForm(p=>({...p,brief:e.target.value}))} rows={8} placeholder="Describe the domain, scope, key vendors, and what's out of scope..." style={{width:'100%',padding:'10px 13px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontFamily:'var(--fs)',fontSize:13,outline:'none',resize:'vertical',lineHeight:1.65}}/>
              </div>

              {/* Refresh — 3-tab landscape loader */}
              {mode==='refresh' && (
                <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                  {/* Tab bar */}
                  <div style={{display:'flex',borderBottom:'1px solid var(--border)'}}>
                    {[['library','📚 Saved Landscapes'],['upload','↑ Upload File'],['paste','{ } Paste JSON']].map(([t,lbl])=>(
                      <button key={t} onClick={()=>setRefreshTab(t)} style={{flex:1,padding:'9px 0',border:'none',cursor:'pointer',fontFamily:'var(--fm)',fontSize:10,background:refreshTab===t?'var(--s2)':'transparent',color:refreshTab===t?'var(--text)':'var(--muted)',borderBottom:refreshTab===t?'2px solid var(--blue)':'2px solid transparent'}}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {/* Library tab */}
                  {refreshTab==='library' && (
                    <div style={{padding:'14px',minHeight:120,maxHeight:240,overflowY:'auto'}}>
                      {libraryLoading && <div style={{color:'var(--muted)',fontSize:12,fontFamily:'var(--fm)'}}>Loading saved landscapes...</div>}
                      {!libraryLoading && library.length===0 && (
                        <div style={{color:'var(--muted)',fontSize:12,textAlign:'center',padding:'20px 0'}}>
                          No saved landscapes yet.<br/>
                          <span style={{fontSize:11,opacity:.6}}>Landscapes are auto-saved when you approve a run.</span>
                        </div>
                      )}
                      {library.map(item=>(
                        <div key={item.id} onClick={()=>handleRefreshFromLibrary(item)}
                          style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderRadius:7,cursor:'pointer',marginBottom:6,
                          background:refreshInputLabel?.startsWith(item.domain)?'rgba(59,130,246,0.1)':'rgba(255,255,255,0.02)',
                          border:`1px solid ${refreshInputLabel?.startsWith(item.domain)?'rgba(59,130,246,0.3)':'rgba(255,255,255,0.06)'}`}}>
                          <div>
                            <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{item.domain}</div>
                            <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--fm)'}}>{item.vendorCount} vendors · {item.categoryCount} categories · saved {new Date(item.savedAt).toLocaleDateString()}</div>
                          </div>
                          <div style={{fontSize:11,color:'var(--blue)',fontFamily:'var(--fm)'}}>Select →</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload tab */}
                  {refreshTab==='upload' && (
                    <div style={{padding:'20px',textAlign:'center'}}>
                      <input ref={xlsxFileRef} type="file" accept=".json,.xlsx,.xls" onChange={handleRefreshFileUpload} style={{display:'none'}}/>
                      <div style={{marginBottom:12,color:'var(--muted)',fontSize:12,lineHeight:1.6}}>
                        Upload the Excel export from a previous landscape<br/>
                        <span style={{fontSize:11,opacity:.6}}>(.xlsx or .xls) — or a JSON export (.json)</span>
                      </div>
                      <button onClick={()=>xlsxFileRef.current?.click()} style={{padding:'9px 22px',background:'rgba(59,130,246,0.1)',border:'1px solid rgba(59,130,246,0.3)',borderRadius:7,color:'var(--blue)',cursor:'pointer',fontFamily:'var(--fm)',fontSize:11,fontWeight:600}}>
                        Choose File
                      </button>
                      {refreshInputLabel && refreshTab==='upload' && (
                        <div style={{marginTop:10,fontSize:11,color:'var(--green)',fontFamily:'var(--fm)'}}>✓ {refreshInputLabel}</div>
                      )}
                    </div>
                  )}

                  {/* Paste tab */}
                  {refreshTab==='paste' && (
                    <div style={{padding:'12px'}}>
                      <textarea value={existingJson} onChange={e=>setExistingJson(e.target.value)} rows={5}
                        placeholder='{"categories":[...],"vendors":[...],"capabilities":[...]}'
                        style={{width:'100%',padding:'10px 13px',background:'transparent',border:'none',color:'var(--text)',fontFamily:'var(--fm)',fontSize:11,outline:'none',resize:'vertical'}}/>
                    </div>
                  )}

                  {/* Selected landscape indicator */}
                  {refreshInputLabel && refreshTab!=='upload' && (
                    <div style={{padding:'8px 14px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(16,185,129,0.04)'}}>
                      <div style={{fontSize:11,color:'var(--green)',fontFamily:'var(--fm)'}}>✓ Loaded: {refreshInputLabel}</div>
                      <button onClick={()=>{setExistingData(null);setRefreshInputLabel(null);setExistingJson('');}} style={{fontSize:10,color:'var(--muted)',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--fm)'}}>✕ clear</button>
                    </div>
                  )}
                </div>
              )}

              <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:12}}>
                <div>
                  <label style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--muted)',letterSpacing:2,textTransform:'uppercase',display:'block',marginBottom:7}}>Buyer Persona</label>
                  <input value={form.persona} onChange={e=>setForm(p=>({...p,persona:e.target.value}))} placeholder="CIO" style={{width:'100%',padding:'10px 13px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontFamily:'var(--fs)',fontSize:14,outline:'none'}}/>
                </div>
                <div>
                  <label style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--muted)',letterSpacing:2,textTransform:'uppercase',display:'block',marginBottom:7}}>Anthropic API Key <span style={{opacity:.4}}>(leave blank to use shared key)</span></label>
                  <input value={form.apiKey} onChange={e=>setForm(p=>({...p,apiKey:e.target.value}))} type="password" placeholder="sk-ant-... (optional)" style={{width:'100%',padding:'10px 13px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontFamily:'var(--fm)',fontSize:13,outline:'none'}}/>
                </div>
              </div>

              {error && <div style={{padding:'11px 15px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:7,color:'#FCA5A5',fontSize:13}}>✗ {error}</div>}

              <Btn onClick={startJob} disabled={!form.domain||!form.brief} style={{padding:'13px'}}>
                {mode==='build' ? 'Generate New Landscape →' : 'Start Refresh →'}
              </Btn>
              <p style={{fontSize:11,color:'var(--muted)',textAlign:'center'}}>All results are reviewed by you before deployment. Data is never automatically published.</p>
            </div>
          </div>
        )}

        {/* ── RUNNING ──────────────────────────────────────────────────────── */}
        {view==='running' && (
  <div style={{maxWidth:760,margin:'0 auto',padding:'50px 32px'}}>
    <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:24,flexWrap:'wrap'}}>
      <div style={{width:18,height:18,border:'2px solid var(--blue)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
      <h2 style={{fontFamily:'var(--fd)',fontSize:28,flex:1,minWidth:0}}>{mode==='build'?'Building':'Refreshing'}: {form.domain}</h2>
      <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
        <div style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--muted)',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,padding:'5px 14px',whiteSpace:'nowrap'}}>
          ⏱ {Math.floor(elapsed/60)}m {String(elapsed%60).padStart(2,'0')}s
        </div>
        <button onClick={cancelJob} style={{padding:'5px 16px',background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.4)',borderRadius:7,color:'#FCA5A5',cursor:'pointer',fontFamily:'var(--fm)',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
          ✕ Cancel Run
        </button>
      </div>
    </div>
    <div ref={logsRef} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:'18px 22px',height:440,overflowY:'auto',fontFamily:'var(--fm)',fontSize:11.5,lineHeight:1.9}}>
      {logs.length===0 && <span style={{color:'var(--muted)',animation:'pulse 1.5s ease infinite'}}>Connecting to pipeline...</span>}
      {logs.map((e,i)=>(
        <div key={i} style={{color:LC(e.level),paddingLeft:e.level==='stage'?0:14,display:'flex',gap:10}}>
          <span style={{color:'rgba(255,255,255,0.18)',flexShrink:0,userSelect:'none'}}>{e.t?new Date(e.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}</span>
          <span>{e.msg}</span>
        </div>
      ))}
    </div>
    <p style={{marginTop:14,fontSize:11,color:'var(--muted)',textAlign:'center'}}>Running in the cloud — this tab can stay open or you can close and come back</p>
  </div>
        )}

        {/* ── REVIEW ───────────────────────────────────────────────────────── */}
        {view==='review' && result && (
          <div style={{maxWidth:1300,margin:'0 auto',padding:'44px 32px'}}>

            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:28,flexWrap:'wrap',gap:14}}>
              <div>
                <h2 style={{fontFamily:'var(--fd)',fontSize:34,marginBottom:6}}>Review: {form.domain}</h2>
                <p style={{color:'var(--m2)',fontSize:13}}>Click any cell to edit inline. Approve when ready, then deploy or download.</p>
                {result.meta?.refreshMeta && (
                  <div style={{marginTop:10,padding:'8px 14px',background:'rgba(16,185,129,0.07)',border:'1px solid rgba(16,185,129,0.15)',borderRadius:6,fontSize:12,color:'#6EE7B7'}}>
                    ↻ +{result.meta.refreshMeta.addedVendors?.length||0} new vendors · {result.meta.refreshMeta.updatedVendors?.length||0} updated
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <Btn onClick={()=>downloadJSON(result,form.domain)} color='#1A2338' style={{border:'1px solid var(--border)',color:'var(--m2)'}}>↓ JSON for Web Team</Btn>
                <Btn onClick={()=>exportToExcel(result,form.domain)} color='#1A3620' style={{border:'1px solid rgba(16,185,129,0.2)',color:'#6EE7B7'}}>↓ Export Excel</Btn>
                <Btn onClick={approve} color={jobStatus==='approved'?'#059669':'#10B981'}>{jobStatus==='approved'?'✓ Approved':'✓ Approve'}</Btn>
                {jobStatus==='approved' && !deployUrl && (
                  <Btn onClick={deploy} disabled={deploying} color='#3B82F6'>{deploying?'Deploying...':'⚡ Deploy to Vercel'}</Btn>
                )}
              </div>
            </div>

            {/* Deploy result */}
            {deployUrl && (
              <div style={{padding:'14px 20px',background:'rgba(59,130,246,0.07)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:10,marginBottom:24,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:14}}>✓ Live landscape: <a href={deployUrl} target="_blank" style={{color:'#93C5FD'}}>{deployUrl}</a></span>
                <span style={{fontFamily:'var(--fm)',fontSize:11,color:'var(--muted)'}}>Vercel · Interactive prototype</span>
              </div>
            )}

            {/* Validation issues */}
            {result.meta?.issues?.length>0 && (
              <div style={{padding:'12px 18px',background:'rgba(239,68,68,0.06)',border:'1px solid rgba(239,68,68,0.18)',borderRadius:8,marginBottom:20}}>
                <div style={{fontFamily:'var(--fm)',fontSize:9,letterSpacing:2,color:'#FCA5A5',marginBottom:8}}>VALIDATION WARNINGS</div>
                {result.meta.issues.map((iss,i)=><div key={i} style={{fontSize:12,color:'rgba(252,165,165,0.8)',padding:'2px 0'}}>⚠ {iss}</div>)}
              </div>
            )}

            {/* Stats */}
            <div style={{display:'flex',gap:12,marginBottom:28,flexWrap:'wrap'}}>
              {[[result.categories?.length,'Categories','#8B5CF6'],[result.vendors?.length,'Vendors','#3B82F6'],[result.vendors?.filter(v=>v.type==='AI-Native').length,'AI-Native','#F59E0B'],[result.vendors?.filter(v=>v.agentic).length,'Agentic AI','#10B981'],[result.capabilities?.length,'Capabilities','#0891B2']].map(([v,l,c])=>(
                <div key={l} style={{padding:'13px 18px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:9,borderTop:`2px solid ${c}`}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:22,fontWeight:700,color:c}}>{v}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Review tabs */}
            <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'1px solid var(--border)',paddingBottom:0}}>
              {['vendors','categories','matrix'].map(t=>(
                <button key={t} onClick={()=>setReviewTab(t)} style={{padding:'8px 18px',background:'transparent',border:'none',borderBottom:`2px solid ${reviewTab===t?'var(--blue)':'transparent'}`,color:reviewTab===t?'var(--text)':'var(--muted)',cursor:'pointer',fontFamily:'var(--fm)',fontSize:11,letterSpacing:.5,transition:'all 0.15s',textTransform:'uppercase'}}>
                  {t==='vendors'?`Vendors (${result.vendors?.length})`:t==='categories'?`Categories (${result.categories?.length})`:'Capability Matrix'}
                </button>
              ))}
            </div>

            {/* ── VENDORS TAB ── */}
            {reviewTab==='vendors' && (
              <>
                <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
                  <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search vendors..." style={{padding:'7px 12px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontFamily:'var(--fs)',fontSize:13,outline:'none',width:200}}/>
                  <div style={{display:'flex',gap:6}}>
                    {['all','Legacy','AI-Native','Analyst'].map(t=>(
                      <button key={t} onClick={()=>setFilterType(t)} style={{padding:'5px 12px',borderRadius:5,border:`1px solid ${filterType===t?'rgba(255,255,255,0.2)':'var(--border)'}`,background:filterType===t?'rgba(255,255,255,0.06)':'transparent',color:filterType===t?'var(--text)':'var(--muted)',cursor:'pointer',fontFamily:'var(--fm)',fontSize:10}}>
                        {t==='all'?'All Types':t}
                      </button>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    <button onClick={()=>setFilterCat(null)} style={{padding:'4px 10px',borderRadius:4,border:`1px solid ${filterCat===null?'rgba(255,255,255,0.2)':'var(--border)'}`,background:filterCat===null?'rgba(255,255,255,0.06)':'transparent',color:filterCat===null?'var(--text)':'var(--muted)',cursor:'pointer',fontFamily:'var(--fm)',fontSize:9}}>All Cats</button>
                    {result.categories?.map(c=>(
                      <button key={c.id} onClick={()=>setFilterCat(filterCat===c.id?null:c.id)} style={{padding:'4px 10px',borderRadius:4,border:`1px solid ${filterCat===c.id?c.color+'60':'var(--border)'}`,background:filterCat===c.id?c.dim:'transparent',color:filterCat===c.id?c.color:'var(--muted)',cursor:'pointer',fontFamily:'var(--fm)',fontSize:9}}>{c.phase}</button>
                    ))}
                  </div>
                </div>
                <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--muted)',marginBottom:10}}>{filteredVendors.length} of {result.vendors?.length} vendors — click any field to edit</div>
                <div style={{overflowX:'auto',borderRadius:10,border:'1px solid var(--border)'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',minWidth:'max-content'}}>
                    <thead>
                      <tr>
                        {['#','Vendor Name','Type','Category','HQ','Founded','Funding $M','ARR $M','Agentic','Description'].map(h=>(
                          <th key={h} style={{padding:'9px 12px',background:'var(--s2)',fontFamily:'var(--fm)',fontSize:8,letterSpacing:2,textTransform:'uppercase',color:'var(--muted)',textAlign:'left',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVendors.map((v,i)=>{
                        const cat = result.categories?.find(c=>c.id===v.cat)||{};
                        const tc = v.type==='AI-Native'?'#FCD34D':v.type==='Analyst'?'#C4B5FD':'#93C5FD';
                        const tb = v.type==='AI-Native'?'rgba(245,158,11,0.1)':v.type==='Analyst'?'rgba(139,92,246,0.1)':'rgba(59,130,246,0.1)';
                        return (
                          <tr key={v.id} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                            <td style={{padding:'8px 12px',fontFamily:'var(--fm)',fontSize:10,color:'var(--muted)'}}>{i+1}</td>
                            <td style={{padding:'8px 12px',fontWeight:700,fontSize:13,minWidth:130}}>
                              <EditableText value={v.name} onChange={val=>updateVendor(v.id,'name',val)}/>
                            </td>
                            <td style={{padding:'8px 12px'}}>
                              <select defaultValue={v.type} onChange={e=>updateVendor(v.id,'type',e.target.value)} style={{background:tb,color:tc,border:`1px solid ${tc}30`,borderRadius:3,fontFamily:'var(--fm)',fontSize:9,fontWeight:700,padding:'2px 6px',cursor:'pointer'}}>
                                <option>Legacy</option><option>AI-Native</option><option>Analyst</option>
                              </select>
                            </td>
                            <td style={{padding:'8px 12px'}}>
                              <select defaultValue={v.cat} onChange={e=>updateVendor(v.id,'cat',Number(e.target.value))} style={{background:cat.dim||'transparent',color:cat.color||'var(--muted)',border:`1px solid ${cat.color||'var(--border)'}30`,borderRadius:3,fontFamily:'var(--fm)',fontSize:9,padding:'2px 6px',cursor:'pointer'}}>
                                {result.categories?.map(c=><option key={c.id} value={c.id}>{c.phase} — {c.short||c.name}</option>)}
                              </select>
                            </td>
                            <td style={{padding:'8px 12px',fontSize:12,color:'var(--m2)',minWidth:120}}>
                              <EditableText value={v.hq||''} onChange={val=>updateVendor(v.id,'hq',val)} style={{color:'var(--m2)'}}/>
                            </td>
                            <td style={{padding:'8px 12px',fontFamily:'var(--fm)',fontSize:12}}>
                              <EditableNumber value={v.founded} onChange={val=>updateVendor(v.id,'founded',val)} style={{width:55}}/>
                            </td>
                            <td style={{padding:'8px 12px',fontFamily:'var(--fm)',fontSize:12,color:'#FCD34D'}}>
                              <EditableNumber value={v.funding} onChange={val=>updateVendor(v.id,'funding',val)}/>
                            </td>
                            <td style={{padding:'8px 12px',fontFamily:'var(--fm)',fontSize:12,color:'#6EE7B7'}}>
                              <EditableNumber value={v.arr} onChange={val=>updateVendor(v.id,'arr',val)}/>
                            </td>
                            <td style={{padding:'8px 12px',textAlign:'center'}}>
                              <input type="checkbox" checked={!!v.agentic} onChange={e=>updateVendor(v.id,'agentic',e.target.checked)} style={{accentColor:'#10B981',cursor:'pointer'}}/>
                            </td>
                            <td style={{padding:'8px 12px',fontSize:12,color:'var(--m2)',minWidth:260}}>
                              <EditableText value={v.desc||''} onChange={val=>updateVendor(v.id,'desc',val)} multiline style={{fontSize:12,color:'var(--m2)'}}/>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── CATEGORIES TAB ── */}
            {reviewTab==='categories' && (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:14}}>
                {result.categories?.map(c=>(
                  <div key={c.id} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                    <div style={{height:3,background:c.color}}/>
                    <div style={{padding:'18px 20px'}}>
                      <div style={{fontFamily:'var(--fm)',fontSize:8,color:c.color,letterSpacing:4,marginBottom:6}}>{c.phase}</div>
                      <div style={{fontFamily:'var(--fd)',fontSize:17,marginBottom:6}}>{c.name}</div>
                      <div style={{display:'flex',gap:12,marginBottom:10}}>
                        <span style={{fontFamily:'var(--fm)',fontSize:14,fontWeight:700,color:c.color}}>{c.market}</span>
                        <span style={{fontFamily:'var(--fm)',fontSize:11,color:c.color}}>+{c.cagr} CAGR</span>
                      </div>
                      <div style={{fontSize:12,color:'var(--m2)',lineHeight:1.6,marginBottom:10}}>{c.desc}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                        {(c.capabilities_preview||[]).map((p,pi)=>(
                          <span key={pi} style={{fontSize:10,color:'rgba(255,255,255,0.4)',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',padding:'2px 8px',borderRadius:3}}>{p}</span>
                        ))}
                      </div>
                      <div style={{marginTop:10,fontFamily:'var(--fm)',fontSize:9,color:'var(--muted)'}}>{result.vendors?.filter(v=>v.cat===c.id).length} vendors · {c.gartner}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── MATRIX TAB ── */}
            {reviewTab==='matrix' && (
              <>
                <div style={{fontSize:11,color:'var(--muted)',marginBottom:14,fontFamily:'var(--fm)'}}>Click any score to edit. Showing first 22 vendors. — = not applicable (0)</div>
                <div style={{overflowX:'auto',borderRadius:10,border:'1px solid var(--border)'}}>
                  <table style={{borderCollapse:'collapse',minWidth:'max-content'}}>
                    <thead>
                      <tr>
                        <th style={{padding:'9px 14px',background:'var(--s2)',fontFamily:'var(--fm)',fontSize:8,color:'var(--muted)',textAlign:'left',borderBottom:'1px solid var(--border)',minWidth:200,position:'sticky',left:0,zIndex:2}}>CAPABILITY</th>
                        {result.vendors?.slice(0,22).map(v=>(
                          <th key={v.id} style={{width:42,padding:'8px 2px',background:'var(--s2)',borderBottom:'1px solid var(--border)'}}>
                            <div style={{writingMode:'vertical-rl',transform:'rotate(180deg)',fontFamily:'var(--fm)',fontSize:8,color:v.type==='AI-Native'?'#FCD34D':'#93C5FD',whiteSpace:'nowrap',padding:'0 2px'}}>{v.name}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.capabilities?.map((cap,ci)=>{
                        const cat = result.categories?.find(c=>c.id===cap.cat)||{};
                        const prevCat = ci>0?result.capabilities[ci-1]?.cat:null;
                        return (
                          <>
                            {cap.cat!==prevCat && (
                              <tr key={`cat-${cap.cat}`}>
                                <td colSpan={(result.vendors?.slice(0,22).length||0)+1} style={{padding:'7px 14px',background:cat.dim||'rgba(59,130,246,0.05)'}}>
                                  <span style={{fontFamily:'var(--fm)',fontSize:9,color:cat.color,letterSpacing:2,textTransform:'uppercase'}}>{cat.phase} — {cat.name}</span>
                                </td>
                              </tr>
                            )}
                            <tr key={ci} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                              <td style={{padding:'6px 14px',fontFamily:'var(--fs)',fontSize:11,color:'rgba(255,255,255,0.55)',position:'sticky',left:0,background:'#0D1424',zIndex:1,whiteSpace:'nowrap'}}>{cap.name}</td>
                              {result.vendors?.slice(0,22).map(v=>{
                                const s=(cap.scores||{})[v.name]||0;
                                return (
                                  <td key={v.id} style={{padding:'3px',textAlign:'center'}}>
                                    <div style={{width:36,height:22,borderRadius:3,background:SCORE_BG(s),display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto',cursor:'text'}} onClick={e=>{
                                      const val = prompt(`Score for ${v.name} on "${cap.name}" (0-100):`, s);
                                      if(val!==null) updateCapScore(ci, v.name, Math.max(0,Math.min(100,parseInt(val)||0)));
                                    }}>
                                      <span style={{fontFamily:'var(--fm)',fontSize:8,color:s>0?'#fff':'rgba(255,255,255,0.2)'}}>{s||'—'}</span>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function clamp(min, max) { return `clamp(${min}px, 4.5vw, ${max}px)`; }
