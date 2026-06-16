import { useState, useRef } from "react";

const HOURLY_RATE = 30;

// ── helpers ──────────────────────────────────────────────────────────────
function toHMS(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function toDecimal(s) { return (s / 3600).toFixed(2); }
function toMoney(a)   { return `$${a.toFixed(2)}`; }
function is3D(d) { if (!d) return false; const t = d.trim(); return /3d\*/i.test(t) || /\*3d/i.test(t); }

// ── CSV parsing ──────────────────────────────────────────────────────────
function parseDuration(raw) {
  if (!raw) return 0;
  const s = raw.trim().replace(/"/g, "");
  if (s.includes(":")) {
    const p = s.split(":").map(Number);
    if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
    if (p.length === 2) return p[0]*3600 + p[1]*60;
  }
  const hm = s.match(/(\d+)h\s*(\d*)m?/);
  if (hm) return parseInt(hm[1])*3600 + parseInt(hm[2]||0)*60;
  const n = parseFloat(s);
  if (!isNaN(n) && n > 0) return n > 200 ? n : Math.round(n * 3600);
  return 0;
}

function parseCSVRow(line) {
  const res = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { res.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  res.push(cur.trim());
  return res;
}

// Parse one Toggl CSV export → { projects, total3D, totalReg, totalSecs, count }
function parseTogglCSV(text) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) throw new Error("CSV appears empty.");

  const header = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,"").toLowerCase());
  const find = (...names) => header.findIndex(h => names.some(n => h === n || h.includes(n)));

  const idx = {
    description: find("description","task description","activity"),
    project:     find("project","project name","client"),
    duration:    find("duration"),
  };

  if (idx.duration === -1)
    throw new Error(`No Duration column found.\nColumns detected: ${header.join(", ")}\n\nExport from Toggl → Reports → Summary → Export CSV.`);

  const projects = {}; // name → { secs3D, secsReg }
  let count = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 2) continue;

    // Skip "Total" summary rows Toggl sometimes appends
    const firstCell = (row[0] || "").toLowerCase();
    if (firstCell === "total" || firstCell === "") continue;

    const desc    = idx.description >= 0 ? (row[idx.description] || "").trim() : "";
    const project = idx.project >= 0 ? (row[idx.project] || "").trim() || "No Project" : "No Project";
    const seconds = parseDuration(row[idx.duration] || "");
    if (seconds <= 0) continue;

    if (!projects[project]) projects[project] = { secs3D: 0, secsReg: 0 };
    if (is3D(desc)) projects[project].secs3D += seconds;
    else            projects[project].secsReg += seconds;
    count++;
  }

  if (!count) throw new Error("No valid entries found. Make sure the Duration column has values like 1:23:45.");

  let total3D = 0, totalReg = 0;
  Object.values(projects).forEach(p => { total3D += p.secs3D; totalReg += p.secsReg; });

  return { projects, total3D, totalReg, totalSecs: total3D + totalReg, count };
}

// ── billing calc for one week ─────────────────────────────────────────────
function weekBill(w) {
  if (!w) return 0;
  return parseFloat(toDecimal(w.totalSecs)) * HOURLY_RATE;
}

