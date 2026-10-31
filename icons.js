// Line icons and file badges, copied from the desktop app (renderer/icons.js).
const P = {
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"/>',
  cloudUp: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5"/><path d="M12 19v-7m-3 3 3-3 3 3"/>',
  cloudDown: '<path d="M7 17a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.25 4.25 0 0 1-.5 8.5"/><path d="M12 11v8m-3-3 3 3 3-3"/>',
  cloudOff: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 1.3-2.4M10.5 4.2A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 2 7.7M3 3l18 18"/>',
  cloudCheck: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6m-3-3h6"/>',
  newFolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6m-3-3h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  collapse: '<path d="M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  spark: '<path d="M12 3c.5 4.5 2.5 6.5 7 7-4.5.5-6.5 2.5-7 7-.5-4.5-2.5-6.5-7-7 4.5-.5 6.5-2.5 7-7z"/><path d="M19 15c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12m-5-5 5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h9V3M7 21v-7h10v7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h2l2-2h4l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// Claude mark in Claude's coral (same as the desktop app).
export function claudeLogo(size = 18) {
  return `<svg class="ic claude-logo" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><g stroke="#D97757" stroke-width="2.3" stroke-linecap="round"><line x1="12" y1="12" x2="13.34" y2="2.49"/><line x1="12" y1="12" x2="16.68" y2="6.01"/><line x1="12" y1="12" x2="20.34" y2="8.63"/><line x1="12" y1="12" x2="19.92" y2="13.11"/><line x1="12" y1="12" x2="19.41" y2="17.79"/><line x1="12" y1="12" x2="14.77" y2="18.86"/><line x1="12" y1="12" x2="10.72" y2="21.11"/><line x1="12" y1="12" x2="7.20" y2="18.15"/><line x1="12" y1="12" x2="3.10" y2="15.60"/><line x1="12" y1="12" x2="4.47" y2="10.94"/><line x1="12" y1="12" x2="5.07" y2="6.58"/><line x1="12" y1="12" x2="8.93" y2="4.40"/></g></svg>`;
}

// File-type badges for the explorer and tabs: [label, color]
const FILE_BADGES = {
  js: ['JS', '#f1dd3f'], mjs: ['JS', '#f1dd3f'], cjs: ['JS', '#f1dd3f'], jsx: ['JSX', '#61dafb'],
  ts: ['TS', '#3b82f6'], tsx: ['TSX', '#61dafb'], json: ['{}', '#f5b942'], html: ['<>', '#f06529'],
  htm: ['<>', '#f06529'], css: ['#', '#38bdf8'], scss: ['#', '#e46ea9'], less: ['#', '#4a6dab'],
  md: ['M↓', '#7aa2f7'], py: ['PY', '#4f9fdc'], rb: ['RB', '#e0393e'], go: ['GO', '#00add8'],
  rs: ['RS', '#e5865a'], java: ['JV', '#e76f00'], kt: ['KT', '#a97bff'], swift: ['SW', '#fa7343'],
  c: ['C', '#5c8dbc'], h: ['H', '#a074c4'], cpp: ['C++', '#5c8dbc'], hpp: ['H++', '#a074c4'],
  cs: ['C#', '#9b4f96'], php: ['PHP', '#8892bf'], lua: ['LUA', '#6b8cff'], sh: ['$', '#89e051'],
  zsh: ['$', '#89e051'], bash: ['$', '#89e051'], yml: ['YML', '#cb171e'], yaml: ['YML', '#cb171e'],
  xml: ['XML', '#e37933'], svg: ['SVG', '#ffb13b'], png: ['IMG', '#a78bfa'], jpg: ['IMG', '#a78bfa'],
  jpeg: ['IMG', '#a78bfa'], gif: ['IMG', '#a78bfa'], webp: ['IMG', '#a78bfa'], ico: ['IMG', '#a78bfa'],
  sql: ['SQL', '#e38c00'], txt: ['TXT', '#9aa4b8'], dart: ['DRT', '#00b4ab'], vue: ['VUE', '#41b883'],
  svelte: ['SV', '#ff3e00'], toml: ['TML', '#9c4221'], env: ['ENV', '#ecd53f'], lock: ['LCK', '#8b8b8b'],
  gitignore: ['GIT', '#f05133'], dockerfile: ['DKR', '#2496ed'], makefile: ['MK', '#6d8086'],
};

export function fileBadge(name) {
  const lower = String(name).toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() : lower;
  const [label, color] = FILE_BADGES[ext] || FILE_BADGES[lower.replace(/^\./, '')] || ['', '#8b93a7'];
  if (!label) return `<span class="fbadge" style="color:${color}">${icon('files', 14)}</span>`;
  return `<span class="fbadge" style="color:${color}">${label.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
}
