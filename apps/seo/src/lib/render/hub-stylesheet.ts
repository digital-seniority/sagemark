/**
 * hub-stylesheet — the full hub design system for the public content hub
 * (lane render-geo). Ported from the canonical reference demo
 * (`examples/whispering-willows-demo/styles.css`) so the app-hosted hub renders
 * at the SAME design caliber as the bundled standalone demo.
 *
 * BRAND-ADAPTIVE. The demo's fixed palette (willow / cream / gold / ink) is
 * re-expressed as a `:root` token layer that DEFAULTS to the demo values but
 * pulls from the `--brand-*` custom properties `buildBrandStyleTag` sets — so the
 * SAME stylesheet re-skins to any client's `content_clients.brand_spec` palette.
 * Secondary tones (the willow scale, hairlines, muted text) are derived with
 * `color-mix()` off those tokens. The render emits the demo CLASS NAMES, so the
 * component rules below apply verbatim; `data-role` hooks are preserved alongside
 * for the SSR contract tests.
 *
 * INJECTION SAFETY. Static string — zero interpolation — safe by construction.
 * PAGE-SCOPED. Rendered only by the hub routes, so `:root` / `body` / bare-element
 * rules apply only on hub pages and never leak into the Studio app.
 */

export const HUB_STYLESHEET = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --willow-900: var(--brand-dark, #2f4339);
  --willow-700: var(--brand-color, #3d5446);
  --willow-600: color-mix(in srgb, var(--brand-color, #3d5446) 86%, #ffffff);
  --willow-500: color-mix(in srgb, var(--brand-color, #3d5446) 70%, #ffffff);
  --willow-200: color-mix(in srgb, var(--brand-color, #3d5446) 30%, #ffffff);
  --willow-100: color-mix(in srgb, var(--brand-color, #3d5446) 16%, #ffffff);
  --willow-50:  color-mix(in srgb, var(--brand-color, #3d5446) 8%, var(--brand-bg, #faf7f1));

  --cream:   var(--brand-bg, #faf7f1);
  --cream-2: color-mix(in srgb, var(--brand-bg, #faf7f1) 92%, var(--brand-ink, #2b2924));
  --paper:   var(--brand-surface, #ffffff);

  --ink:     var(--brand-ink, #2b2924);
  --ink-soft:color-mix(in srgb, var(--brand-ink, #2b2924) 86%, var(--brand-bg, #faf7f1));
  --muted:   color-mix(in srgb, var(--brand-ink, #2b2924) 56%, var(--brand-bg, #faf7f1));
  --line:    color-mix(in srgb, var(--brand-ink, #2b2924) 12%, var(--brand-bg, #faf7f1));
  --line-2:  color-mix(in srgb, var(--brand-ink, #2b2924) 18%, var(--brand-bg, #faf7f1));

  --gold:    var(--brand-accent, #c08a4e);
  --gold-700:color-mix(in srgb, var(--brand-accent, #c08a4e) 78%, #000000);
  --terra:   #bb6a48;
  --rose-50: #f7ece6;
  --sky-50:  #ecf1f4;
  --amber-50:#fbf3e2;

  --radius:  16px;
  --radius-sm: 10px;
  --shadow:  0 1px 2px rgba(43,41,36,.04), 0 8px 30px rgba(43,41,36,.07);
  --shadow-lg: 0 30px 60px -20px rgba(47,67,57,.35);
  --maxw:    1180px;
  --readw:   720px;

  --font-serif: var(--brand-heading-font, 'Fraunces', Georgia, 'Times New Roman', serif);
  --font-sans:  var(--brand-body-font, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
}

.hub * { box-sizing: border-box; }
body:has(.hub) { margin: 0; }
.hub {
  font-family: var(--font-sans);
  color: var(--ink);
  background: var(--cream);
  font-size: 18px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
.hub img { max-width: 100%; display: block; }
.hub a { color: var(--willow-700); text-decoration-color: var(--willow-200); text-underline-offset: 3px; }
.hub a:hover { color: var(--gold-700); }

.hub .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px; }
.hub .read { max-width: var(--readw); margin-left: auto; margin-right: auto; }

.hub h1, .hub h2, .hub h3, .hub h4 { font-family: var(--font-serif); color: var(--ink); line-height: 1.15; font-weight: 600; letter-spacing: -.01em; }
.hub h2 { font-size: clamp(1.7rem, 3.4vw, 2.35rem); margin: 2.6em 0 .6em; }
.hub h3 { font-size: clamp(1.25rem, 2.2vw, 1.5rem); margin: 1.8em 0 .4em; font-weight: 600; }
.hub p { margin: 0 0 1.15em; }
.hub .eyebrow { font-family: var(--font-sans); text-transform: uppercase; letter-spacing: .16em; font-size: .76rem; font-weight: 700; color: var(--gold-700); }

/* ---------- Top bar ---------- */
.hub .topbar { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--cream) 86%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.hub .topbar .wrap { display: flex; align-items: center; justify-content: space-between; height: 70px; gap: 20px; }
.hub .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); }
.hub .brand-badge { display: inline-flex; align-items: center; justify-content: center; flex: none; background: #fff; border-radius: 12px; padding: 7px 11px; box-shadow: 0 1px 3px rgba(43,41,36,.12); }
.hub .brand-badge img { height: 40px; width: auto; display: block; }
.hub .footer .brand-badge { box-shadow: none; padding: 8px 12px; }
.hub .brand b { font-family: var(--font-serif); font-weight: 600; font-size: 1.18rem; line-height: 1; letter-spacing: -.01em; }
.hub .brand small { display: block; font-family: var(--font-sans); font-size: .68rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }
.hub .nav { display: flex; align-items: center; gap: 26px; }
.hub .nav a { font-size: .95rem; font-weight: 500; text-decoration: none; color: var(--ink-soft); }
.hub .nav a:hover { color: var(--gold-700); }
.hub .btn { display: inline-flex; align-items: center; gap: 8px; background: var(--willow-700); color: #fff; border: 0; padding: 12px 20px; border-radius: 999px; font-weight: 600; font-size: .95rem; text-decoration: none; cursor: pointer; transition: transform .15s ease, background .2s ease; font-family: var(--font-sans); }
.hub .btn:hover { background: var(--willow-900); color: #fff; transform: translateY(-1px); }
.hub .btn.gold { background: var(--gold); } .hub .btn.gold:hover { background: var(--gold-700); color:#fff; }
.hub .btn.ghost { background: transparent; color: var(--willow-700); border: 1.5px solid var(--willow-200); }
.hub .btn.ghost:hover { background: var(--willow-50); color: var(--willow-900); }
.hub .nav .btn, .hub .nav .btn:hover { color: #fff; }
.hub .nav .btn.ghost { color: var(--willow-700); }
.hub .nav-toggle { display: none; background: none; border: 0; cursor: pointer; padding: 8px; }
@media (max-width: 860px) {
  .hub .nav { position: fixed; inset: 70px 0 auto 0; background: var(--cream); flex-direction: column; align-items: stretch; gap: 0; padding: 8px 24px 20px; border-bottom: 1px solid var(--line); transform: translateY(-120%); transition: transform .25s ease; }
  .hub .nav.open { transform: translateY(0); }
  .hub .nav a { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .hub .nav .btn { margin-top: 12px; justify-content: center; }
  .hub .nav-toggle { display: block; }
}

/* ---------- Hero ---------- */
.hub .hero { position: relative; overflow: hidden; background: linear-gradient(180deg, var(--willow-50), var(--cream)); }
.hub .hero .wrap { display: grid; grid-template-columns: 1.05fr .95fr; gap: 56px; align-items: center; padding-top: 64px; padding-bottom: 64px; }
.hub .hero h1 { font-size: clamp(2.4rem, 5.2vw, 3.7rem); font-weight: 600; margin: .25em 0 .35em; }
.hub .hero p.lead { font-size: 1.2rem; color: var(--ink-soft); max-width: 34ch; }
.hub .hero .cta-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 26px; }
.hub .hero-art { position: relative; }
.hub .hero-art img { border-radius: 22px; box-shadow: var(--shadow-lg); aspect-ratio: 4/3.1; object-fit: cover; width: 100%; }
.hub .hero-badge { position: absolute; bottom: -22px; left: -22px; background: var(--paper); border-radius: 16px; box-shadow: var(--shadow); padding: 16px 20px; display: flex; align-items: center; gap: 12px; max-width: 250px; }
.hub .hero-badge .n { font-family: var(--font-serif); font-size: 2rem; font-weight: 600; color: var(--willow-700); line-height: 1; }
.hub .hero-badge small { font-size: .82rem; color: var(--muted); line-height: 1.3; }
@media (max-width: 900px) { .hub .hero .wrap { grid-template-columns: 1fr; gap: 36px; } .hub .hero-badge { left: 12px; } }

/* ---------- Section helpers ---------- */
.hub .section { padding: 70px 0; }
.hub .section.alt { background: var(--cream-2); }
.hub .section.willow { background: var(--willow-900); color: #eef3ef; }
.hub .section.willow h2, .hub .section.willow h3 { color: #fff; }
.hub .section-head { max-width: 640px; margin-bottom: 36px; }
.hub .section-head.center { margin-left: auto; margin-right: auto; text-align: center; }
.hub .section-head h2 { margin-top: .1em; }
.hub .section-head p { color: var(--muted); font-size: 1.08rem; }

/* ---------- Strategy steps ---------- */
.hub .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.hub .step { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 26px; box-shadow: var(--shadow); }
.hub .step .k { font-family: var(--font-serif); font-size: .9rem; font-weight: 600; color: var(--gold-700); letter-spacing: .04em; }
.hub .step h3 { margin: .2em 0 .35em; font-size: 1.22rem; }
.hub .step p { color: var(--muted); font-size: .98rem; margin: 0; }
.hub .section.willow .step { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.14); }
.hub .section.willow .step .k { color: color-mix(in srgb, var(--gold) 60%, #fff); }
.hub .section.willow .step h3 { color: #fff; }
.hub .section.willow .step p { color: #bccabf; }
@media (max-width: 820px){ .hub .steps { grid-template-columns: 1fr; } }

/* ---------- Article cards ---------- */
.hub .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }
.hub .card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); display: flex; flex-direction: column; transition: transform .18s ease, box-shadow .18s ease; text-decoration: none; color: inherit; }
.hub .card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
.hub .card .ph { aspect-ratio: 16/10; overflow: hidden; background: var(--willow-50); }
.hub .card .ph img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s ease; }
.hub .card:hover .ph img { transform: scale(1.04); }
.hub .card .body { padding: 22px 22px 24px; display: flex; flex-direction: column; flex: 1; }
.hub .card .tag { align-self: flex-start; font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; color: var(--willow-700); background: var(--willow-100); padding: 5px 11px; border-radius: 999px; margin-bottom: 14px; }
.hub .card h3 { margin: 0 0 .4em; font-size: 1.3rem; }
.hub .card p { color: var(--muted); font-size: .96rem; margin: 0 0 18px; }
.hub .card .more { margin-top: auto; font-weight: 600; color: var(--willow-700); font-size: .95rem; display: inline-flex; align-items: center; gap: 7px; }
.hub .card:hover .more { color: var(--gold-700); }
@media (max-width: 900px){ .hub .cards { grid-template-columns: 1fr; } }

/* ---------- CTA band ---------- */
.hub .cta-band { background: linear-gradient(135deg, var(--willow-700), var(--willow-900)); color: #fff; border-radius: 22px; padding: 44px; margin: 0; display: grid; grid-template-columns: 1.4fr 1fr; gap: 30px; align-items: center; box-shadow: var(--shadow-lg); }
.hub .cta-band h3 { color: #fff; font-size: 1.7rem; margin: 0 0 .35em; }
.hub .cta-band p { color: #d8e3da; margin: 0; }
.hub .cta-band .actions { display: flex; flex-direction: column; gap: 12px; }
.hub .cta-band .btn { justify-content: center; }
.hub .cta-band .btn.white { background: #fff; color: var(--willow-900); } .hub .cta-band .btn.white:hover { background: var(--cream); }
.hub .cta-band .phone { text-align: center; font-size: .9rem; color: #cdd9cf; }
.hub .cta-band .phone b { color: #fff; font-size: 1.25rem; font-family: var(--font-serif); display:block; }
@media (max-width: 760px){ .hub .cta-band { grid-template-columns: 1fr; padding: 30px; } }

/* ---------- Article reading column ---------- */
.hub .breadcrumb { font-size: .82rem; color: var(--muted); padding: 22px 0 0; }
.hub .breadcrumb a { text-decoration: none; }
.hub .article-head { padding: 18px 0 8px; }
.hub .article-head h1 { font-size: clamp(2rem, 4.6vw, 3.1rem); font-weight: 600; margin: .2em 0 .3em; }
.hub .article-head .dek { font-size: 1.22rem; color: var(--ink-soft); }
.hub .prose { padding: 14px 0 10px; }
.hub .prose .read > p:first-of-type { font-size: 1.16rem; }
.hub .prose p, .hub .prose ul, .hub .prose ol { font-size: 1.06rem; }
.hub .prose ul, .hub .prose ol { padding-left: 1.25em; margin: 0 0 1.2em; }
.hub .prose li { margin: .4em 0; }
.hub .prose h2 { scroll-margin-top: 90px; }
.hub .prose h2::after { content: ""; display: block; width: 54px; height: 3px; background: var(--gold); border-radius: 2px; margin-top: .5rem; }
.hub .prose table { width: 100%; border-collapse: collapse; margin: 26px 0; font-size: .98rem; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.hub .prose th, .hub .prose td { padding: 14px 18px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
.hub .prose thead th { background: var(--willow-900); color: #fff; font-weight: 600; }
.hub .prose blockquote { margin: 32px 0; padding: 4px 0 4px 26px; border-left: 4px solid var(--gold); font-family: var(--font-serif); font-style: italic; color: var(--willow-900); }
.hub .prose img { border-radius: 16px; box-shadow: var(--shadow); margin: 24px auto; }

/* ---------- Footer ---------- */
.hub .footer { background: var(--willow-900); color: #cdd9cf; padding: 56px 0 30px; margin-top: 10px; }
.hub .footer .grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 40px; }
.hub .footer h5 { font-family: var(--font-serif); color: #fff; font-size: 1.05rem; margin: 0 0 14px; font-weight: 600; }
.hub .footer a { color: #cdd9cf; text-decoration: none; }
.hub .footer a:hover { color: #fff; }
.hub .footer .brand b { color: #fff; }
.hub .footer .brand small { color: #9fb3a6; }
.hub .footer p { font-size: .92rem; }
.hub .footer .links { list-style: none; padding: 0; margin: 0; }
.hub .footer .links li { margin: .5em 0; font-size: .92rem; }
.hub .footer .nap { font-size: .92rem; line-height: 1.7; }
.hub .footer .legal { border-top: 1px solid rgba(255,255,255,.12); margin-top: 40px; padding-top: 22px; font-size: .82rem; color: #93a89b; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
@media (max-width: 820px){ .hub .footer .grid { grid-template-columns: 1fr; gap: 28px; } }

/* ---------- printable checklist ---------- */
.hub .print-actions { text-align: center; margin: 24px 0 8px; }
@media print { .hub .topbar, .hub .footer, .hub .cta-band { display: none !important; } .hub { background: #fff; font-size: 12pt; } }
`;