// ── copy text ─────────────────────────────────────────────────────────────
function buildCopyText(weeks) {
  const L = [];
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  L.push("INVOICE SUMMARY");
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  L.push("INVOICE LINE ITEMS");
  weeks.forEach((w, i) => {
    if (!w) return;
    const bill     = weekBill(w);
    const totalHrs = parseFloat(toDecimal(w.totalSecs));
    L.push(`  Freelance Motion Design Support`);
    L.push(`  Week ${i+1}${w.label ? ` · ${w.label}` : ""}`);
    L.push(`  ${totalHrs.toFixed(2)} hours at ${toMoney(HOURLY_RATE)}/hr  →  ${toMoney(bill)}`);
    L.push("");
  });

  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  weeks.forEach((w, i) => {
    if (!w) return;
    L.push(`WEEK ${i+1}${w.label ? ` · ${w.label}` : ""}`);
    L.push(`${"Projects".padEnd(38)}Hours`);
    L.push("─".repeat(50));
    Object.entries(w.projects)
      .sort((a,b)=>(b[1].secs3D+b[1].secsReg)-(a[1].secs3D+a[1].secsReg))
      .forEach(([proj, t]) => {
        L.push(`${proj.padEnd(38)}${toHMS(t.secs3D+t.secsReg)}`);
      });
    L.push("─".repeat(50));
    L.push(`${"Total".padEnd(38)}${toHMS(w.totalSecs)}`);
    L.push("");
  });

  const totalSecs = weeks.reduce((s,w) => s+(w?.totalSecs ||0), 0);
  const bill = parseFloat(toDecimal(totalSecs)) * HOURLY_RATE;
  L.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  L.push("PERIOD TOTALS");
  L.push(`  Billable Hours: ${toDecimal(totalSecs)} hrs  (${toHMS(totalSecs)})`);
  L.push(`  Rate:           ${toMoney(HOURLY_RATE)}/hr`);
  L.push(`\n  ► AMOUNT DUE: ${toMoney(bill)}`);
  return L.join("\n");
}

// ── WeekUpload block ──────────────────────────────────────────────────────
function WeekUpload({ weekNum, data, onLoad, onClear }) {
  const ref = useRef();
  const [err, setErr] = useState("");

  function handleFile(e) {
    const file = e.target.files[0]; if (!file) return;
    setErr("");
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const result = parseTogglCSV(ev.target.result);
        // Try to extract two dates from filename, e.g. "01 03 2026" and "07 03 2026"
        // Matches patterns like: 01_03_2026, 01-03-2026, 2026-03-01, 01 03 2026
        const raw = file.name.replace(/\.csv$/i, "");
        const dates = [];
        // Try ISO format first: 2026-03-01
        const isoMatches = [...raw.matchAll(/(\d{4})[-_](\d{2})[-_](\d{2})/g)];
        if (isoMatches.length >= 2) {
          isoMatches.forEach(m => dates.push(new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)));
        } else {
          // Try DD MM YYYY or DD-MM-YYYY or DD_MM_YYYY
          const dmyMatches = [...raw.matchAll(/(\d{1,2})[\s_\-](\d{1,2})[\s_\-](\d{4})/g)];
          dmyMatches.forEach(m => dates.push(new Date(`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}T12:00:00`)));
        }
        let label;
        if (dates.length >= 2) {
          const fmt = d => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
          // If same year, add year only once at the end
          const yr = dates[0].getFullYear();
          label = `${fmt(dates[0])} – ${fmt(dates[1])}, ${yr}`;
        } else {
          // Fallback: just clean up the filename
          label = raw.replace(/[_\-]/g, " ").replace(/\s+/g, " ").trim();
        }
        onLoad({ ...result, label });
      } catch(ex) { setErr(ex.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="week-upload">
      <div className="wu-header">
        <div>
          <span className="wu-title">Week {weekNum}</span>
          {data?.label && <div className="wu-daterange">{data.label}</div>}
        </div>
        {data && <button className="wu-clear" onClick={onClear}>✕ Clear</button>}
      </div>

      {!data ? (
        <div className="drop" onClick={()=>ref.current.click()}>
          <input type="file" accept=".csv,text/csv" ref={ref} onChange={handleFile}/>
          <div className="dlab">Click to upload Week {weekNum} CSV</div>
        </div>
      ) : (
        <div className="wu-loaded" onClick={()=>ref.current.click()}>
          <input type="file" accept=".csv,text/csv" ref={ref} onChange={handleFile}/>
          <div className="wu-ok">✓ {data.count} entries · {toHMS(data.totalSecs)} total</div>
          <div className="wu-projs">
            {Object.entries(data.projects)
              .sort((a,b)=>(b[1].secs3D+b[1].secsReg)-(a[1].secs3D+a[1].secsReg))
              .map(([proj, t]) => (
                <div className="wu-proj" key={proj}>
                  <span>{proj}</span>
                  <span>{toHMS(t.secs3D + t.secsReg)}</span>
                </div>
              ))}
            <div className="wu-proj wu-total"><span>Total</span><span>{toHMS(data.totalSecs)}</span></div>
          </div>
          <div className="wu-replace">Click to replace CSV</div>
        </div>
      )}
      {err && <div className="wu-err">⚠ {err}</div>}
    </div>
  );
}

