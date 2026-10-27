// Reads a product page: name, colour, material, fabric weight and construction, and every table as markdown
// (for fit-map's size-chart parser). Self-contained on purpose: chrome.scripting.executeScript serialises this
// function into the page, so it may not use imports or outer variables. Async: Chrome waits for the promise.
export async function extractProduct(doc = document) {
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  let ld = {};
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const items = [data, ...(Array.isArray(data) ? data : []), ...(data['@graph'] ?? [])];
      // ProductGroup: a product with its colour and size variants (H&M uses it).
      const isProduct = (t) => t === 'Product' || t === 'ProductGroup';
      const p = items.find((x) => x && (isProduct(x['@type']) || (Array.isArray(x['@type']) && x['@type'].some(isProduct))));
      if (p) { ld = p; break; }
    } catch { /* a malformed block on a shop page is not our problem */ }
  }
  // A ProductGroup lists every colour; the shop's URL says which one is open (H&M: productpage.<article>.html, and the
  // address changes when you click a colour). Match the variant whose own URL is this page's.
  const here = doc.location?.pathname;
  const variant = (ld.hasVariant ?? []).find((v) => { try { return new URL(v.offers?.url ?? v.url, doc.location.href).pathname === here; } catch { return false; } });
  const body = text(doc.body);
  const meta = (p) => doc.querySelector(`meta[property="${p}"]`)?.content;
  const name = ld.name || meta('og:title') || text(doc.querySelector('h1')) || doc.title;
  // Material: the structured field, else the first run of "NN% fibre" in the page text.
  const material = ld.material || (body.match(/(\d{1,3}\s*%\s*[a-z]+(?:[\s,/]+\d{1,3}\s*%\s*[a-z]+)*)/i) ?? [])[1] || '';
  const gsmMatch = body.match(/(\d{2,3})\s*(?:gsm|g\/m2|g\/m²)/i), ozMatch = body.match(/(\d{1,2}(?:\.\d)?)\s*oz\b/i);
  const gsm = gsmMatch ? +gsmMatch[1] : ozMatch ? +(+ozMatch[1] * 33.906).toFixed(0) : null;
  // The whole page only when there is no structured product: its other products ("Denim Jacket") mislead.
  const low = `${name} ${ld.description ?? ''} ${ld.category ?? ''} ${ld.material ?? ''} ${ld.name ? '' : body}`.toLowerCase();
  // "rib trimmed neckline" is a jersey tee's trim, not a rib fabric.
  const construction = /denim/.test(low) ? 'denim' : /\brib(bed)?\b(?![\s-]*trim)/.test(low) ? 'rib'
    : /jersey|knit|t-shirt|\btee\b/.test(low) ? 'jersey' : /woven|weave|poplin|oxford|twill|linen|shirting/.test(low) ? 'woven' : 'jersey';
  // Every table as markdown, with the nearest heading before it (the size-chart parser picks tables by heading).
  const tables = [...doc.querySelectorAll('table')].map((t) => {
    let heading = text(t.querySelector('caption')), el = t;
    while (!heading && el && el !== doc.body) {
      let s = el.previousElementSibling;
      while (s && !/^H[1-4]$/.test(s.tagName)) s = s.previousElementSibling;
      if (s) heading = text(s); else el = el.parentElement;
    }
    const rows = [...t.querySelectorAll('tr')].map((r) => `| ${[...r.children].map(text).join(' | ')} |`);
    return `${heading ? `## ${heading}\n\n` : ''}${rows.join('\n')}`;
  });
  // H&M has no chart in the page until its size guide opens, and then shows one size range at a time. Its JSON
  // endpoint has the whole chart, so fetch it (same origin, so the shop's own cookies apply).
  // shortcut: one shop's endpoint; add others the same way when a shop hides its chart
  const hm = (doc.location?.href ?? '').match(/\/\/[^/]*hm\.com\/([a-z]{2}_[a-z]{2})\/productpage\.(\d+)\.html/);
  if (hm) {
    try {
      const [guide] = await (await fetch(`/pxa/v1/${hm[1]}/hm/sizeguide/${hm[2]}`)).json();
      const rows = guide?.sizeGuideOne?.[0]?.sizeTableData?.map((r) => `| ${r.row.join(' | ')} |`);
      if (rows?.length) tables.unshift(`## ${guide.headline ?? 'Size guide'}\n\n${rows.join('\n')}`);
    } catch { /* no guide for this product: the page tables still count */ }
  }
  return { url: doc.location?.href ?? '', name, color: variant?.color || ld.color || '', material, gsm, construction, category: ld.category || '', tables };
}
