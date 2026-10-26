/* Claude Panel — çizgi ikonlar (24'lük ızgara, currentColor) */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  artifacts: '<circle cx="7.5" cy="7.5" r="3.5"/><path d="M16.75 3.75 20.5 10.25h-7.5z"/><rect x="13" y="13.5" width="7.5" height="7" rx="1.6"/><path d="M4 20.5 7.5 14l3.5 6.5z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/>',
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  pencil: '<path d="m15.5 4.5 4 4L9 19H5v-4z"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  forward: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M6 3.5h8l4.5 4.5v12.5H6zM14 3.5V8h4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15"/>',
  chat: '<path d="M4.5 6a1.5 1.5 0 0 1 1.5-1.5h12A1.5 1.5 0 0 1 19.5 6v8.5A1.5 1.5 0 0 1 18 16h-7.5l-4.5 3.5V16H6a1.5 1.5 0 0 1-1.5-1.5z"/>',
  sparkle: '<path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5V9H9"/><path d="M12 8v4l2.5 1.5"/>',
  plug: '<path d="M9 3.5V8M15 3.5V8M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0zM12 16v4.5"/>',
  octopus: '<path d="M6 12.5a6 6 0 1 1 12 0"/><path d="M6 12.5c0 3-1.6 4.8-2.5 6.5M9.5 13.5c0 2.6-.6 4.6-1.5 6.5M14.5 13.5c0 2.6.6 4.6 1.5 6.5M18 12.5c0 3 1.6 4.8 2.5 6.5"/><circle cx="10" cy="9.5" r=".9" fill="currentColor"/><circle cx="14" cy="9.5" r=".9" fill="currentColor"/>',
  skill: '<path d="M12 3.5c.6 3.9 1.6 4.9 5.5 5.5-3.9.6-4.9 1.6-5.5 5.5-.6-3.9-1.6-4.9-5.5-5.5 3.9-.6 4.9-1.6 5.5-5.5z"/><path d="M18 14.5c.3 1.9.8 2.4 2.5 2.7-1.7.3-2.2.8-2.5 2.6-.3-1.8-.8-2.3-2.5-2.6 1.7-.3 2.2-.8 2.5-2.7z"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  library: '<path d="M5 4.5v15M9.5 4.5v15M14 5.5l4.5 13.5M3.5 19.5h17"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.8"/><path d="M10.5 5.3h3"/>',
  home: '<path d="M4.5 11 12 4.5l7.5 6.5M6.5 9.5v10h11v-10"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  rotate: '<rect x="8" y="9.5" width="12" height="9" rx="2"/><path d="M4 13.5V8a3 3 0 0 1 3-3h5M10 2.5 12.5 5 10 7.5"/>',
  play: '<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L9.2 5.1a.8.8 0 0 0-1.2.7z"/>',
  power: '<path d="M12 4v7M7.5 6.8a7 7 0 1 0 9 0"/>',
  box: '<path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9z"/><path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9"/>',
  reply: '<path d="M9.5 6 4 11.5 9.5 17"/><path d="M4 11.5h9.5a6.5 6.5 0 0 1 6.5 6.5v.5"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17"/>',
  book: '<path d="M5 4.5h11.5A1.5 1.5 0 0 1 18 6v13.5H6.5A1.5 1.5 0 0 1 5 18z"/><path d="M5 18a1.5 1.5 0 0 1 1.5-1.5H18M9 8.5h5.5M9 11.5h3.5"/>',
  pin: '<path d="M9.5 3.5h5l-.8 5.2 3.3 3.3v1.5H7v-1.5l3.3-3.3z"/><path d="M12 13.5v7"/>',
};

function icon(name, size = 16, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('class', 'ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}
