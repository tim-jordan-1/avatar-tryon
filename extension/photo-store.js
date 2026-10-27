// The three face photos (front, left, right) as JPEG data URLs: chrome.storage.local in the extension, localStorage
// when the pages run as plain pages for testing. They never leave this browser.
const inExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const KEY = 'photos', LS_KEY = 'tryon-photos';

export const photoStore = {
  async get() {
    try { return inExtension ? (await chrome.storage.local.get(KEY))[KEY] ?? null : JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
  },
  async set(urls) {
    if (inExtension) await chrome.storage.local.set({ [KEY]: urls });
    else localStorage.setItem(LS_KEY, JSON.stringify(urls));
  },
  async clear() {
    try { if (inExtension) await chrome.storage.local.remove(KEY); else localStorage.removeItem(LS_KEY); } catch { /* nothing stored */ }
  },
  // cb(urls or null) when another page changes the photos (the plain-page "storage" event fires only in other windows).
  onChange(cb) {
    if (inExtension) chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c[KEY]) cb(c[KEY].newValue ?? null); });
    else addEventListener('storage', (e) => { if (e.key === LS_KEY) { try { cb(JSON.parse(e.newValue)); } catch { cb(null); } } });
  },
};

export const toDataUrl = (canvas) => canvas.toDataURL('image/jpeg', 0.9);
