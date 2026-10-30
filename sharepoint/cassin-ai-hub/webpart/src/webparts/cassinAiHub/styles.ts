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
