/**
 * outputTemplate.js
 * Generates a self-contained single-file HTML landscape site.
 * 
 * This file is the "Format 2" output — the interactive Vercel prototype.
 * It embeds all data inline and uses CDN React — zero build step.
 * 
 * Web team can:
 * - Open it directly in a browser (works offline)
 * - Edit the window.__DATA__ JSON block in any text editor
 * - Deploy it anywhere that serves static files
 * - Use it as a reference implementation for their CMS integration
 */

export function generateHTML(data, domain) {
  const { categories, vendors, capabilities, refreshMeta } = data;
  const generatedAt = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const totalMarket = categories.reduce((s, c) => s + parseFloat((c.market || "$0").replace(/[$B]/g, "")) || 0, 0);
  const aiCount = vendors.filter(v => v.type === "AI-Native").length;
  const agenticCount = vendors.filter(v => v.agentic).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${domain} — Technology Landscape</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#080C14;--s1:#0E1422;--s2:#141C2E;--s3:#1A2338;--border:rgba(255,255,255,0.07);--text:#E8EEFF;--muted:#6B7A99;--blue:#3B82F6;--green:#10B981;--amber:#F59E0B;--fd:'DM Serif Display',serif;--fs:'Syne',sans-serif;--fm:'JetBrains Mono',monospace}
body{background:var(--bg);color:var(--text);font-family:var(--fs)}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1A2338}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.g{display:grid}.f{display:flex}.fac{align-items:center}
</style>
</head>
<body>
<div id="root"></div>

<!-- ═══ LANDSCAPE DATA ════════════════════════════════════════════════════════
     Web team: edit the JSON below to customise vendor data, scores, and content.
     Structure: { categories, vendors, capabilities }
     Full schema reference: https://landscape-generator.app/schema/v1
═══════════════════════════════════════════════════════════════════════════ -->
<script>
window.__DATA__ = ${JSON.stringify(data, null, 2)};
window.__META__ = {
  domain: ${JSON.stringify(domain)},
  generatedAt: ${JSON.stringify(generatedAt)},
  totalVendors: ${vendors.length},
  totalMarket: "${totalMarket.toFixed(1)}B",
  aiNative: ${aiCount},
  agentic: ${agenticCount}
};
</script>

<script>
// ─── APP ─────────────────────────────────────────────────────────────────────
const { useState, useEffect, useRef, useMemo } = React;
const { categories, vendors, capabilities } = window.__DATA__;
const meta = window.__META__;

const SCORE_BG = s => !s ? "rgba(255,255,255,0.04)" : s>=90?"#14532D":s>=75?"#166534":s>=60?"#15803D":s>=45?"#854D0E":"#7C2D12";
const TYPE_COLOR = t => t==="AI-Native"?"#FCD34D":t==="Analyst"?"#C4B5FD":"#93C5FD";
const TYPE_BG = t => t==="AI-Native"?"rgba(245,158,11,0.1)":t==="Analyst"?"rgba(139,92,246,0.1)":"rgba(59,130,246,0.1)";

