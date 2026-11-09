import { FONT_FACES } from './fonts';

// The Cassin look from the hub mockup (sharepoint/cassin-ai-hub/preview), scoped under .cah
// so it can't leak into the rest of the SharePoint page. Injected once per page.
export const CSS = `
.cah { --navy:#021D3C; --primary:#00426C; --primary-dark:#003251; --blue:#0077CE; --sky:#4DD8FF;
  --sand:#EFE7DF; --sand-2:#F2ECE6; --sand-line:#DDD3CA; --soft:#EFF3F6; --soft-line:#C7D5DF;
  --prompt-bg:#F7F9FC; --muted:#3B5068; --faint:#6E7C8C; --line:#E4E1DD;
  --serif:"Cassin Serif","Roboto Serif",Georgia,"Times New Roman",serif; --sans:"Cassin Plex","IBM Plex Sans","Segoe UI",system-ui,sans-serif;
  color:var(--navy); font:16px/1.55 var(--sans); }
.cah *, .cah *::before, .cah *::after { box-sizing:border-box; }
.cah a { color:var(--blue); }
.cah h3, .cah h4 { font-family:var(--serif); font-weight:400; line-height:1.25; color:var(--navy); margin:0 0 8px; }
.cah h3 { font-size:21px; } .cah h4 { font-size:18px; }
.cah p { margin:0 0 10px; }
.cah button { font:inherit; }
.cah .btn { display:inline-flex; align-items:center; gap:6px; background:var(--primary); color:#fff; border:0; padding:6px 13px;
  font-weight:600; font-size:14px; text-decoration:none; cursor:pointer; line-height:1.4; }
.cah .btn:hover { background:var(--primary-dark); color:#fff; }
.cah .btn.ghost { background:#fff; color:var(--primary); border:1px solid var(--soft-line); }
.cah .btn.ghost:hover { background:var(--soft); }
.cah .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.cah .chip { display:inline-block; font-size:12px; padding:2px 9px; border-radius:12px; background:var(--soft); color:var(--primary);
  font-weight:600; margin:0 4px 4px 0; }
.cah .chip.n { background:var(--sand-2); color:var(--muted); }
.cah details.more p { white-space:pre-line; }
.cah a.chip.tipchip { background:var(--sand); color:var(--navy); text-decoration:none; } .cah a.chip.tipchip:hover { text-decoration:underline; }
.cah .pill { display:inline-block; font-size:12px; padding:2px 10px; border-radius:12px; font-weight:600; background:#eee; }
.cah .s-Live, .cah .s-Done { background:#D7F0DD; } .cah .s-Pilot, .cah .s-Reviewing { background:#D6E9F8; }
.cah .s-Upnext, .cah .s-New { background:var(--sand); } .cah .s-Planned { background:#E4DCF5; }
.cah .grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
.cah .card { background:#fff; border:1px solid var(--line); padding:18px 20px; display:flex; flex-direction:column; }
.cah .card .meta { margin-bottom:8px; }
.cah .card .foot { margin-top:auto; padding-top:4px; }
.cah .prompt { border-left:4px solid var(--primary); background:var(--prompt-bg); padding:10px 14px; font-style:italic;
  white-space:pre-wrap; font-size:15px; margin:0 0 12px; overflow-wrap:anywhere; }
.cah .clamp { display:-webkit-box; overflow-wrap:anywhere; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden; }
.cah details.more { font-size:14.5px; color:var(--muted); margin-bottom:12px; }
.cah details.more summary { cursor:pointer; color:var(--primary); font-weight:600; }
.cah details.more p { margin:6px 0 0; }
.cah .toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.cah .toolbar input { flex:1 1 260px; padding:9px 12px; border:1px solid var(--soft-line); font:inherit; color:var(--navy); }
.cah .filter { border:1px solid var(--soft-line); background:#fff; padding:5px 12px; cursor:pointer; font-size:14px; color:var(--primary); }
.cah .filter.on { background:var(--primary); color:#fff; border-color:var(--primary); }
.cah .group { font-family:var(--sans); font-size:13px; letter-spacing:2px; text-transform:uppercase; color:var(--muted);
  font-weight:600; margin:26px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
.cah .group:first-child { margin-top:0; }
.cah .empty { color:var(--muted); padding:22px; text-align:center; border:1px dashed var(--sand-line); background:#fff; }
.cah .eyebrow { font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); font-weight:600; margin-bottom:4px; }
.cah .tip { display:grid; grid-template-columns:92px 1fr; gap:20px; background:#fff; border:1px solid var(--line); padding:20px; margin-bottom:16px; }
.cah .tip .num { background:var(--primary); color:#fff; text-align:center; padding:10px 6px; height:fit-content; }
.cah .tip .num b { display:block; font-family:var(--serif); font-size:34px; font-weight:300; line-height:1.1; }
.cah .tip .num span { font-size:12px; letter-spacing:1px; text-transform:uppercase; }
.cah .tip ol { padding-left:20px; margin:4px 0 12px; }
.cah .tip ol li { margin-bottom:4px; }
.cah .tip h5 { font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); margin:12px 0 4px; font-weight:600; }
.cah .compact { background:#fff; border:1px solid var(--line); padding:16px 18px; }
.cah .compact .prompt { font-size:14px; }
.cah details.faq { border-bottom:1px solid var(--line); padding:12px 0; }
.cah details.faq summary { cursor:pointer; font-weight:600; font-size:17px; list-style:none; display:flex; justify-content:space-between; gap:12px; }
.cah details.faq summary::-webkit-details-marker { display:none; }
.cah details.faq summary::after { content:"+"; color:var(--primary); font-size:22px; line-height:1; }
.cah details.faq[open] summary::after { content:"\\2013"; }
.cah details.faq p { margin:8px 0 4px; color:var(--muted); max-width:820px; white-space:pre-wrap; }
.cah table.list { width:100%; border-collapse:collapse; font-size:15px; background:#fff; }
.cah table.list th { text-align:left; font-weight:600; color:var(--muted); border-bottom:1px solid var(--line); padding:8px; }
.cah table.list td { border-bottom:1px solid var(--line); padding:10px 8px; vertical-align:top; }
.cah .manage { margin-top:14px; font-size:13px; }
.cah .loading { color:var(--faint); padding:18px 0; }
.cah .toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); background:var(--navy); color:#fff; padding:10px 18px;
  z-index:1000; font-size:15px; pointer-events:none; }
.cah .next-list { list-style:none; margin:0; padding:0; display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
.cah .next-item { border:1px solid var(--line); border-left:4px solid var(--soft-line); padding:12px 16px; background:#fff; }
.cah .next-item .next-name { display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:4px; }
.cah .next-item p { margin:0 0 4px; font-size:14.5px; color:var(--muted); }
.cah .next-item .when { font-size:13px; color:var(--faint); }
.cah .next-item .pill { white-space:nowrap; flex-shrink:0; }
.cah .restricted-nav { display:flex; flex-wrap:wrap; gap:6px 18px; align-items:center; border:1px solid var(--soft-line); background:var(--soft);
  padding:10px 14px; margin:16px 0; font-size:14px; }
.cah .restricted-nav .lbl { font-weight:600; color:var(--muted); font-size:12.5px; letter-spacing:.5px; text-transform:uppercase; }
.cah .restricted-nav a { font-weight:600; text-decoration:none; } .cah .restricted-nav a:hover { text-decoration:underline; }
.cah .restricted-nav a::after { content:" →"; }
.cah .restricted-nav .on { font-weight:600; color:var(--navy); border-bottom:2px solid var(--blue); }
.cah .restricted-nav.top { margin:0; }
/* Program status (working group page) */
.cah .ps .ad-tile .v { font-size:30px; }
.cah .ps-board { display:grid; grid-template-columns:repeat(var(--cols),minmax(220px,1fr)); gap:12px; overflow-x:auto; padding-bottom:6px; }
.cah .ps-col { background:var(--sand-2); padding:10px; min-width:220px; }
.cah .ps-col-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:600; font-size:14px; color:var(--navy); margin:2px 2px 10px; }
.cah .ps-card { background:#fff; border:1px solid var(--line); padding:12px 14px; margin-bottom:10px; font-size:13.5px; }
.cah .ps-card h4 { font-size:16px; margin:0 0 6px; }
.cah .ps-tags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }
.cah .ps-tags .chip { margin:0; font-size:11px; padding:1px 7px; }
.cah .ps-pill { display:inline-block; font-size:11.5px; font-weight:600; padding:1px 8px; border-radius:10px; background:var(--soft); color:var(--navy); white-space:nowrap; }
.cah .ps-pill.ok { background:#D7F0DD; } .cah .ps-pill.risk { background:#FBE7C6; } .cah .ps-pill.slip { background:#F6D5D5; }
.cah .ps-pill.track { background:var(--sand); }
.cah .ps-pill.st-Onhold { background:#FBE7C6; } .cah .ps-pill.st-Wontdo { background:#E1E5EA; color:var(--muted); }
.cah .ps-filters { display:flex; flex-wrap:wrap; gap:8px 18px; align-items:center; font-size:14px; color:var(--muted); margin:0 0 12px; }
.cah .ps-filters label { display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
.cah .ps-filters input { accent-color:var(--primary); width:16px; height:16px; }
.cah .ps-parked { margin:-8px 0 16px; font-size:13.5px; color:var(--muted); }
.cah .ps-pill.w-Open, .cah .ps-pill.f-New { background:var(--sand); } .cah .ps-pill.w-Inprogress, .cah .ps-pill.f-Reviewing { background:#D6E9F8; }
.cah .ps-pill.w-Done, .cah .ps-pill.f-Done { background:#D7F0DD; } .cah .ps-pill.f-Planned { background:#E4DCF5; } .cah .ps-pill.f-Wontdo { background:#E1E5EA; }
.cah .ps-card dl { margin:0 0 6px; display:grid; gap:2px; }
.cah .ps-card dl div { display:flex; gap:6px; } .cah .ps-card dt { color:var(--faint); min-width:62px; } .cah .ps-card dd { margin:0; }
.cah .ps-next { margin:4px 0; color:var(--muted); }
.cah .ps-fb { margin:4px 0; color:#B4463A; font-weight:600; font-size:12.5px; }
.cah .ps-card details summary, .cah .ps td details summary { cursor:pointer; color:var(--primary); font-size:12.5px; }
.cah .ps-card details p, .cah .ps td details p { margin:6px 0 0; white-space:pre-wrap; color:var(--muted); }
.cah .ps-links { display:flex; gap:12px; margin:6px 0 0; font-size:13px; }
.cah .ps td.wide { min-width:220px; }
.cah .ps td.overdue { color:#B4463A; font-weight:600; }
.cah .ps .ad-head { margin-top:4px; }
/* Copilot adoption (admin page) */
.cah .ad { --good:#2F8A5B; --warn:#B87A1F; --bad:#B4463A; }
.cah .ad .faint { color:var(--faint); font-size:13.5px; }
.cah .ad-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; border-bottom:1px solid var(--line); margin-bottom:20px; }
.cah .ad-lock { font-size:12.5px; color:var(--muted); background:var(--soft); padding:3px 10px; margin-bottom:10px; }
.cah .ad-tabs { display:flex; gap:2px; overflow-x:auto; }
.cah .ad-tabs button { background:none; border:0; border-bottom:3px solid transparent; color:var(--muted); font-weight:500; font-size:15px; padding:8px 14px 10px; cursor:pointer; white-space:nowrap; }
.cah .ad-tabs button:hover { color:var(--navy); }
.cah .ad-tabs button.on { color:var(--navy); border-bottom-color:var(--blue); font-weight:600; }
.cah .ad section[hidden], .cah .ad [hidden] { display:none !important; }
.cah .ad-seg { display:inline-flex; border:1px solid var(--soft-line); margin:0 0 8px; }
.cah .ad-seg button { background:#fff; border:0; padding:4px 12px; font-size:13px; color:var(--muted); cursor:pointer; }
.cah .ad-seg button + button { border-left:1px solid var(--soft-line); }
.cah .ad-seg button.on { background:var(--primary); color:#fff; }
.cah .ad-info { background:var(--soft); border-left:4px solid var(--primary); padding:10px 16px; font-size:14px; margin-bottom:16px; color:var(--muted); }
.cah .ad-warn { background:#FBF3E4; border-left:4px solid var(--warn); padding:12px 16px; font-size:14.5px; margin-bottom:16px; }
.cah .ad-tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:20px; }
.cah .ad-tiles.five { grid-template-columns:repeat(5,1fr); }
.cah .ad-tile { background:#fff; border:1px solid var(--line); padding:16px 18px; }
.cah .ad-tile.accent { background:var(--primary); border-color:var(--primary); color:#fff; }
.cah .ad-tile.stage { border-top:6px solid var(--c); }
.cah .ad-tile .k { font-size:12px; letter-spacing:1.5px; text-transform:uppercase; font-weight:600; color:var(--muted); }
.cah .ad-tile.accent .k { color:#C7D5DF; }
.cah .ad-tile .v { font:300 38px/1.1 var(--serif); margin:6px 0 4px; }
.cah .ad-tile .s { font-size:13.5px; color:var(--faint); }
.cah .ad-tile.accent .s { color:#E3ECF3; }
.cah .ad .delta { font-weight:600; font-size:13px; color:var(--faint); }
.cah .ad .delta.up { color:var(--good); } .cah .ad .delta.down { color:var(--bad); }
.cah .ad-panel { border:1px solid var(--line); background:#fff; padding:18px 20px; margin-bottom:16px; min-width:0; }
.cah .ad-panel h3 { margin:0 0 2px; }
.cah .ad-panel h4 { font:600 12px var(--sans); letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); margin:18px 0 8px; }
.cah .ad .hint { font-size:13.5px; color:var(--faint); margin:0 0 12px; }
.cah .ad .count { font:400 13px var(--sans); color:var(--faint); }
.cah .ad-grid2 { display:grid; grid-template-columns:2fr 1fr; gap:16px; }
.cah .ad-grid2b { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.cah .ad-legend { display:flex; gap:14px; flex-wrap:wrap; font-size:13px; color:var(--muted); margin-bottom:6px; }
.cah .ad-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:middle; }
.cah .ad svg text { font-family:var(--sans); }
.cah .ad-bars .row { display:grid; grid-template-columns:130px 1fr 80px; gap:10px; align-items:center; margin:9px 0; font-size:14px; }
.cah .ad-bars .mv-row { grid-template-columns:96px 1fr 40px; }
.cah .ad-bars .track { background:var(--soft); height:14px; }
.cah .ad-bars .fill { background:var(--primary); height:14px; }
.cah .ad-bars .num { text-align:right; color:var(--muted); font-size:13px; }
.cah .ad .scroll { overflow-x:auto; }
.cah .ad table { width:100%; border-collapse:collapse; font-size:14px; }
.cah .ad th { text-align:left; color:var(--muted); font-weight:600; font-size:12.5px; border-bottom:1px solid var(--line); padding:6px; white-space:nowrap; }
.cah .ad th.sort { cursor:pointer; } .cah .ad th.sort:hover { color:var(--navy); }
.cah .ad td { border-bottom:1px solid var(--line); padding:8px 6px; vertical-align:middle; }
.cah .ad .n { text-align:right; font-variant-numeric:tabular-nums; }
.cah .ad tr.click { cursor:pointer; } .cah .ad tr.click:hover td { background:#F7F9FB; }
.cah .ad .pill { background:var(--sand-2); font-weight:400; white-space:nowrap; }
.cah .ad .stg { display:inline-flex; align-items:center; gap:6px; font-size:13px; white-space:nowrap; }
.cah .ad .stg i { width:10px; height:10px; border-radius:2px; background:var(--c); }
.cah .ad .mv { font-size:12.5px; font-weight:600; white-space:nowrap; }
.cah .ad .mv.new { color:var(--blue); } .cah .ad .mv.ramped_up { color:var(--good); } .cah .ad .mv.steady { color:var(--faint); font-weight:500; }
.cah .ad .mv.cooled { color:var(--warn); } .cah .ad .mv.lapsed { color:var(--bad); }
.cah .ad button.link { background:none; border:0; padding:0; cursor:pointer; text-align:left; text-decoration:underline; text-underline-offset:3px; }
.cah .ad .apps { display:flex; gap:3px; }
.cah .ad .apps b { font:600 10.5px var(--sans); min-width:22px; height:20px; padding:0 3px; display:inline-flex; align-items:center; justify-content:center; border-radius:3px; background:var(--soft); color:var(--soft-line); }
.cah .ad .apps b.on { background:var(--primary); color:#fff; }
.cah .ad .stack { display:flex; height:16px; min-width:120px; }
.cah .ad .stack span { height:16px; }
.cah .ad-filters { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
.cah .ad-filters input, .cah .ad-filters select { font:14px var(--sans); padding:7px 10px; border:1px solid var(--soft-line); background:#fff; color:var(--navy); }
.cah .ad-filters input { flex:1; min-width:180px; }
.cah .ad-note { font-size:12.5px; color:var(--faint); margin-top:8px; }
.cah .ad-pd .ad-scrim { position:fixed; inset:0; background:rgba(2,29,60,.35); z-index:1000; }
.cah .ad-drawer { position:fixed; top:0; right:0; bottom:0; width:min(460px,100%); background:#fff; box-shadow:-8px 0 24px rgba(2,29,60,.18); overflow-y:auto; z-index:1001; }
.cah .ad-drawer .hd { background:var(--navy); color:#fff; padding:20px 22px; position:relative; }
.cah .ad-drawer .hd h3 { color:#fff; font:300 26px var(--serif); margin:0; padding-right:28px; }
.cah .ad-drawer .hd p { margin:2px 0 0; color:#C7D5DF; font-size:14px; }
.cah .ad-drawer .x { position:absolute; right:14px; top:10px; background:none; border:0; color:#fff; font-size:26px; cursor:pointer; line-height:1; }
.cah .ad-drawer .tags { display:flex; gap:8px; margin-top:12px; }
.cah .ad-drawer .tags > span { background:#fff; color:var(--navy); padding:2px 10px; border-radius:11px; }
.cah .ad-drawer h4 { font:600 12px var(--sans); letter-spacing:1.5px; text-transform:uppercase; color:var(--muted); margin:18px 0 8px; }
.cah .ad-drawer .bd { padding:18px 22px; }
.cah .ad-drawer .mini { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.cah .ad-drawer .mini > div { border:1px solid var(--line); padding:10px 12px; }
.cah .ad-drawer .mini .v { font:300 24px var(--serif); } .cah .ad-drawer .mini .k { font-size:12px; color:var(--faint); }
.cah .ad-drawer .next { background:var(--soft); border-left:4px solid var(--primary); padding:12px 14px; font-size:14px; }
@media (max-width:900px) {
  .cah .ad-tiles, .cah .ad-tiles.five { grid-template-columns:1fr 1fr; }
  .cah .ad-grid2, .cah .ad-grid2b { grid-template-columns:1fr; }
  .cah .ad-bars .row { grid-template-columns:100px 1fr 72px; }
}
@media (max-width:640px) {
  .cah .grid { grid-template-columns:1fr; }
  .cah .tip { grid-template-columns:1fr; gap:12px; }
  .cah .tip .num { display:flex; gap:10px; align-items:baseline; padding:6px 12px; }
  .cah .tip .num b { font-size:24px; }
}`;

export function ensureStyles(): void {
  if (document.getElementById('cassin-ai-hub-css')) return;
  const style = document.createElement('style');
  style.id = 'cassin-ai-hub-css';
  // Fonts are bundled (fonts.ts), so nothing is fetched from outside Microsoft 365. If a
  // content policy blocks data: fonts, the stack falls back to Georgia and Segoe UI.
  style.textContent = FONT_FACES + CSS;
  document.head.appendChild(style);
}
