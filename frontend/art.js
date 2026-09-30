import { catalogImages } from './catalog-images.js';
export function productArt(product={}, key='art') {
  const mapped=catalogImages[product.catalogSource?.url];
  const supplied=product.catalogSource?.imageUrl||product.imageUrl;
  const src=mapped?.src || (typeof supplied==='string'&&/^https:\/\//.test(supplied)?supplied:null);
  return `<div class="product-art ${src?'catalog-photo':'photo-unavailable'}">${src?`<img src="${escapeText(src)}" alt="Official catalog photograph: ${escapeText(product.name)}" loading="lazy" referrerpolicy="no-referrer"><span class="art-caption">Official catalog photo · ${escapeText(mapped?.observedAt||'source supplied')}</span>`:`<span>Catalog photograph unavailable</span><small>${escapeText(product.catalogSource?'Inspect the official product source below.':'Synthetic fixture · no product photo')}</small>`}</div>`;
}
function escapeText(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