function App() {
  const [section, setSection] = useState("overview");
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorType, setVendorType] = useState("all");
  const [matrixCat, setMatrixCat] = useState(null);

  const filteredVendors = useMemo(() => vendors.filter(v => {
    if (selectedCat && v.cat !== selectedCat.id) return false;
    if (vendorType !== "all" && v.type !== vendorType) return false;
    if (vendorSearch && !v.name.toLowerCase().includes(vendorSearch.toLowerCase()) && !(v.desc||"").toLowerCase().includes(vendorSearch.toLowerCase())) return false;
    return true;
  }), [selectedCat, vendorType, vendorSearch]);

  const matrixVendors = useMemo(() => matrixCat ? vendors.filter(v => v.cat === matrixCat.id) : vendors.slice(0, 25), [matrixCat]);
  const matrixCaps = useMemo(() => matrixCat ? capabilities.filter(c => c.cat === matrixCat.id) : capabilities, [matrixCat]);

  return React.createElement("div", { style: { minHeight: "100vh" } },
    // NAV
    React.createElement("nav", { style: { position:"fixed",top:0,inset:"0 0 auto",height:56,background:"rgba(8,12,20,0.96)",backdropFilter:"blur(20px)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 32px",zIndex:200 } },
      React.createElement("div", { style: { display:"flex",alignItems:"center",gap:12 } },
        React.createElement("div", { style: { width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#3B82F6,#6D28D9)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--fm)",fontSize:12,fontWeight:700 } }, "TL"),
        React.createElement("span", { style: { fontFamily:"var(--fd)",fontSize:17 } }, meta.domain),
        React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"rgba(255,255,255,0.25)",marginLeft:4 } }, meta.generatedAt)
      ),
      React.createElement("div", { style: { display:"flex",gap:4 } },
        ["overview","categories","vendors","matrix"].map(s =>
          React.createElement("button", { key:s, onClick:()=>{setSection(s);if(s!=="vendors")setSelectedCat(null);}, style: { padding:"7px 16px",background:section===s?"rgba(59,130,246,0.15)":"transparent",border:`1px solid ${section===s?"rgba(59,130,246,0.3)":"transparent"}`,borderRadius:6,cursor:"pointer",fontFamily:"var(--fm)",fontSize:10,color:section===s?"#93C5FD":"var(--muted)",textTransform:"capitalize" } }, s)
        )
      )
    ),

    React.createElement("div", { style: { paddingTop:56 } },

      // ── OVERVIEW ──────────────────────────────────────────────────────────
      section === "overview" && React.createElement("div", { style: { maxWidth:1200,margin:"0 auto",padding:"60px 32px" } },
        React.createElement("div", { style: { animation:"fadeUp 0.6s ease",marginBottom:64 } },
          React.createElement("div", { style: { display:"flex",alignItems:"center",gap:8,marginBottom:18 } },
            React.createElement("div", { style: { width:32,height:1,background:"var(--blue)" } }),
            React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"var(--blue)",letterSpacing:"0.25em",textTransform:"uppercase" } }, "CIO Intelligence Series")
          ),
          React.createElement("h1", { style: { fontFamily:"var(--fd)",fontSize:60,lineHeight:1.05,marginBottom:12 } },
            domain, React.createElement("br"),
            React.createElement("em", { style: { color:"#93C5FD" } }, "Technology Landscape")
          ),
          React.createElement("p", { style: { color:"var(--muted)",fontSize:16,lineHeight:1.7,maxWidth:520,marginBottom:40 } },
            "A comprehensive vendor analysis across ", categories.length, " value-chain categories, profiling ", meta.totalVendors, " vendors with capability scoring across ", capabilities.length, " dimensions."
          ),
          React.createElement("div", { style: { display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16,marginBottom:56 } },
            [
              [meta.totalVendors,"Total Vendors","var(--blue)"],
              ["$"+meta.totalMarket,"Market TAM","#DC2626"],
              [categories.length,"Categories","#8B5CF6"],
              [capabilities.length,"Capabilities","#0891B2"],
              [meta.aiNative,"AI-Native","var(--amber)"],
              [meta.agentic,"Agentic AI","var(--green)"],
            ].map(([v,l,c]) =>
              React.createElement("div", { key:l, style: { padding:"20px 22px",background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,borderTop:"2px solid "+c } },
                React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:26,fontWeight:700,color:c,marginBottom:4 } }, v),
                React.createElement("div", { style: { fontSize:12,color:"var(--muted)" } }, l)
              )
            )
          ),
          // Value chain strip
          React.createElement("div", { style: { overflowX:"auto",paddingBottom:8 } },
            React.createElement("div", { style: { display:"flex",gap:3,minWidth:"max-content" } },
              categories.map((c,i) =>
                React.createElement("div", { key:c.id, onClick:()=>{setSelectedCat(c);setSection("vendors");}, style: { flex:1,minWidth:120,padding:"14px 16px",background:"var(--s1)",border:"1px solid var(--border)",borderTop:"2px solid "+c.color,borderRadius:8,cursor:"pointer",transition:"all 0.15s" } },
                  React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:8,color:c.color,letterSpacing:"0.2em",marginBottom:6 } }, c.phase),
                  React.createElement("div", { style: { fontFamily:"var(--fd)",fontSize:14,lineHeight:1.3,marginBottom:6 } }, c.name),
                  React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:11,color:c.color,fontWeight:700 } }, c.market)
                )
              )
            )
          )
        )
      ),

      // ── CATEGORIES ────────────────────────────────────────────────────────
      section === "categories" && React.createElement("div", { style: { maxWidth:1200,margin:"0 auto",padding:"50px 32px" } },
        React.createElement("h2", { style: { fontFamily:"var(--fd)",fontSize:36,marginBottom:24 } }, "Value Chain Categories"),
        React.createElement("div", { style: { display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:18 } },
          categories.map(c =>
            React.createElement("div", { key:c.id, style: { background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",cursor:"pointer" },
              onClick:()=>{setSelectedCat(c);setSection("vendors");} },
              React.createElement("div", { style: { height:3,background:c.color } }),
              React.createElement("div", { style: { padding:"20px 22px" } },
                React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:9,color:c.color,letterSpacing:"0.2em",marginBottom:8 } }, c.phase),
                React.createElement("div", { style: { fontFamily:"var(--fd)",fontSize:19,marginBottom:8 } }, c.name),
                React.createElement("div", { style: { display:"flex",gap:14,marginBottom:10 } },
                  React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:14,fontWeight:700,color:c.color } }, c.market),
                  React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:12,color:c.color } }, "+",c.cagr," CAGR")
                ),
                React.createElement("div", { style: { fontSize:13,color:"var(--muted)",lineHeight:1.6,marginBottom:14 } }, c.desc),
                React.createElement("div", { style: { display:"flex",flexWrap:"wrap",gap:6 } },
                  (c.capabilities_preview||[]).map(p =>
                    React.createElement("span", { key:p, style: { fontSize:11,color:"rgba(255,255,255,0.4)",background:"rgba(255,255,255,0.04)",padding:"3px 9px",borderRadius:4,border:"1px solid rgba(255,255,255,0.07)" } }, p)
                  )
                )
              )
            )
          )
        )
      ),

      // ── VENDORS ───────────────────────────────────────────────────────────
      section === "vendors" && React.createElement("div", { style: { maxWidth:1280,margin:"0 auto",padding:"50px 32px" } },
        React.createElement("div", { style: { display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:14 } },
          React.createElement("h2", { style: { fontFamily:"var(--fd)",fontSize:32 } },
            selectedCat ? selectedCat.name : "All Vendors",
            React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:13,color:"var(--muted)",marginLeft:12,fontFamily:"var(--fs)",fontStyle:"normal" } }, filteredVendors.length, " vendors")
          ),
          React.createElement("div", { style: { display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" } },
            // Search
            React.createElement("input", { value:vendorSearch, onChange:e=>setVendorSearch(e.target.value), placeholder:"Search vendors…", style: { padding:"7px 12px",background:"var(--s1)",border:"1px solid var(--border)",borderRadius:7,color:"var(--text)",fontFamily:"var(--fs)",fontSize:12,outline:"none",width:180 } }),
            // Type filters
            ["all","Legacy","AI-Native","Analyst"].map(t =>
              React.createElement("button", { key:t, onClick:()=>setVendorType(t), style: { padding:"5px 12px",background:vendorType===t?"rgba(255,255,255,0.07)":"transparent",border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",fontFamily:"var(--fm)",fontSize:10,color:vendorType===t?"var(--text)":"var(--muted)" } }, t)
            ),
            // Category filters
            React.createElement("span", { style: { width:1,height:20,background:"var(--border)" } }),
            React.createElement("button", { onClick:()=>setSelectedCat(null), style: { padding:"5px 10px",background:!selectedCat?"rgba(255,255,255,0.07)":"transparent",border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",fontFamily:"var(--fm)",fontSize:9,color:!selectedCat?"var(--text)":"var(--muted)" } }, "All"),
            ...categories.map(c =>
              React.createElement("button", { key:c.id, onClick:()=>setSelectedCat(selectedCat?.id===c.id?null:c), style: { padding:"4px 9px",background:selectedCat?.id===c.id?c.dim:"transparent",border:"1px solid "+(selectedCat?.id===c.id?c.color:"var(--border)"),borderRadius:4,cursor:"pointer",fontFamily:"var(--fm)",fontSize:9,color:selectedCat?.id===c.id?c.color:"var(--muted)" } }, c.phase)
            )
          )
        ),
        React.createElement("div", { style: { display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14 } },
          filteredVendors.map(v => {
            const cat = categories.find(c=>c.id===v.cat);
            const isSelected = selectedVendor?.id === v.id;
            return React.createElement("div", { key:v.id, onClick:()=>setSelectedVendor(isSelected?null:v), style: { background:"var(--s1)",border:"1px solid "+(isSelected?cat?.color||"var(--blue)":"var(--border)"),borderRadius:10,padding:"18px 20px",cursor:"pointer",transition:"border-color 0.15s" } },
              React.createElement("div", { style: { display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontWeight:700,fontSize:15,marginBottom:4 } }, v.name),
                  React.createElement("div", { style: { display:"flex",gap:8,alignItems:"center" } },
                    React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:8,color:TYPE_COLOR(v.type),background:TYPE_BG(v.type),padding:"2px 7px",borderRadius:3,fontWeight:700 } }, v.type),
                    v.agentic && React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:8,color:"var(--green)",background:"rgba(16,185,129,0.1)",padding:"2px 7px",borderRadius:3" } }, "⬡ Agentic")
                  )
                ),
                cat && React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:8,color:cat.color,background:cat.dim,padding:"3px 8px",borderRadius:4 } }, cat.phase)
              ),
              React.createElement("div", { style: { fontSize:12.5,color:"var(--muted)",lineHeight:1.6,marginBottom:10 } }, v.desc),
              React.createElement("div", { style: { display:"flex",gap:12,flexWrap:"wrap" } },
                v.founded && React.createElement("div", null, React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"rgba(255,255,255,0.25)" } }, "Est "), React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:11 } }, v.founded)),
                v.funding && React.createElement("div", null, React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"rgba(255,255,255,0.25)" } }, "Raised "), React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:11 } }, "$",v.funding,"M")),
                v.arr && React.createElement("div", null, React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"rgba(255,255,255,0.25)" } }, "ARR "), React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:11 } }, "$",v.arr,"M")),
                v.ticker && React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"var(--amber)",background:"rgba(245,158,11,0.08)",padding:"2px 8px",borderRadius:3 } }, v.ticker)
              ),
              // Expanded detail
              isSelected && React.createElement("div", { style: { marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)" } },
                v.hq && React.createElement("div", { style: { fontSize:11,color:"var(--muted)",marginBottom:8 } }, "📍 ",v.hq, v.employees ? " · "+v.employees.toLocaleString()+" employees" : ""),
                v.products && React.createElement("div", { style: { marginBottom:10 } },
                  React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:8,color:"var(--muted)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:6 } }, "Products"),
                  React.createElement("div", { style: { fontSize:12,color:"rgba(255,255,255,0.6)" } }, v.products)
                ),
                // Capability scores for this vendor
                React.createElement("div", null,
                  React.createElement("div", { style: { fontFamily:"var(--fm)",fontSize:8,color:"var(--muted)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8 } }, "Capability Scores"),
                  capabilities.filter(cap => (cap.scores||{})[v.name] > 0).slice(0,8).map(cap => {
                    const score = (cap.scores||{})[v.name]||0;
                    const capCat = categories.find(c=>c.id===cap.cat);
                    return React.createElement("div", { key:cap.name, style: { display:"flex",alignItems:"center",gap:8,marginBottom:6 } },
                      React.createElement("div", { style: { flex:1,fontSize:11,color:"rgba(255,255,255,0.5)" } }, cap.name),
                      React.createElement("div", { style: { width:60,height:5,background:"var(--s3)",borderRadius:3,overflow:"hidden" } },
                        React.createElement("div", { style: { width:score+"%",height:"100%",background:capCat?.color||"var(--blue)",borderRadius:3 } })
                      ),
                      React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:10,color:capCat?.color||"var(--text)",width:24,textAlign:"right" } }, score)
                    );
                  })
                )
              )
            );
          })
        )
      ),

      // ── MATRIX ────────────────────────────────────────────────────────────
      section === "matrix" && React.createElement("div", { style: { maxWidth:1400,margin:"0 auto",padding:"50px 32px" } },
        React.createElement("div", { style: { display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12 } },
          React.createElement("h2", { style: { fontFamily:"var(--fd)",fontSize:32 } }, "Capability Matrix"),
          React.createElement("div", { style: { display:"flex",gap:6,flexWrap:"wrap" } },
            React.createElement("button", { onClick:()=>setMatrixCat(null), style: { padding:"5px 10px",background:!matrixCat?"rgba(255,255,255,0.07)":"transparent",border:"1px solid var(--border)",borderRadius:5,cursor:"pointer",fontFamily:"var(--fm)",fontSize:9,color:!matrixCat?"var(--text)":"var(--muted)" } }, "All"),
            ...categories.map(c =>
              React.createElement("button", { key:c.id, onClick:()=>setMatrixCat(matrixCat?.id===c.id?null:c), style: { padding:"4px 10px",background:matrixCat?.id===c.id?c.dim:"transparent",border:"1px solid "+(matrixCat?.id===c.id?c.color:"var(--border)"),borderRadius:4,cursor:"pointer",fontFamily:"var(--fm)",fontSize:9,color:matrixCat?.id===c.id?c.color:"var(--muted)" } }, c.phase)
            )
          )
        ),
        // Legend
        React.createElement("div", { style: { display:"flex",gap:12,marginBottom:16,flexWrap:"wrap" } },
          [["90+","#14532D","Best-in-Class"],["75-89","#166534","Strong"],["60-74","#15803D","Capable"],["45-59","#854D0E","Present"],["<45","#7C2D12","Limited"]].map(([r,bg,lbl]) =>
            React.createElement("div", { key:r, style: { display:"flex",alignItems:"center",gap:6 } },
              React.createElement("div", { style: { width:24,height:14,borderRadius:3,background:bg } }),
              React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:9,color:"var(--muted)" } }, r," ",lbl)
            )
          )
        ),
        React.createElement("div", { style: { overflowX:"auto",borderRadius:10,border:"1px solid var(--border)" } },
          React.createElement("table", { style: { borderCollapse:"collapse",minWidth:"max-content" } },
            React.createElement("thead", null,
              React.createElement("tr", null,
                React.createElement("th", { style: { padding:"10px 16px",background:"var(--s2)",fontFamily:"var(--fm)",fontSize:8,color:"var(--muted)",textAlign:"left",borderBottom:"1px solid var(--border)",position:"sticky",left:0,minWidth:200,whiteSpace:"nowrap" } }, "CAPABILITY"),
                ...matrixVendors.map(v =>
                  React.createElement("th", { key:v.id, style: { width:40,padding:"8px 4px",background:"var(--s2)",borderBottom:"1px solid var(--border)",textAlign:"center" } },
                    React.createElement("div", { style: { writingMode:"vertical-rl",transform:"rotate(180deg)",fontFamily:"var(--fm)",fontSize:8,color:TYPE_COLOR(v.type),whiteSpace:"nowrap",maxHeight:110,overflow:"hidden" } }, v.name)
                  )
                )
              )
            ),
            React.createElement("tbody", null,
              matrixCaps.map((cap,ci) => {
                const cat = categories.find(c=>c.id===cap.cat);
                return React.createElement("tr", { key:ci, style: { background: ci%2===0?"transparent":"rgba(255,255,255,0.015)" } },
                  React.createElement("td", { style: { padding:"6px 14px",position:"sticky",left:0,background:ci%2===0?"#0E1422":"#10162A",borderBottom:"1px solid rgba(255,255,255,0.04)",borderRight:"1px solid var(--border)" } },
                    React.createElement("div", { style: { display:"flex",alignItems:"center",gap:7 } },
                      cat && React.createElement("div", { style: { width:5,height:5,borderRadius:"50%",background:cat.color,flexShrink:0 } }),
                      React.createElement("span", { style: { fontFamily:"var(--fs)",fontSize:11.5,color:"rgba(255,255,255,0.65)",whiteSpace:"nowrap" } }, cap.name)
                    )
                  ),
                  ...matrixVendors.map(v => {
                    const s = (cap.scores||{})[v.name]||0;
                    return React.createElement("td", { key:v.id, style: { padding:"3px 4px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.04)" } },
                      React.createElement("div", { style: { width:32,height:20,borderRadius:3,background:SCORE_BG(s),display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto" } },
                        React.createElement("span", { style: { fontFamily:"var(--fm)",fontSize:8,color:s>0?"#fff":"rgba(255,255,255,0.2)" } }, s||"—")
                      )
                    );
                  })
                );
              })
            )
          )
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
</script>
</body>
</html>`;
}
