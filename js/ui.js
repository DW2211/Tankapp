// Kleine Design-Bausteine: Marken-Abzeichen, Sparklines, Icons, Zahlen-Animation.

// Erkennungsfarben der Tankstellenmarken (nur Farbe + Kürzel, keine Logos)
const BRANDS = [
  [/aral/i, '#0063cb', '#fff', 'ARAL'],
  [/shell/i, '#fbce07', '#dd1d21', 'SHELL'],
  [/esso/i, '#ffffff', '#d52b1e', 'ESSO'],
  [/\bjet\b/i, '#ffd400', '#002f87', 'JET'],
  [/total/i, 'linear-gradient(135deg,#e4002b,#ff7900 55%,#00a0df)', '#fff', 'TE'],
  [/avia/i, '#e30613', '#fff', 'AVIA'],
  [/\bstar\b/i, '#e2001a', '#fff', 'STAR'],
  [/agip|\beni\b/i, '#ffd500', '#1a1a1a', 'ENI'],
  [/\bomv\b/i, '#0a2a5c', '#fff', 'OMV'],
  [/\bhem\b/i, '#f39200', '#fff', 'HEM'],
  [/orlen/i, '#e2001a', '#fff', 'ORL'],
  [/\bbft\b/i, '#003c7d', '#fff', 'BFT'],
  [/raiffeisen/i, '#009a3e', '#fff', 'RAI'],
  [/westfalen/i, '#e30613', '#fff', 'WES'],
  [/\bq1\b/i, '#004b9b', '#fff', 'Q1'],
  [/globus/i, '#004b8d', '#fff', 'GLO'],
  [/tamoil/i, '#ff6a00', '#fff', 'TAM'],
  [/hoyer/i, '#e2001a', '#fff', 'HOY'],
  [/classic/i, '#0b4ea2', '#fff', 'CLA'],
];

export function brandBadge(name = '') {
  const m = BRANDS.find(([re]) => re.test(name));
  if (m) return `<span class="brand-badge" style="--bg-b:${m[1]};--fg:${m[2]}">${m[3]}</span>`;
  const short = (name.replace(/[^A-Za-zÄÖÜäöü0-9]/g, '').slice(0, 3) || '⛽').toUpperCase();
  return `<span class="brand-badge">${short}</span>`;
}

/** Mini-Verlauf als SVG (eine Reihe, Titel der Karte benennt sie) */
export function sparkline(values, color = 'var(--accent)') {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const w = 64, h = 28, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * w, h - 3 - ((x - min) / span) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const id = 'sg' + Math.random().toString(36).slice(2, 7);
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})" stroke="none"/>
    <path d="${line}" stroke="${color}" stroke-width="2" fill="none"/>
    <circle cx="${lx}" cy="${ly}" r="3" fill="${color}" stroke="var(--surface-solid)" stroke-width="1.5"/>
  </svg>`;
}

export const ICONS = {
  wallet: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7h16a1 1 0 0 1 1 1v3"/><path d="M20 11h-4a2 2 0 0 0 0 4h4z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  road: '<svg viewBox="0 0 24 24"><path d="M5 21L9 3M19 21L15 3M12 5v2M12 11v2M12 17v2"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  piggy: '<svg viewBox="0 0 24 24"><path d="M19 9c1 .5 2 1.6 2 3h-2c-.4 1.3-1.2 2.4-2.3 3.2L17 19h-3l-.5-2h-3L10 19H7l.3-3.6A6 6 0 0 1 11 6h3l3-2v4c.8.3 1.5.6 2 1z"/><circle cx="15" cy="10" r=".6"/></svg>',
  route: '<svg viewBox="0 0 24 24"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/></svg>',
};

/** Zählt eine Zahl weich hoch/runter (wie in Banking-Apps) */
export function countUp(el, from, to, format, ms = 700) {
  if (!Number.isFinite(from) || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3);
    el.innerHTML = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Guten Tag';
  if (h < 22) return 'Guten Abend';
  return 'Gute Nacht';
}