// ── main app ──────────────────────────────────────────────────────────────
export default function App() {
  const [week1, setWeek1] = useState(null);
  const [week2, setWeek2] = useState(null);
  const [copied, setCopied] = useState(false);

  // Totals
  const totalSecs = (week1?.totalSecs || 0) + (week2?.totalSecs || 0);
  const totalBill = parseFloat(toDecimal(totalSecs)) * HOURLY_RATE;
  const hasAny = week1 || week2;

  function handleCopy() {
    navigator.clipboard.writeText(buildCopyText([week1, week2]));
    setCopied(true); setTimeout(()=>setCopied(false), 2500);
  }

  function clearAll() { setWeek1(null); setWeek2(null); }

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0e0e0e}
    .title{font-family:'Bebas Neue',sans-serif;font-size:clamp(38px,7vw,70px);letter-spacing:4px;color:#f0ede6;line-height:1;text-align:center}
    .sub{font-size:10px;letter-spacing:6px;text-transform:uppercase;color:#c8f04a;margin:8px 0 32px;text-align:center}
    .card{background:#171717;border:1px solid #2a2a2a;border-radius:4px;padding:24px 26px;width:100%;max-width:600px;margin-bottom:16px}
    .lbl{font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#666;margin-bottom:7px;display:block}

    /* week upload blocks */
    .week-upload{background:#111;border:1px solid #222;border-radius:3px;padding:16px;margin-bottom:12px}
    .wu-header{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .wu-title{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:3px;color:#c8f04a}
    .wu-daterange{font-size:11px;color:#666;letter-spacing:1px;margin-top:2px}
    .wu-range{font-size:11px;color:#666;letter-spacing:1px;flex:1}
    .wu-clear{background:transparent;border:1px solid #333;color:#666;font-size:11px;padding:3px 8px;border-radius:2px;cursor:pointer;letter-spacing:1px}
    .wu-clear:hover{border-color:#c8f04a;color:#c8f04a}
    .drop{border:1px dashed #2a2a2a;border-radius:3px;padding:18px;text-align:center;cursor:pointer;transition:border-color .2s;background:#0e0e0e}
    .drop:hover{border-color:#c8f04a}
    .drop input{display:none}
    .dlab{font-size:12px;color:#555;letter-spacing:1px}
    .wu-loaded{cursor:pointer;position:relative}
    .wu-loaded input{display:none}
    .wu-ok{font-size:11px;color:#5a7a3a;letter-spacing:1px;margin-bottom:10px}
    .wu-projs{background:#0e0e0e;border:1px solid #1e1e1e;border-radius:3px;overflow:hidden}
    .wu-proj{display:flex;justify-content:space-between;padding:6px 12px;font-size:12px;color:#999;border-bottom:1px solid #161616}
    .wu-proj:last-child{border-bottom:none}
    .wu-proj span:last-child{font-family:'Courier New',monospace;color:#ccc}
    .wu-total{border-top:1px solid #252525 !important;color:#777 !important;font-size:11px}
    .wu-total span:last-child{color:#c8f04a !important;font-size:13px}
    .wu-replace{font-size:10px;color:#444;text-align:center;margin-top:8px;letter-spacing:1px}
    .wu-err{background:#1e0a0a;border:1px solid #5c1a1a;color:#ff7070;padding:10px 12px;border-radius:3px;font-size:11px;margin-top:8px;white-space:pre-wrap;line-height:1.6}
    .tag3d{font-size:9px;color:#c8f04a;opacity:.8;margin-left:4px}

    /* results */
    .sect{font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:5px;color:#c8f04a;margin:20px 0 10px;padding-bottom:5px;border-bottom:1px solid #222}

    /* invoice preview */
    .inv-line{background:#0e0e0e;border:1px solid #1e1e1e;border-radius:3px;padding:14px 16px;margin-bottom:10px}
    .inv-service{font-size:13px;color:#ddd;font-weight:normal;margin-bottom:4px}
    .inv-meta{font-size:11px;color:#666;letter-spacing:.5px;margin-bottom:2px}
    .inv-amount{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#c8f04a;letter-spacing:2px;margin-top:6px}

    /* totals */
    .totrow{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e1e1e}
    .totrow:last-child{border-bottom:none}
    .totlbl{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#666}
    .totrr{display:flex;gap:10px;align-items:baseline}
    .totv{color:#f0ede6;font-size:14px}
    .tothms{color:#444;font-size:11px;font-family:'Courier New',monospace}
    .totm{color:#c8f04a;font-size:12px}
    .due{background:#0a150a;border:1px solid #1e3a0e;border-radius:4px;padding:16px 20px;text-align:center;margin-top:16px}
    .dul{font-size:9px;letter-spacing:5px;text-transform:uppercase;color:#4a7a2a;margin-bottom:4px}
    .dua{font-family:'Bebas Neue',sans-serif;font-size:50px;color:#c8f04a;letter-spacing:3px;line-height:1}
    .cpbtn{width:100%;padding:12px;background:transparent;color:#c8f04a;border:1px solid #c8f04a;border-radius:3px;font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:3px;cursor:pointer;margin-top:16px;transition:background .15s}
    .cpbtn:hover{background:rgba(200,240,74,.07)}
    .hint{font-size:11px;color:#555;letter-spacing:1px;text-align:center;margin-top:8px}

    .steps{background:#0e0e0e;border:1px solid #1e1e1e;border-radius:3px;padding:12px 14px;margin-top:12px}
    .step{display:flex;gap:10px;align-items:flex-start;padding:3px 0;font-size:11px;color:#666;line-height:1.5}
    .sn{color:#c8f04a;font-family:'Bebas Neue',sans-serif;font-size:14px;min-width:16px}
  `;

  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",color:"#f0ede6",fontFamily:"'Courier New',monospace",padding:"36px 16px",display:"flex",flexDirection:"column",alignItems:"center"}}>
      <style>{css}</style>

      <p className="title">INVOICE<br/>CALCULATOR</p>
      <p className="sub">Toggl Hour Summarizer</p>

      {/* ── Week uploads ── */}
      <div className="card">
        <WeekUpload
          weekNum={1}
          data={week1}
          onLoad={setWeek1}
          onClear={()=>setWeek1(null)}
        />
        <WeekUpload
          weekNum={2}
          data={week2}
          onLoad={setWeek2}
          onClear={()=>setWeek2(null)}
        />
      </div>

      {/* ── Results ── */}
      {hasAny && (
        <div className="card">

          {/* Invoice preview */}
          <div className="sect">Invoice Line Items</div>
          {[week1, week2].map((w, i) => {
            if (!w) return null;
            const bill     = weekBill(w);
            const totalHrs = parseFloat(toDecimal(w.totalSecs));
            return (
              <div className="inv-line" key={i}>
                <div className="inv-service">Freelance Motion Design Support</div>
                <div className="inv-meta">Week {i+1}{w.label ? ` · ${w.label}` : ""}</div>
                <div className="inv-meta">{totalHrs.toFixed(2)} hours at {toMoney(HOURLY_RATE)}/hr</div>
                <div className="inv-amount">{toMoney(bill)}</div>
              </div>
            );
          })}

          {/* Period totals */}
          <div className="sect">Period Totals</div>
          <div className="totrow">
            <span className="totlbl">Billable Hours</span>
            <span className="totrr">
              <span className="tothms">{toHMS(totalSecs)}</span>
              <span className="totv">{toDecimal(totalSecs)} hrs</span>
            </span>
          </div>
          <div className="totrow">
            <span className="totlbl">Rate</span>
            <span className="totrr">
              <span className="totm">{toMoney(HOURLY_RATE)}/hr</span>
            </span>
          </div>

          <div className="due">
            <div className="dul">Amount Due</div>
            <div className="dua">{toMoney(totalBill)}</div>
          </div>

          <button className="cpbtn" onClick={handleCopy}>
            {copied ? "✓ Copied!" : "Copy Invoice + Spreadsheet Summary"}
          </button>
          <p className="hint">${HOURLY_RATE}/hr</p>
        </div>
      )}
    </div>
  );
}
