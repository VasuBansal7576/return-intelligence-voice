// Original schematic artwork. These are illustrations, not catalog photographs.
const colors = [
  [/charcoal|ink black|black/i,'#343e3b','#232c29'], [/navy|midnight/i,'#394b58','#273740'],
  [/sage|olive|green/i,'#8d9d7f','#6f8363'], [/off white|cream|white|ecru/i,'#e5e3d6','#c4c5b8'],
  [/lilac|purple/i,'#b5a4be','#9483a0'], [/blue/i,'#a6bbc6','#7e9caa'],
  [/red|maroon/i,'#a87769','#885b50'], [/mustard|yellow/i,'#c2ac6a','#a18a4a'],
  [/pink|peach/i,'#d8b4a5','#b98f7e'], [/grey|gray/i,'#a5aba6','#818d84'],
];
export function productArt(product={}, key='art') {
  const colorName = product.colors?.[0] || 'charcoal';
  let [,base,shade] = colors.find(([test])=>test.test(colorName)) || colors[0];
  if (product.catalogSource && colorName === 'listed product variant') { base='#a6afa6'; shade='#87958a'; }
  const id = String(key).replace(/[^a-zA-Z0-9]/g,'');
  const category = product.category || 'tshirt';
  const body = category === 'dress' ? '<path d="M71 37 88 29Q100 42 112 29L129 37 138 65 124 73 126 100 148 183Q100 194 52 183L74 100 76 73 62 65Z"/>' : category === 'joggers'||category === 'shorts' ? `<path d="M68 31Q100 38 132 31L144 ${category==='shorts'?'128':'192'} 114 ${category==='shorts'?'133':'196'} 100 ${category==='shorts'?'78':'100'} 86 ${category==='shorts'?'133':'196'} 56 ${category==='shorts'?'128':'192'}Z"/>` : category === 'accessory' ? '<path d="M58 105V80Q58 29 100 29T142 80v25Z"/><rect x="52" y="100" width="96" height="31" rx="5"/>' : '<path d="M68 37 87 30Q100 44 113 30L132 37 168 60 150 93 133 85 136 181Q100 189 64 181L67 85 50 93 32 60Z"/>';
  const fit = product.fit === 'oversized' ? 'translate(-9 -4) scale(1.09 1.04)' : 'translate(0 0)';
  const graphic = !product.catalogSource && product.theme && product.theme !== 'solid' && !['accessory','joggers','shorts'].includes(category) ? `<g opacity=".75" transform="translate(100 94)"><circle r="20" fill="none" stroke="#e4e5ce" stroke-width="1.7"/><ellipse rx="28" ry="8" transform="rotate(-30)" fill="none" stroke="#e4e5ce" stroke-width="1.4"/><circle cx="20" cy="-15" r="3.2" fill="#e4e5ce"/><path d="M-9 27H9" stroke="#e4e5ce" stroke-width="2"/></g>` : '';
  const stitching = category==='joggers'||category==='shorts' ? '<path d="M68 40Q100 47 132 40M99 44v27m-3-25-3 17m10-17 4 17"/>' : category==='accessory' ? '<path d="M60 106h80m-66-1v23m13-23v23m13-23v23m13-23v23m13-23v23"/>' : '<path d="M87 32Q100 54 113 32M68 82l-1 93q32 7 66 0l-1-93M36 62l16 25m112-25-16 25"/>';
  const details = category==='shirt'||category==='polo' ? '<path d="M86 31 78 47 94 57l6-15 6 15 16-10-8-16" fill="none" stroke="#ffffff30" stroke-width="1.4"/><path d="M100 47v116" stroke="#ffffff20" stroke-width="1.2"/><g fill="#c8cec055"><circle cx="102" cy="68" r="1.6"/><circle cx="102" cy="90" r="1.6"/><circle cx="102" cy="112" r="1.6"/></g>' : '';
  return `<div class="product-art" role="img" aria-label="Schematic illustration of ${escapeText(product.name || 'garment')}"><svg viewBox="0 0 200 210" aria-hidden="true"><defs><linearGradient id="g${id}" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${base}"/><stop offset=".6" stop-color="${base}"/><stop offset="1" stop-color="${shade}"/></linearGradient><filter id="n${id}"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".045"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs><ellipse cx="101" cy="192" rx="49" ry="4" fill="#1d392712"/><g transform="${fit}"><g fill="url(#g${id})" stroke="${shade}" stroke-width=".65" filter="url(#n${id})">${body}</g><g fill="none" stroke="#ffffff17" stroke-width="1.2">${stitching}</g>${graphic}${details}</g></svg><span class="art-caption">Schematic</span></div>`;
}
function escapeText(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
