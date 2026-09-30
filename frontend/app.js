import { icon } from './icons.js';
import { productArt } from './art.js';
import { createVoiceClient } from './voice-client.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeHtml;
const money = (n) => typeof n === 'number' && Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '—';
const humanize = (s) => String(s || '').replace(/[._-]/g, ' ').replace(/^./, c => c.toUpperCase());
const initials = (s) => (s || 'Demo Customer').split(' ').slice(0, 2).map(x => x[0]).join('');
const badge = (text, kind = 'neutral', dot = false) => `<span class="badge ${kind}">${dot ? '<i class="status-dot"></i>' : ''}${e(text)}</span>`;
const button = (text, action, style = 'secondary', ico = '', attrs = '') => `<button class="btn ${style}" data-action="${action}" ${attrs}>${ico ? icon(ico) : ''}${text}</button>`;
const detail = (label, value) => `<div class="detail-row"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
const caseMeta = {
  'CUST-001': {name:'A better fit', sub:'Returning customer · fit + fabric', prompt:'I like the design, but this feels too tight and hot. I prefer oversized tees and dark colors.', short:'Too tight and too hot', tag:'Personalized'},
  'CUST-002': {name:'A fresh start', sub:'New customer · fabric weight', prompt:'The fit is great and I like the design. The fabric is just too heavy. I would like something lighter with a similar fit.', short:'Great fit, heavy fabric', tag:'Cold start'},
  'CUST-003': {name:'An honest boundary', sub:'Outside the return window', prompt:'I would like to return this shirt because it is too tight.', short:'Outside the return window', tag:'Policy'},
  'CUST-004': {name:'Put the customer first', sub:'Quality issue · no selling', prompt:'The seam opened after one wash. I want help with the quality issue.', short:'The seam opened', tag:'Quality'},
  'CUST-005': {name:'One order, different rules', sub:'Final-sale item · item-level policy', prompt:'I changed my mind about this beanie and would like to return it.', short:'Final-sale item', tag:'Multi-item'},
};
const initialView = location.hash.replace('#','');
const state = {
  bootstrap:null, customerId:'CUST-001', session:null, view:['workspace','intelligence','evaluations','policy'].includes(initialView) ? initialView : 'workspace',
  busy:false, error:'', insights:null, evaluations:null, dialog:null, activeProduct:null, voice:null, voiceStatus:'idle', voiceTranscript:[],
};
let lastFocus = null;
let toastTimer;

async function api(path, body) {
  const response = await fetch(path, {method:body === undefined ? 'GET' : 'POST', headers:body === undefined ? undefined : {'content-type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('The local service returned an unreadable response. Try again.'); }
  if (!response.ok) throw new Error(data.error?.message || data.error || data.message || `Request failed (${response.status}).`);
  return data;
}
const customers = () => state.bootstrap?.customers || [];
const catalog = () => state.bootstrap?.catalog || [];
const customer = () => state.session?.customer || customers().find(c => c.customerId === state.customerId) || customers()[0] || {};
const productById = id => catalog().find(p => p.id === id) || (state.bootstrap?.fixtureCatalog||[]).find(p => p.id === id);
const order = () => state.session?.order || customer().orders?.find(o=>o.orderId===state.selectedScenario?.orderId) || customer().orders?.[0] || {};
const item = () => state.session?.item || order().items?.[0] || {};
const source = () => state.session?.sourceProduct || state.session?.product || productById(item().productId) || {};
const brain = () => state.session?.customerBrain || state.session?.brain || customer().customerBrain || null;
const candidates = () => state.session?.candidates || state.session?.recommendations || [];
const diagnosis = () => state.session?.diagnosis;
const completed = () => Boolean(state.session?.resolution);
const recAllowed = () => state.session?.recommendationAllowed ?? Boolean(diagnosis()?.recommendationAllowed);
const policy = () => state.bootstrap?.policy || {};
const policyVersion = () => policy().version || 'Canonical demo policy';
const sessionId = () => state.session?.id || state.session?.sessionId;
const toolEvents = () => { const saved=state.session?.tools||[]; return [...saved,...[...(state.voiceTools?.values()||[])].filter(t=>!saved.some(s=>s.callId===t.callId)).map(t=>({...t,id:t.callId,origin:"model",status:t.phase,detail:t.phase==="discarded"?"Response discarded; operation may already have executed. Inspect persisted state.":"Voice tool event",durationMs:null}))]; };
const modeLive = () => ['requesting-microphone','connecting','listening','thinking','speaking','active','muted','stopping'].includes(state.voiceStatus);
const busyAttrs = () => state.busy ? 'disabled' : '';
const pretty = obj => e(JSON.stringify(obj, null, 2));
function acceptSession(data) { state.session = data.session || data; state.customerId = state.session.customer?.customerId || state.customerId; }

function shell(content) {
  const nav = (view, label, ico, more='') => `<button class="nav-link ${state.view===view?'active':''}" data-nav="${view}" aria-label="${label}" ${state.view===view?'aria-current="page"':''}>${icon(ico)}<span class="nav-text">${label}</span>${more}</button>`;
  return `<div class="app-shell"><aside class="sidebar" aria-label="Main navigation"><div class="brand"><div class="brand-name">RIV<small>return intelligence voice</small></div></div><nav><div class="nav-label">Workspace</div>${nav('workspace','Voice workspace','voice')}${nav('intelligence','Brand intelligence','chart')}${nav('evaluations','Evaluation lab','shield')}<hr class="sidebar-divider"><div class="nav-label">Knowledge</div>${nav('policy','Canonical policy','book')}<button class="nav-link" data-action="catalog" aria-label="Product catalog">${icon('grid')}<span class="nav-text">Product catalog</span><span class="nav-count">${catalog().length}</span></button></nav><div class="sidebar-note">${icon('spark')}<h3>Every decision has a source.</h3><p>Listen to the call. Inspect the evidence. Confirm the outcome.</p></div><div class="sidebar-footer"><div class="workspace-avatar">TS</div><div><strong>The Souled Store</strong><span>Synthetic brand workspace</span></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><strong>The Souled Store</strong>${icon('chevron')}<span>${state.view==='workspace'?'Customer experience':state.view==='intelligence'?'Product & merchandising':state.view==='evaluations'?'Reliability':'Knowledge base'}</span></div><div class="topbar-right">${badge(state.voiceReady?'Live voice · demo commerce':'Text demo · simulated commerce','neutral',true)}<button class="icon-btn" data-action="connection" aria-label="Connection details">${icon('globe')}</button><div class="avatar" title="Demo workspace">TS</div></div></header><main class="main-content" id="main">${state.error?`<div class="error-banner" role="alert"><span>${icon('alert')} ${e(state.error)}</span><button class="icon-btn" data-action="dismiss-error" aria-label="Dismiss error">${icon('close')}</button></div>`:''}${content}<p class="demo-footnote">${icon('info')}Independent prototype, not affiliated with The Souled Store. Public product attributes have dated sources. Customer histories, inventory, and transactions are simulated; legacy products are labeled fixtures. Actions are simulated; no real refunds, orders, or deliveries.</p></main></div></div>`;
}
function heading(eyebrow,title,description,right='') {return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${right?`<div class="page-heading-right">${right}</div>`:''}</div>`;}
function render() {
  if (!state.bootstrap) return;
  const view = state.view==='workspace' ? workspaceView() : state.view==='intelligence' ? intelligenceView() : state.view==='evaluations' ? evaluationView() : policyView();
  const focused=document.activeElement;const draft=$('#message-input')?.value;
  const focusSelector=focused?.id?`#${focused.id}`:focused?.dataset?.action?`[data-action="${focused.dataset.action}"]`:null;
  $('#app').innerHTML = shell(view);
  if(draft&&$('#message-input')&&!state.busy)$('#message-input').value=draft;
  if(focusSelector&&!state.dialog)$(focusSelector)?.focus({preventScroll:true});
  if (state.dialog) renderDialog();
}
function waveform() {const heights=[9,15,24,16,34,51,29,41,65,48,36,58,69,41,30,51,38,25,42,22,16,30,17,11,6];return `<div class="waveform ${state.busy||modeLive()?'running':''}" aria-hidden="true">${heights.map((h,i)=>`<i style="--h:${h}px;--delay:${(i*.06).toFixed(2)}s;--o:${.5+Math.sin(i)*.2+.3}"></i>`).join('')}</div>`;}
function workspaceView() {
  if(state.session?.kind==='historical-replay'||state.replaySnapshot)return replayWorkspace();
  const c=customer();
  return `<div class="desk-heading"><div><span class="eyebrow">Merchant console / live conversation</span><h1>Signal desk<span class="desk-period">.</span></h1></div><button class="btn secondary" data-action="connection">${icon('info')} Session details</button>${state.bootstrap.capabilities?.replay?.sourceLookupAvailable?button('Historical replay','replay-sources','secondary','clock'):''}</div><div class="section-toolbar"><button class="scenario-select" data-action="scenarios" ${modeLive()?'disabled':''}><span class="avatar">${e(initials(c.name))}</span><span class="scenario-text"><strong>${e(c.name||'Choose a customer')}</strong><small>${e(order().orderId||'Select an order')} · synthetic demo</small></span>${icon('down')}</button><div class="toolbar-status">${badge('Offline text fixture','neutral')}${button('New session','restart','quiet small','refresh',busyAttrs())}</div></div><div class="view-grid"><section class="conversation-column" aria-label="Return conversation"><div class="card conversation-card"><div class="conversation-toolbar"><strong>Conversation</strong><span class="meta">Full transcript · ${(state.session?.messages||[]).length} saved turns</span></div>${conversation()}${alternateSection()}${activitySummary()}${pendingActionBar()}${resolutionCard()}${resolutionActions()}${suggestions()}${composer()}${voiceStage()}</div></section><aside class="context-column" aria-label="Grounded context"><div class="context-intro"><span class="eyebrow">The evidence desk</span><p>What we know. Where it came from.</p></div>${diagnosisCard()}${orderCard()}${customerCard()}<section class="card context-card"><div class="card-heading"><h3>Canonical policy</h3>${icon('shield')}</div><p class="policy-caption">${e(policyVersion())}</p><button class="text-link" data-nav="policy">Inspect configured policy ${icon('arrowUp','small-icon')}</button></section>${toolsCard()}</aside></div>`;
}
function replayWorkspace() {
  const live=state.session?.kind==='historical-replay'?state.session:null;
  const replay=state.replaySnapshot;
  const historical=live?.source?.items?.[0];
  const title=historical?.product?.name||replay?.sourceItem?.name||'Historical item';
  const opts=live?.candidates||[];
  return `<div class="desk-heading"><div><span class="eyebrow">Historical replay / no merchant integration</span><h1>Signal desk<span class="desk-period">.</span></h1></div>${button('Leave replay','exit-replay','secondary','',busyAttrs())}</div><div class="section-toolbar"><div><strong>${e(title)}</strong><p class="policy-caption">Refund Completed · historical status unchanged</p></div>${badge(state.voiceReady?'Live provider session':'Prepared replay · not live','neutral')}</div><div class="view-grid"><section class="conversation-column"><div class="conversation-toolbar"><strong>Current conversation</strong><span class="meta">Full transcript</span></div>${live?conversation():`<div class="conversation-empty"><span class="eyebrow">Receipt prepared</span><p>Start a voice session to capture the customer's current feedback. The original return reason is unknown.</p></div>`}${opts.length?`<section class="fit-stencil"><div class="section-title"><div><span class="eyebrow">Source-backed catalog alternatives</span><h2>Compare the current evidence.</h2></div>${badge('Stock unknown','neutral')}</div><div class="alternates-grid">${opts.map(c=>{const p={...c,catalogSource:{url:c.url},name:c.name};return `<article class="alternate-card">${productArt(p)}<div class="alternate-body"><h3>${e(c.name||'Product name unavailable')}</h3><p>${c.gsm==null?'GSM unknown':e(c.gsm)+' GSM'} · ${money(c.priceInr)}</p><p>${e(c.material||'Material unknown')} · ${e(c.fit||'Fit unknown')}</p><p>${e(c.claim||'No sourced collection claim')}</p><p class="stencil-note">Availability unknown. Complaint resolution and material safety unverified.</p>${c.url&&/^https:\/\//.test(c.url)?`<a class="text-link" href="${e(c.url)}" target="_blank" rel="noopener noreferrer">Official product source</a>`:''}</div></article>`;}).join('')}</div></section>`:''}${live?activitySummary()+pendingReplayAction():''}${live?.resolution?`<section class="resolution-card"><h3>Replay choice recorded.</h3><p>App-owned replay_selection · ${e(live.resolution.selectedProductRef)}. Historical status: Refund Completed. No merchant action executed.</p></section>`:''}${voiceStage()}</section><aside class="context-column"><div class="context-intro"><span class="eyebrow">Historical evidence</span><p>Past facts and current feedback remain separate.</p></div><section class="card context-card"><h3>${e(title)}</h3>${detail('Source status','Refund Completed')}${detail('Size',historical?.size||replay?.sourceItem?.size||'Unknown')}${detail('Past return reason','Unknown unless explicitly sourced')}${detail('Merchant eligibility','Unknown / not evaluated')}${detail('Outcome','App-owned replay only')}</section><section class="card context-card"><h3>Current feedback</h3><p>${e(live?.feedback||replay?.currentFeedback||'Awaiting current customer statement')}</p></section><section class="card context-card"><h3>Canonical policy</h3><p class="policy-caption">${e(policyVersion())}</p><button class="text-link" data-nav="policy">Inspect configured policy</button></section>${live?toolsCard():''}</aside></div>`;
}
function pendingReplayAction(){return state.session?.pendingAction?`<div class="pending-action-bar"><p>Replay interest proposed. No merchant action.</p>${button('Review replay choice','review-pending','primary small','',busyAttrs())}</div>`:'';}
function voiceStage() {
  const live=modeLive();
  const label=state.voiceStatus==='speaking'?'Agent speaking':state.voiceStatus==='listening'?(state.voiceMuted?'Microphone muted':'Listening'):live?humanize(state.voiceStatus):completed()?'Resolution recorded':'Text demo · no live audio';
  return `<div class="voice-stage"><div class="voice-identity">${icon(live?'voice':'shield')}<div><strong>${e(label)}</strong><small>${live?'Provider audio state':'Deterministic app replies · simulated commerce'}</small></div></div><div class="voice-controls">${live?button(state.voiceMuted?'Unmute':'Mute mic','mute-voice','secondary small','mic')+button('End call','stop-voice','secondary small','pause'):!state.session?button('Start demo','start','lime','play',busyAttrs()):!completed()?button('Voice mode','connection','secondary small','mic'):''}</div></div>`;
}
function conversation() {
  const saved=state.session?.messages||[];
  const messages=[...saved,...state.voiceTranscript.filter(m=>!saved.some(s=>s.itemId && s.itemId===m.itemId && s.role===m.role))];
  if (!messages.length) return `<div class="conversation-empty"><span class="eyebrow">Start with understanding</span><p>Choose a demo customer, then tell the assistant what didn’t work with their order.</p></div>`;
  return `<div class="transcript" role="log" aria-live="polite" aria-label="Conversation transcript">${messages.map((m,i)=>{
    const isCustomer=['user','customer'].includes(m.role);const text=m.text||m.content||'';const at=m.at||m.createdAt;const time=at?new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
    return `<article class="message ${isCustomer?'customer':'assistant'}"><div class="message-avatar">${isCustomer?e(initials(customer().name)):icon('spark')}</div><div class="message-content"><div class="message-label">${isCustomer?e(customer().name?.split(' ')[0]||'Customer'):'Return assistant'}${time?`<time>${e(time)}</time>`:''}${m.source==='local-guided-demo'?' · app text':''}${m.final===false?' · listening':''}</div><p class="message-text">${e(text)}</p></div></article>`;
  }).join('')}${state.busy?'<div class="message"><div class="message-avatar">'+icon('spark')+'</div><div class="loading-indicator" aria-label="Checking the details"><i></i><i></i><i></i></div></div>':''}</div>`;
}
function activitySummary() {const tools=toolEvents();return tools.length?`<div class="activity-summary"><span>${icon('shield','small-icon')} ${tools.length} tool events</span><div>${tools.slice(-2).map((t,i)=>`<button data-tool="${tools.length-2+i<0?0:tools.length-2+i}" class="activity-chip ${t.status==='blocked'?'blocked':''}">${icon(t.status==='blocked'?'shield':'check','small-icon')}${e(t.name)}</button>`).join('')}</div><button class="icon-btn" data-action="all-tools" aria-label="Inspect all tool events">${icon('arrowUp')}</button></div>`:'';}
function suggestions() {
  if (completed()||modeLive()) return '';
  const meta=state.selectedScenario?{short:state.selectedScenario.name,prompt:state.selectedScenario.prompt}:caseMeta[customer().customerId]||caseMeta['CUST-001'];
  let prompts = !state.session||!diagnosis() ? [[meta.short,meta.prompt],['Refund only','I do not want anything else. I only want a refund.']] : diagnosis().requiresClarification ? [['Roomier cut','I want a roomier cut. The shoulders are too tight and the fabric is too heavy.'],['Refund only','No thanks. I only want my refund.']] : diagnosis().recommendationAllowed ? [['Prefer dark colors','I prefer dark colors and oversized fits.'],['Stay under ₹900','I would like to stay under ₹900.'],['Just a refund','No thanks. I only want my refund.']] : [];
  if (state.session?.suggestions?.length) prompts=state.session.suggestions.map(s=>typeof s==='string'?[s,s]:[s.label,s.text]);
  return prompts.length?`<div class="suggestions" aria-label="Suggested demo responses">${prompts.map(([label,text])=>`<button class="suggestion" data-send="${e(text)}" ${busyAttrs()}>${e(label)} ${icon('arrow','small-icon')}</button>`).join('')}</div>`:'';
}
function pendingActionBar() {const p=state.session?.pendingAction;return p?`<div class="pending-action-bar"><p>A ${e(p.action==='escalate'?'support case':p.action)} is proposed. Nothing has been executed.</p>${button('Review proposal','review-pending','primary small','',busyAttrs())}</div>`:'';}
function composer() {return `<form class="composer" id="message-form"><div class="composer-box"><input id="message-input" name="message" autocomplete="off" maxlength="2000" aria-label="Your message" placeholder="${completed()?'This session is complete. Start another story.':'Describe what didn’t work…'}" ${state.busy||completed()||modeLive()?'disabled':''}><button type="submit" class="icon-btn" aria-label="Send message" ${state.busy||completed()||modeLive()?'disabled':''}>${icon('arrow')}</button></div><div class="composer-hint"><span>${modeLive()?'Voice session active':state.busy?'Running local tools…':'Enter to send · demo replies use deterministic logic'}</span><span>Confirmation before every action</span></div></form>`;}
function progressStrip() {const step=completed()?4:state.session?.pendingAction?2:diagnosis()?2:state.session?1:0;return `<div class="path-strip" aria-label="Resolution progress">${['Identify','Understand','Resolve','Learn'].map((name,i)=>`<span class="path-step ${i<step?'done':i===step?'current':''}"><b>${i<step?icon('check'):i+1}</b>${name}</span>`).join('')}</div>`;}
function customerCard() {
  const c=customer(), b=brain();
  const explicit=b?.explicitPreferences?.find(p=>p.sentiment==='positive');
  const inferred=b?.inferredPreferences?.find(p=>p.sentiment==='positive'&&p.attribute==='fit');
  const pref=explicit||inferred;
  let note=b?.coldStart?'No past preference history. We’ll use what this customer tells us today.':pref?`${pref.sentiment==='negative'?'Avoids':'Prefers'} ${pref.value} ${pref.attribute==='fit'?'fit':''}.`:'Purchase and return history will be checked when the session starts.';
  return `<section class="card context-card"><div class="card-heading"><h3>Customer context</h3><button class="icon-btn" data-action="customer-detail" aria-label="View customer history and preferences">${icon('arrowUp')}</button></div><div class="customer-row"><span class="customer-avatar">${e(initials(c.name))}</span><div><strong>${e(c.name)}</strong><small>${e(c.city)} · ${e(c.customerId)}</small></div></div><div class="mini-stats"><div><strong>${c.orders?.length||0}</strong><span>Orders</span></div><div><strong>${c.returns?.length||0}</strong><span>Past returns</span></div><div><strong>${b?b.keptProductIds?.length||0:'—'}</strong><span>Kept signals</span></div></div><div class="preference-note">${icon('spark')}<div>${e(note)}<em>${pref?`${pref.source==='explicit_statement'?'Explicit statement':'Tentative history inference'} · inspect evidence`:b?.coldStart?'Cold start · no invented preferences':'Synthetic customer history'}</em></div></div></section>`;
}
function orderCard() {
  const o=order(), it=item(), p=source(), eligibility=state.session?.eligibility;
  return `<section class="card context-card"><div class="card-heading"><h3>The item being returned</h3>${icon('box')}</div><div class="product-mini">${productArt(p,'original')}<div><h4>${e(p.name||'Select an order')}</h4><small>${e(it.size||'')} · ${e(it.color||'')}</small><b>${money(it.priceInr??p.priceInr)}</b></div></div><div class="detail-list">${detail('Order',o.orderId||'—')}${detail('Delivered',o.deliveredDaysAgo!=null?`${o.deliveredDaysAgo} days ago`:'Not delivered')}${detail('Fabric',p.gsm?`${p.gsm} GSM · ${p.material}`:p.material||'Not listed')}${detail('Fit',humanize(p.fit)||'Not published')}${p.garmentMeasurements?.[it.size]?detail('Garment chest / length',`${measure(p.garmentMeasurements[it.size].chestIn)} / ${measure(p.garmentMeasurements[it.size].lengthIn)}`):''}</div>${provenance(p)}${o.items?.length>1?button('Change item','items','quiet small','refresh','style="margin-top:12px"'):''}<div class="eligibility">${icon(eligibility?eligibility.eligible?'shield':'alert':'clock')}<div><strong>${eligibility?eligibility.eligible?'Within the return window':humanize(eligibility.reasonCode):'Eligibility checked at session start'}</strong><small>${eligibility?`${eligibility.windowDays}-day window · ${e(eligibility.policyCitation?.version||policyVersion())}`:'One canonical policy. No guessed exceptions.'}</small></div></div></section>`;
}
function diagnosisCard() {
  const d=diagnosis();if(!d)return '';
  return `<section class="card context-card diagnosis-card"><div class="card-heading"><h3>What actually went wrong</h3>${icon('filter')}</div><div class="diagnosis-label">${e(humanize(d.primaryReason))}</div>${d.secondaryReasons?.length?`<div class="diagnosis-secondary">${d.secondaryReasons.map(x=>badge(humanize(x),'neutral')).join(' ')}</div>`:''}${d.evidence?.[0]?.quote?`<p class="diagnosis-quote">“${e(d.evidence[0].quote)}”</p>`:''}${d.likedAttributes?.length?`<div class="diagnosis-keeps">${icon('check','small-icon')}Preserve ${e(d.likedAttributes.map(humanize).join(', ').toLowerCase())}</div>`:''}<div class="diagnosis-gate ${recAllowed()?'allowed':'held'}">${icon(recAllowed()?'check':'shield','small-icon')}<span>${recAllowed()?'Recommendations allowed':e(state.session?.recommendationGate||d.gateReason||'Clarification needed before recommending')}</span></div><button class="text-link" data-action="diagnosis-detail">Inspect diagnosis ${icon('arrowUp','small-icon')}</button></section>`;
}
function toolsCard() {
  const tools=toolEvents();
  return `<section class="card context-card evidence-card"><div class="card-heading"><h3>Grounded in evidence</h3>${badge(`${tools.length} tools`,'green')}</div>${tools.length?`<div class="tool-list">${tools.slice(-6).map((t,index)=>`<div class="tool-entry"><button class="tool-button" data-tool="${tools.length>6?tools.length-6+index:index}"><span class="tool-check ${t.status==='blocked'?'blocked':''}">${icon(['error','blocked'].includes(t.status)?'shield':['discarded','running','started'].includes(t.status)?'clock':'check')}</span><span><strong>${e(t.name)}</strong><small>${e(t.detail||t.summary||'Inspect inputs and output')}</small></span>${icon('chevron')}</button></div>`).join('')}</div>${tools.length>6?`<button class="text-link" data-action="all-tools">View all ${tools.length} tool calls ${icon('arrow','small-icon')}</button>`:''}`:'<p class="empty-evidence">Tool calls will appear here as the assistant checks policy, context, and catalog facts.</p>'}</section>`;
}
function alternateSection() {
  const opts=candidates();if(!opts.length||completed()||!recAllowed())return '';
  const original=source(), size=item().size;
  return `<section class="fit-stencil" aria-label="Catalog comparison"><div class="section-title"><div><span class="eyebrow">Catalog returned / ${opts.length} alternatives</span><h2>Keep what fits. Change what doesn’t.</h2></div>${badge('Stock unverified','neutral')}</div><div class="stencil-constraints">${diagnosis()?.likedAttributes?.length?`<span><b>KEEP</b> ${e(diagnosis().likedAttributes.map(humanize).join(' · '))}</span>`:''}<span><b>CHANGE</b> ${e(humanize(diagnosis()?.primaryReason))}</span></div><div class="alternates-grid"><article class="alternate-card returned-card">${productArt(original,'returned')}<div class="alternate-body"><span class="eyebrow">Returned item</span><h3>${e(original.name)}</h3><p>${e(size)} · ${original.gsm??'Unknown'} GSM · ${money(original.priceInr)}</p>${provenance(original,true)}</div></article>${opts.slice(0,3).map((candidate,i)=>{
    const p=candidate.product||candidate;const targetSize=candidate.recommendedSize||size;
    return `<article class="alternate-card">${productArt(p,'candidate'+i)}<div class="alternate-body"><span class="eyebrow">Alternative ${i+1}</span><h3>${e(p.name)}</h3><p>${e(targetSize)} · ${p.gsm??'Unknown'} GSM · ${money(p.priceInr)}</p><div class="alternate-tags">${(candidate.why||candidate.reasons||[]).slice(0,2).map(w=>`<span>${e(w)}</span>`).join('')}</div>${provenance(p,true)}<button class="btn secondary" data-compare="${e(p.id)}">Inspect comparison ${icon('arrow')}</button></div></article>`;
  }).join('')}</div><p class="stencil-note">Published garment measurements, not body measurements. Comfort is not guaranteed. Live stock is unknown.</p></section>`;
}
function resolutionActions() {
  if (!state.session||completed()||!diagnosis())return '';
  const allowed=state.session.eligibility?.allowedActions||[];
  return `<div class="resolution-options"><div><strong>${diagnosis()?.refundOnly?'Let’s continue with your refund.':'You choose what happens next.'}</strong><span>${diagnosis()?.recommendationAllowed?'A refund is always an option when the policy allows it.':'No pressure to choose another product.'}</span></div><div>${allowed.includes('refund')?button('Request refund','refund','secondary small','arrow',busyAttrs()):''}${canChangeSize()?button('Change size','change-size','secondary small','refresh',busyAttrs()):''}${allowed.includes('replacement')?button('Replace this item','replacement','primary small','box',busyAttrs()):''}${button('Ask for support','escalate','quiet small','users',busyAttrs())}</div></div>`;
}
function canChangeSize() {const d=diagnosis();return Boolean(d&&!d.requiresClarification&&d.labels.length&&d.labels.every(l=>l.startsWith('fit_'))&&!d.likedAttributes?.includes('length')&&state.session?.eligibility?.allowedActions?.includes('exchange_same_product'));}
function resolutionCard() {
  const r=state.session?.resolution;if(!r)return '';
  const title=humanize(r.outcome||r.action||r.kind||'Resolution recorded');
  return `<section class="resolution-card"><div class="resolution-top"><div class="resolution-icon">${icon('check')}</div><div><h3>${e(title)}</h3><p>${e(r.message||r.summary||'Your simulated resolution and product insight have been saved.')}</p></div></div><div class="resolution-footer"><span>Demo action recorded<br>Follow-through is not yet measured</span>${button('See what the brand learned','show-intelligence','primary small','arrow')}</div></section>`;
}
function insightRows() {
  const d=state.insights;if(!d)return [];
  const rows=Array.isArray(d)?d:d.insights||d.records||[];
  return rows.filter(r=>!r.kind||r.kind==='insight');
}
function sessionRows() {return state.insights?.sessions||[];}
function records() {return state.insights?.records||[];}
function signalReason(r) {return r.primaryReason||r.diagnosis?.primaryReason||r.return?.primary_reason||r.reasonLabel||'other.unclear';}
function signalProduct(r) {return r.productId||r.sourceProductId||r.product_id||r.sourceProduct?.id;}
function signalOutcome(r) {return r.outcome||r.resolution?.outcome||r.resolution||'Not resolved';}
function getReasonCounts() {
  const counts=new Map();for(const r of insightRows()){const label=signalReason(r);counts.set(label,(counts.get(label)||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]);
}
function metric(label,value,detailText,ico,featured=false) {return `<article class="metric-card ${featured?'featured':''}"><div class="metric-top">${e(label)}${icon(ico)}</div><div class="metric-value" ${String(value).length>9?'style="font-size:22px;line-height:1.6"':''}>${e(value)}</div><p class="metric-detail">${e(detailText)}</p></article>`;}
function intelligenceView() {
  const rows=insightRows(), sessions=sessionRows(), counts=getReasonCounts(), total=rows.length;
  const exchanges=rows.filter(r=>String(signalOutcome(r)).toLowerCase().includes('exchange')).length;
  const refundCount=rows.filter(r=>String(signalOutcome(r)).toLowerCase().includes('refund')).length;
  const sessionCount=state.insights?.metrics?.returnSessions ?? state.insights?.metrics?.sessions ?? state.insights?.summary?.sessions ?? sessions.length;
  const latest=rows.at(-1);
  return `${heading('Product & merchandising','The return is just the beginning.','See what customers said, what changed, and what your products can learn.',button('<span class="button-label">Refresh evidence</span>','refresh-insights','secondary','refresh',busyAttrs()))}<div class="metric-grid">${metric('Local return sessions',state.insights?sessionCount:'—','Synthetic sessions in this demo','voice',true)}${metric('Exchange requests',state.insights?exchanges:'—','Accepted in the local simulation','refresh')}${metric('Structured product signals',state.insights?total:'—','Linked to a customer and source item','filter')}${metric('Replacement keep rate','Not measured','No delivery or follow-up data yet','clock')}</div><div class="intelligence-grid"><section class="card panel"><div class="panel-header"><div><h2>Beyond “didn’t like it”</h2><p>Primary return causes from completed local sessions</p></div>${badge(`${total} signals`,'green')}</div>${total?`<div class="reason-list">${counts.slice(0,6).map(([label,count])=>`<div class="reason-row"><div class="reason-top"><strong>${e(humanize(label))}</strong><span>${count} ${count===1?'case':'cases'} · ${Math.round(count/total*100)}%</span></div><div class="reason-track"><i style="width:${count/total*100}%"></i></div></div>`).join('')}</div><div class="outcome-key"><span><i></i>${exchanges} exchange${exchanges===1?'':'s'}</span><span><i></i>${refundCount} refund${refundCount===1?'':'s'}</span><span><i></i>${total-exchanges-refundCount} other resolution${total-exchanges-refundCount===1?'':'s'}</span></div><p class="insight-summary">These are observations from synthetic demo conversations. A small sample is a review signal, not proof of a product defect or business uplift.</p>`:emptyPanel('Every insight starts with a conversation.','Complete a demo return to see real local records populate this view.','Try a customer story','back-workspace')}</section><section class="card panel"><div class="panel-header"><div><h2>One conversation. A useful signal.</h2><p>Trace every learning back to its source</p></div>${icon('link')}</div>${latest?learningLoop(latest):`<div class="loop-diagram"><div class="loop-item"><span>1</span><h3>Understand the failure</h3><p>Capture the customer’s words and separate fit, material, and other causes.</p></div><div class="loop-item"><span>2</span><h3>Choose a legitimate resolution</h3><p>Use catalog and policy evidence. Respect a request for a refund.</p></div><div class="loop-item"><span>3</span><h3>Learn at the SKU level</h3><p>Save the reason, preference evidence, and outcome together.</p></div></div>`}</section></div><div class="section-title"><div><h2>Conversation evidence</h2><p>Every decision has a customer, a reason, and a tool record</p></div>${badge('Synthetic data only','neutral')}</div><section class="card">${total?`<div class="sessions-table-wrap"><table class="sessions-table"><thead><tr><th>Customer / session</th><th>Product</th><th>Root cause</th><th>Resolution</th><th></th></tr></thead><tbody>${rows.slice().reverse().map((r,i)=>{
    const c=customers().find(c=>c.customerId===r.customerId);const p=productById(signalProduct(r));
    return `<tr data-insight="${rows.length-1-i}" tabindex="0" role="button" aria-label="Inspect ${e(c?.name||'demo session')} evidence"><td><strong>${e(c?.name||r.customerName||r.customerId||'Demo customer')}</strong><small>${e(r.sessionId||r.recordId||'')}</small></td><td><strong>${e(p?.name||r.productName||signalProduct(r)||'Unknown item')}</strong><small>${e(signalProduct(r)||'')}</small></td><td>${e(humanize(signalReason(r)))}</td><td>${badge(humanize(signalOutcome(r)),String(signalOutcome(r)).includes('exchange')?'green':'neutral')}</td><td>${icon('arrowUp','small-icon')}</td></tr>`;
  }).join('')}</tbody></table></div>`:`<div style="padding:18px 24px">${emptyPanel('No completed conversations yet.','A confirmed demo resolution creates a structured insight automatically.','','')}</div>`}</section>${skuSection()}`;
}
function emptyPanel(title,description,cta,action) {return `<div class="insights-empty"><span class="empty-symbol">${icon('chart')}</span><h3>${title}</h3><p>${description}</p>${cta?button(cta,action,'primary small','arrow'):''}</div>`;}
function learningLoop(r) {
  const p=productById(signalProduct(r));const recommended=productById(r.chosenProductId||r.recommendedProductId||r.replacementProductId||r.recommended_product);const quote=r.reasonNotes||r.customerQuote||r.quote||r.evidence?.[0]?.quote||r.diagnosis?.evidence?.[0]?.quote;
  const liked=r.likedAttributes||r.diagnosis?.likedAttributes||[];
  return `<div class="loop-diagram"><div class="loop-item"><span>1</span><h3>${e(humanize(signalReason(r)))}</h3><p>${quote?`“${e(quote)}”`:`${e(p?.name||r.productName||'The returned product')} did not meet the customer’s stated need.`}</p><span class="mini-label">${e(p?.id||signalProduct(r)||'Item-level evidence')}</span></div><div class="loop-item"><span>2</span><h3>${e(humanize(signalOutcome(r)))}</h3><p>${recommended?e(recommended.name):'Recorded only after explicit customer confirmation.'}</p><span class="mini-label">Simulated action · real local record</span></div><div class="loop-item"><span>3</span><h3>${liked.length?`Preserve ${e(liked.join(' + '))}`:'A product signal worth reviewing'}</h3><p>Review ${e(humanize(signalReason(r)).toLowerCase())} feedback for this SKU. Further customer outcomes are needed before drawing a trend.</p><span class="mini-label">Observation, not a causal claim</span></div></div>`;
}
function skuSection() {
  const rows=insightRows();if(!rows.length)return '';
  const groups=new Map();rows.forEach(r=>{const id=signalProduct(r);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);});
  return `<div class="section-title"><div><h2>Product signals</h2><p>Specific feedback, attached to the item that generated it</p></div></div><div class="sku-grid">${[...groups].map(([id,list])=>{const p=productById(id);const reasons=[...new Set(list.map(signalReason))];return `<button class="sku-card" data-sku="${e(id)}">${productArt(p||{},'sku'+id)}<div><span class="eyebrow">${e(id)}</span><h3>${e(p?.name||'Catalog item')}</h3><p>${e(reasons.map(humanize).join(' · '))}</p>${badge(`${list.length} local ${list.length===1?'signal':'signals'}`,'green')}</div>${icon('arrowUp')}</button>`;}).join('')}</div>`;
}
function evaluationCases() {const d=state.evaluations;return d?.cases||d?.results||d?.tests||[];}
function evaluationView() {
  const data=state.evaluations, cases=evaluationCases();
  const isPass=t=>t.passed===true||['passed','pass'].includes(String(t.status).toLowerCase());
  const isFail=t=>t.passed===false||['failed','fail'].includes(String(t.status).toLowerCase());
  const passed=cases.filter(isPass).length, failed=cases.filter(isFail).length;
  const total=data?.summary?.total??data?.total??cases.length;
  const verifiedPassed=data?.summary?.passed??data?.passed??passed;
  const reportReady=Boolean(data)&&(total>0||cases.length>0);
  return `${heading('Reliability workspace','Trust the behavior. Inspect the proof.','Policy, recommendations, and transactional safeguards need more than a good demo.',button('<span class="button-label">Refresh report</span>','refresh-evals','secondary','refresh',busyAttrs()))}<div class="eval-status"><div><span class="eyebrow" style="color:#a1b995">Deterministic domain scenarios</span><h2 style="margin-top:10px">${reportReady?failed?'Some checks need attention.':'Grounded decisions, checked in code.':'Evaluation results are not available yet.'}</h2><p>${reportReady?'Recorded automated results from the report’s timestamp. These do not measure model responses, live speech, latency, or customer outcomes.':'The report will appear when the backend has generated and exposed its evaluation results.'}</p></div><div class="eval-status-number">${reportReady?verifiedPassed:'—'}<small>${reportReady?` / ${total}`:''}</small></div></div><div class="evaluation-grid"><section class="card panel"><div class="panel-header"><div><h2>Scenario results</h2><p>${reportReady?`Report completed ${e(data.completedAt||'at an unspecified time')}`:'No unrun checks are labeled as passing'}</p></div>${badge(reportReady?`${total} checks`:'Awaiting report',reportReady?'green':'neutral')}</div>${cases.length?`<div class="eval-cases">${cases.map(t=>`<article class="eval-case ${isFail(t)?'failed':''}"><span class="eval-case-icon">${icon(isPass(t)?'check':isFail(t)?'alert':'clock')}</span><div><h3>${e(t.name||t.title||t.id||'Scenario')}</h3><p>${e(t.description||t.detail||t.category||t.error||t.expected||'Deterministic assertion against application behavior.')}</p></div>${badge(isPass(t)?'PASS':isFail(t)?'FAIL':'NOT RUN',isPass(t)?'green':isFail(t)?'red':'neutral')}</article>`).join('')}</div>`:emptyPanel('Waiting for a test report.','The app will never substitute a mock pass rate for actual evaluation results.','','')}</section><aside><section class="card panel"><div class="panel-header"><div><h2>What the app protects</h2><p>Important boundaries in every conversation</p></div>${icon('shield')}</div>${[
    ['book','One policy wins','Eligibility comes from the canonical, versioned demo policy. Conflicting public pages do not decide transactions.'],
    ['grid','Facts come from the catalog','Prices, fabric, fit, and stock must exist in structured data. Unknown attributes stay unknown.'],
    ['user','The customer decides','Refund-only requests stop selling. Defects and sensitive complaints take a support-first path.'],
    ['check','No action without confirmation','A proposal is reviewed before execution. A changed request invalidates a stale choice.'],
  ].map(([ico,title,text])=>`<div class="guardrail">${icon(ico)}<div><h3>${title}</h3><p>${text}</p></div></div>`).join('')}</section><section class="card panel" style="margin-top:18px"><div class="panel-header"><div><h2>Still needs live validation</h2><p>Kept separate from engine checks</p></div></div><div class="detail-list">${detail('Live model calls',String(data?.scope?.actualModelCalls??0)+' · NOT RUN')}${detail('Live audio sessions',String(data?.scope?.actualAudioSessions??0)+' · NOT RUN')}${detail('Spoken interruption','Not measured here')}${detail('End-to-end latency','Not measured here')}${detail('Speech recognition quality','Not measured here')}${detail('Customer preference','No study run')}${detail('Replacement keep rate','No follow-up data')}</div></section></aside></div>`;
}
function policyView() {
  const p=policy(),r=p.rules||{};
  return `${heading('Canonical knowledge','One policy. Every decision.','A pinned demo snapshot is the source of truth for transactional decisions.',badge(p.version||'Demo policy','green'))}<div class="policy-banner">${icon('shield')}<div><h3>Configured demo policy, not a claim about today’s live store policy</h3><p>Public policy sources can conflict. This prototype uses one explicitly versioned snapshot. The assistant cannot choose a different web page to approve a return.</p></div></div><div class="policy-grid">${[
    ['clock',`${r.returnWindowDays??'—'} days from delivery`,'Returns and exchanges must be within the configured window. The engine checks each order item.'],
    ['tag','Condition requirements',`${r.requiresTags?'Original tags are required. ':''}${r.unwornUnwashedRequired?'Standard returns must be unworn and unwashed.':''} Defects follow the quality path.`],
    ['refresh','Genuine exchanges',`Different-product exchanges are ${r.exchangeAllowsDifferentProduct?'allowed':'not allowed'}. The selected size must be in stock before an exchange can be created.`],
    ['box','Defects and fulfillment errors','Manufacturing defects and wrong-item cases route to replacement, refund, or support. A quality signal is recorded.'],
    ['book','Refund method',`Approved demo refunds go to the original payment method within ${r.refundProcessingDays??'—'} working days of pickup verification. Shipping charges are not refundable.`],
    ['shield','Final-sale exclusions',`Excluded categories: ${(r.finalSaleCategories||[]).join(', ')}. The item’s catalog eligibility is also checked.`],
  ].map(([ico,title,text])=>`<article class="policy-rule">${icon(ico)}<div><h3>${e(title)}</h3><p>${e(text)}</p></div></article>`).join('')}</div><section class="card panel" style="margin-top:22px"><div class="panel-header"><div><h2>Traceable by design</h2><p>Each eligibility decision includes this citation</p></div>${icon('link')}</div><div class="detail-list">${detail('Policy ID',p.policyId||'—')}${detail('Version',p.version||'—')}${detail('Market',p.market||'—')}${detail('Effective date',p.effectiveDate||'—')}${detail('Source',p.source||'—')}</div><div class="source-links">${(p.sourceUrls||[]).filter(url=>/^https:\/\//.test(url)).map((url,i)=>`<a href="${e(url)}" target="_blank" rel="noopener noreferrer">Official reference ${i+1} ${icon('arrowUp','small-icon')}</a>`).join('')}</div></section>`;
}
function openDialog(type, data) {
  lastFocus = document.activeElement;
  state.dialog={type,data};renderDialog();
  requestAnimationFrame(()=>{const d=$('.dialog');(d?.querySelector('button,input,select,[tabindex="0"]')||d)?.focus();});
}
function renderDialog() {
  const d=state.dialog;if(!d){$('#overlay-root').innerHTML='';return;}
  const focusedId=document.activeElement?.id;
  let title='',eyebrow='',subtitle='',body='',actions='',wide=false;
  if(d.type==='compare'&&(!recAllowed()||completed()||!candidates().some(c=>(c.product?.id||c.productId||c.id)===(d.data.product?.id||d.data.productId||d.data.id)))){state.dialog=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';return;}
  if (d.type==='replay-sources') {
    eyebrow='Historical source lookup';title='Choose an already-refunded item.';subtitle='Historical status stays unchanged. This replay records current feedback only.';
    body=`<div class="scenario-list">${(state.replaySources?.items||[]).map((x,i)=>`<button class="scenario-option" data-replay-source="${i}" ${x.canReplay?'':'disabled'}><span><strong>${e(x.name||'Public source match unavailable')}</strong><small>${e(x.status||'Status unknown')} · ${e(x.size||'Size unknown')} · ordered ${e(x.orderedOn||'date unknown')}</small><small>Past reason: ${e(x.pastReturnReason||'Unknown')} · kept: ${x.keptOutcome==null?'Unknown':e(x.keptOutcome)}</small></span>${icon('arrow')}</button>`).join('')}</div><p class="dialog-note">${e(state.replaySources?.note||'No merchant integration. No inferred return reason or kept outcome.')}</p>`;
  } else if (d.type==='scenarios') {
    eyebrow='Choose a story';title='Different people. Different resolutions.';subtitle=`${state.bootstrap.scenarios?.length||0} scenarios across five synthetic customers.`;
    const scenarios=state.bootstrap.scenarios||customers().map(c=>({id:c.customerId,customerId:c.customerId,name:caseMeta[c.customerId]?.name,description:caseMeta[c.customerId]?.sub,prompt:caseMeta[c.customerId]?.prompt}));
    body=`<div class="scenario-list">${scenarios.map((s,i)=>{const c=customers().find(c=>c.customerId===s.customerId);return `<button class="scenario-option ${state.customerId===s.customerId?'selected':''}" data-scenario="${i}"><span class="avatar">${e(initials(c?.name))}</span><span><strong>${e(s.name)}</strong><small>${e(c?.name)} · ${e(s.description)}</small></span>${icon('arrow')}</button>`;}).join('')}</div><p class="dialog-note">Choosing a story starts a fresh demo. Earlier transcript, preference, and insight records are retained. No real customer account is accessed.</p>`;
  } else if (d.type==='connection') {
    eyebrow='Connected intelligence';title='The same facts, two ways to talk.';subtitle='Canonical policy, dated public product facts, and explicitly simulated commerce data.';
    const voice=state.bootstrap.capabilities?.voice||{status:'unconfigured'};const ready=voice.status==='ready';
    const storage=state.bootstrap.capabilities?.storage;const durable=storage?.kind==='supabase';
    body=`<div class="connection-card">${icon('grid')}<div><strong>Interactive text demo</strong><small>Deterministic replies and actual application tool execution</small></div>${badge('Available','green')}</div><div class="connection-card">${icon('voice')}<div><strong>AssemblyAI voice</strong><small>${e(voice.reason||(ready?'Provider connection is configured.':'A live provider session is not configured.'))}</small></div>${badge(ready?'Ready':'Not connected',ready?'green':'neutral')}</div><div class="consent-notice"><h3>Before you speak</h3><p>This is an independent prototype, not affiliated with The Souled Store. Customer and order histories, operational inventory, and all transactions are fictional.</p><p>Live speech is processed by AssemblyAI. Use fictional demo inputs only. Do not share personal, medical, payment, or account details.</p><p>${durable?'App transcripts, extracted preferences, and product insights are retained in Supabase for this prototype, scoped to this signed browser session.':'App transcripts, extracted preferences, and product insights are retained as local demo records. The hosted version stores them in Supabase, scoped to a signed browser session.'} Starting a new demo does not delete earlier records. This app does not promise deletion of provider logs.</p></div>${ready?`<label class="condition-checkbox"><input type="checkbox" id="voice-consent"><span>I understand how this prototype handles speech and retained records. I will continue with fictional demo data only.</span></label>`:'<p class="dialog-note">The text demo does not transcribe speech, generate audio, or demonstrate live interruption. Live voice remains unavailable.</p>'}${ready&&!state.session&&!state.replayReceipt?'<p class="dialog-note">Start a demo session first to choose the customer and order for your call.</p>':''}`;
    actions=ready?button('Close','close-dialog','secondary')+button('Continue with fictional demo data','start-voice','primary','mic','disabled'):button('Continue in text','close-dialog','primary','arrow');
  } else if (d.type==='compare') {
    const candidate=d.data,p=candidate.product||candidate,original=source(),sourceSize=item().size;
    const recommendedSize=candidate.recommendedSize||sourceSize;
    const size=d.selectedSize||recommendedSize;
    const measuredFit=Boolean(p.catalogSource&&diagnosis()?.labels?.some(l=>['fit_too_small','fit_too_large'].includes(l)));
    state.activeProduct=p;
    eyebrow='Grounded comparison';title='Fit stencil. The evidence underneath.';subtitle='Public snapshot facts are sourced below. Operational stock and transactions remain simulated.';wide=true;
    body=`<div class="comparison">${[[original,`Returned item · ${sourceSize}`],[p,`Recommended variant · ${size}`]].map(([prod,label],i)=>`<div class="comparison-product">${productArt(prod,'compare'+i)}<div class="comparison-name"><small>${e(label)}</small><h3>${e(prod.name)}</h3><strong>${money(prod.priceInr)}</strong>${provenance(prod)}</div></div>`).join('')}</div>${comparisonMetrics(original,sourceSize,p,size)}<div class="tradeoff-note">${icon('info','small-icon')}<span>Garment dimensions are not body measurements. ${measurementCaveat(original,sourceSize,p,size)} Lower GSM does not guarantee cooling or comfort.</span></div><div class="comparison-why"><strong>Why this variant ranked here</strong>${(candidate.why||[]).map(w=>`<div>✓ ${e(w)}</div>`).join('')}</div>${candidate.tradeoffs?.length?`<div class="tradeoff-list"><strong>Review these trade-offs</strong>${candidate.tradeoffs.map(t=>`<p>${e(t)}</p>`).join('')}</div>`:''}${state.session?.excluded?.length?`<button class="text-link" data-action="excluded" style="margin-top:13px">See ${state.session.excluded.length} excluded alternatives ${icon('arrowUp','small-icon')}</button>`:''}<div class="selection-controls"><div class="field"><label for="replacement-size">${measuredFit?'Size supported by this comparison':'Choose size'}</label><select id="replacement-size">${(p.sizes||[]).map(s=>`<option value="${e(s)}" ${s===size?'selected':''} ${(p.stock?.[s]||0)<=0||(measuredFit&&s!==recommendedSize)?'disabled':''}>${e(s)} ${(p.stock?.[s]||0)<=0?'· unavailable in demo':measuredFit&&s!==recommendedSize?'· clarify fit first':''}</option>`).join('')}</select></div><div class="field"><label for="replacement-color">${p.colors?.[0]==='listed product variant'?'Listed variant · color not published':'Choose listed color'}</label><select id="replacement-color">${(p.colors||[]).map(c=>`<option value="${e(c)}" ${c===d.selectedColor?'selected':''}>${e(humanize(c))}</option>`).join('')}</select></div></div><p class="dialog-note">${p.stock?.[size]||0} simulated units in ${e(size)}, pooled across listed colors. This is not live store availability. ${measuredFit?'The current measured fit comparison supports '+e(recommendedSize)+'. Ask the assistant to reassess a different size.':''}</p>`;
    actions=button('Keep exploring','close-dialog','secondary')+button('Review exchange','review-exchange','primary','arrow',busyAttrs());
  } else if (d.type==='variant') {
    const p=source();state.activeProduct=p;eyebrow='Customer-selected variant';title='Same product. Your choice of size.';subtitle='This changes the size or color only. The fabric, cut, and garment design stay the same.';
    body=`<div class="product-mini">${productArt(p,'variant')}<div><h4>${e(p.name)}</h4><small>Current: ${e(item().size)} · ${e(item().color)}</small><b>${money(p.priceInr)}</b></div></div><div class="selection-controls"><div class="field"><label for="replacement-size">Choose a different size</label><select id="replacement-size">${p.sizes.map(size=>`<option value="${e(size)}" ${size===item().size?'selected':''} ${(p.stock[size]||0)<=0?'disabled':''}>${e(size)} · ${p.stock[size]||0} in stock</option>`).join('')}</select></div><div class="field"><label for="replacement-color">Choose color</label><select id="replacement-color">${p.colors.map(color=>`<option value="${e(color)}" ${color===item().color?'selected':''}>${e(humanize(color))}</option>`).join('')}</select></div></div><p class="dialog-note">Published garment measurements, when available, do not guarantee fit or comfort. Review the chosen variant before confirming. Stock is pooled by size across colors.</p>`;actions=button('Cancel','close-dialog','secondary')+button('Review size exchange','review-exchange','primary','arrow');
  } else if (d.type==='confirm') {
    const p=state.session?.pendingAction;if(!p){closeDialog(false);return;}
    if(state.session.kind==='historical-replay') {
      eyebrow='App-owned replay selection';title='Confirm this replay choice.';subtitle='The historical refund remains completed. This does not create an exchange or refund.';
      const selected=state.session.candidates?.find(c=>c.ref===p.productRef);
      body=`<div class="confirmation-summary"><h3>${e(selected?.name||p.productRef)}</h3>${detail('Historical status','Refund Completed')}${detail('Outcome','App-owned replay_selection')}${detail('Merchant action','None')}${detail('Stock','Unknown')}</div>`;
      actions=button('Cancel','cancel-proposal','secondary','',busyAttrs())+button('Confirm replay choice','confirm-resolution','primary','check',busyAttrs());
    } else {
    if(d.proposalId!==p.proposalId){d.proposalId=p.proposalId;d.conditionConfirmed=false;}
    eyebrow='Your choice, your confirmation';title=p.action==='refund'?'Review your refund.':p.action==='escalate'?'Review the support case.':p.action==='replacement'?'Review your replacement.':'Review your exchange.';subtitle='Nothing has been executed. Check the exact details below.';
    body=`<div class="confirmation-summary"><h3>${e(p.summary)}</h3><div class="detail-list">${detail('Order',p.orderId)}${detail('Returning',p.sourceProductName)}${p.productName?detail('New item',p.productName):''}${p.size?detail('Variant',`${p.color} · ${p.size}`):''}${p.refundAmountInr?detail('Refund amount',money(p.refundAmountInr)):''}${p.productName?detail('Price difference',deltaText(p.priceDeltaInr)):''}${p.productName?detail('Variant evidence',measurementSummary(source(),item().size,productById(p.productId),p.size)):''}${detail('Policy',policyVersion())}${detail('Execution','Local simulation only')}</div></div>${p.conditionConfirmationRequired?`<label class="condition-checkbox"><input type="checkbox" id="condition-confirmed" ${d.conditionConfirmed?'checked':''}><span>I confirm this item is unworn and unwashed, with its original tags attached</span></label>`:''}<div class="confirmation-warning">${icon('info','small-icon')} This creates a demo record only. No payment, refund, delivery, or external support request will take place.${p.productName?' Stock is rechecked at confirmation.':''}</div>`;
    actions=button('Cancel','cancel-proposal','secondary','',busyAttrs())+button(`Confirm ${p.action==='escalate'?'support case':p.action}`,'confirm-resolution','primary','check',`${busyAttrs()} ${p.conditionConfirmationRequired&&!d.conditionConfirmed?'disabled':''}`);
    }
  } else if (d.type==='customer') {
    const c=customer(), b=brain()||c.customerBrain;
    eyebrow='Customer brain';title=c.name||'Customer context';subtitle='Commerce facts and preferences stay separate. Explicit statements take priority.';wide=true;
    body=`<div class="profile-summary">${badge(c.customerId,'neutral')}${badge(b?.coldStart?'Cold start':'Returning customer','green')}${badge('Synthetic identity','neutral')}</div><div class="profile-columns"><section><h3>Explicit preferences</h3>${preferenceList(b?.explicitPreferences||[],'No explicit preferences captured yet.')}<h3 style="margin-top:23px">Tentative history signals</h3>${preferenceList(b?.inferredPreferences||[],'No established history. We won’t invent a preference.')}</section><section><h3>Category-specific sizes</h3><div class="size-profile">${b?.sizeProfile?.length?b.sizeProfile.map(p=>`<div><strong>${e(humanize(p.category))}</strong><span>${e(humanize(p.fit))} · ${e(p.size)}</span><small>${e(p.source)}</small></div>`).join(''):'<p class="no-data">Start the session to load a size profile.</p>'}</div><h3 style="margin-top:23px">Purchase history</h3><div class="history-list">${(c.orders||[]).map(o=>`<div><strong>${e(o.orderId)}</strong><span>${o.items.length} ${o.items.length===1?'item':'items'} · ${o.deliveredDaysAgo} days since delivery</span><small>${o.items.map(i=>e(productById(i.productId)?.name||i.productId)).join('<br>')}</small></div>`).join('')}</div></section></div><p class="dialog-note">“Kept” is inferred from no recorded return after the window. It is not a stated preference or a guarantee that the customer liked the item. Confidence values are heuristic, not calibrated probabilities.</p>`;
  } else if (d.type==='tool'||d.type==='diagnosis'||d.type==='all-tools') {
    const data=d.type==='tool'?toolEvents()[d.data]:d.type==='diagnosis'?diagnosis():toolEvents();
    eyebrow='Inspect the evidence';title=d.type==='tool'?(data?.name||'Tool execution'):d.type==='diagnosis'?'Return diagnosis':'Tool execution history';subtitle='Actual data returned by the local application. No invented tool results.';wide=true;
    body=`${d.type==='tool'?`<div class="profile-summary">${badge(data?.status||'unknown',data?.status==='completed'?'green':'orange')}${badge(data?.durationMs==null?'Timing unavailable':`${data.durationMs} ms · local execution`,'neutral')}</div><p class="dialog-note">${e(data?.detail||'')}</p>`:''}<pre class="data-code">${pretty(data)}</pre>`;
  } else if (d.type==='excluded') {
    eyebrow='Recommendation constraints';title='Why these did not make the cut.';subtitle='An alternative is useful only if it addresses the known problem.';
    body=`<div class="exclusion-list">${(state.session?.excluded||[]).map(p=>`<article><span>${icon('close')}</span><div><h3>${e(p.name)}</h3><p>${e(p.reason)}</p></div></article>`).join('')}</div>`;
  } else if (d.type==='catalog') {
    const publicView=d.data!=='fixtures';const products=publicView?catalog():state.bootstrap.fixtureCatalog||[];
    eyebrow='Product brain';title=publicView?`${products.length} public product snapshots.`:`${products.length} legacy synthetic fixtures.`;subtitle='Public facts keep their source dates. Legacy fixtures remain separate. All operational inventory is simulated, and artwork is schematic.';wide=true;
    body=`<div class="catalog-switch">${button('Public snapshots · '+catalog().length,'public-catalog',publicView?'primary small':'secondary small')}${button('Legacy fixtures · '+(state.bootstrap.fixtureCatalog?.length||0),'fixture-catalog',publicView?'secondary small':'primary small')}</div><div class="catalog-list">${products.map(p=>`<article>${productArt(p,'cat'+p.id)}<div><h3>${e(p.name)}</h3><p>${e(humanize(p.fit))} · ${e(p.material)}${p.gsm?` · ${p.gsm} GSM`:''}</p><small>${e(p.sizes.join(', '))} · simulated stock</small>${provenance(p)}</div><strong>${money(p.priceInr)}</strong></article>`).join('')}</div>`;
  } else if (d.type==='items') {
    eyebrow='Item-level state';title='Different items, different stories.';subtitle='Each item keeps its own diagnosis, policy decision, and resolution.';
    body=`<div class="scenario-list">${(state.session?.items||order().items?.map(it=>({item:it,product:productById(it.productId),status:'not_started'}))||[]).map(w=>`<button class="scenario-option ${w.item.itemId===item().itemId?'selected':''}" data-item="${e(w.item.itemId)}"><span class="item-art">${productArt(w.product,'item'+w.item.itemId)}</span><span><strong>${e(w.product?.name)}</strong><small>${e(w.item.size)} · ${e(w.item.color)}</small></span>${badge(humanize(w.status),w.status==='resolved'?'green':'neutral')}</button>`).join('')}</div>`;
  } else if (d.type==='insight') {
    const r=d.data;eyebrow='Conversation → product intelligence';title=productById(signalProduct(r))?.name||r.productName||'Recorded product insight';subtitle=`${r.customerName||customers().find(c=>c.customerId===r.customerId)?.name||'Demo customer'} · ${r.orderId||'Local session'}`;wide=true;
    body=`<div class="profile-summary">${badge(humanize(signalReason(r)),'green')}${badge(humanize(signalOutcome(r)),'neutral')}${badge('Synthetic evidence','neutral')}</div><div class="insight-dialog-columns"><section>${learningLoop(r)}</section><section><h3>Customer words</h3><div class="insight-transcript">${(r.transcript||[]).map(m=>`<article><strong>${m.role==='user'?'Customer':'Assistant'}</strong><p>${e(m.text)}</p></article>`).join('')||'<p class="no-data">No transcript attached to this record.</p>'}</div></section></div><div class="profile-summary" style="margin-top:25px">${badge(`Policy ${r.policyCitation?.version||policyVersion()}`,'neutral')}</div><details class="evidence-details"><summary>Inspect structured insight</summary><pre class="data-code">${pretty(r)}</pre></details>`;
  } else if (d.type==='sku') {
    const p=productById(d.data), rows=insightRows().filter(r=>signalProduct(r)===d.data);eyebrow='SKU-level intelligence';title=p?.name||'Product signals';subtitle=`${rows.length} local ${rows.length===1?'conversation':'conversations'}. Customer feedback and outcomes are simulated.`;
    body=`<div class="sku-detail-art">${productArt(p||{},'skudetail')}</div><div class="detail-list">${detail('SKU',d.data)}${detail('Fit',humanize(p?.fit))}${detail('Fabric',`${p?.material||'Not listed'}${p?.gsm?` · ${p.gsm} GSM`:''}`)}</div><div class="exclusion-list">${rows.map(r=>`<article><span>${icon('filter')}</span><div><h3>${e(humanize(signalReason(r)))}</h3><p>${e(r.diagnosis?.evidence?.[0]?.quote||'No quote attached')}</p><small>${e(humanize(signalOutcome(r)))}</small></div></article>`).join('')}</div><p class="dialog-note">Review signal only. This sample does not establish a recurring defect, anomaly, or causal relationship.</p>`;
  }
  $('#overlay-root').innerHTML=`<div class="overlay" data-overlay="true"><section class="dialog ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="dialog-header"><div><span class="eyebrow">${e(eyebrow)}</span><h2 id="dialog-title">${e(title)}</h2>${subtitle?`<p>${e(subtitle)}</p>`:''}</div><button class="icon-btn" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></header>${state.error?`<div class="error-banner" role="alert"><span>${e(state.error)}</span></div>`:''}${body}${actions?`<footer class="dialog-actions">${actions}</footer>`:''}</section></div>`;
  document.body.style.overflow='hidden';
  if(focusedId&&/^[a-zA-Z0-9_-]+$/.test(focusedId))$('#'+focusedId)?.focus?.();
  const dialog=$('.dialog');
  if(dialog&&!dialog.contains(document.activeElement))dialog.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')?.focus();
}
function measure(value) {return Number.isFinite(value)?`${value} in`:'Not published';}
function valueDelta(a,b,unit='in') {return Number.isFinite(a)&&Number.isFinite(b)?b===a?'unchanged':`${b>a?'+':''}${Math.round((b-a)*100)/100} ${unit}`:'difference unknown';}
function observedDate(value) {return String(value||'unknown date').split('T')[0];}
function provenance(p,compact=false) {
  const info=p?.catalogSource;
  if(!info)return `<span class="catalog-provenance fixture">Legacy synthetic fixture</span>`;
  const link=typeof info.url==='string'&&info.url.startsWith('https://')?`<a href="${e(info.url)}" target="_blank" rel="noopener noreferrer">${compact?'Source':'Official product source'} ${icon('arrowUp','small-icon')}</a>`:'Source URL unavailable';
  return `<div class="catalog-provenance">${link}<span>Captured ${e(observedDate(info.observedAt))}</span>${!compact&&info.unknownFields?.length?`<small>Unpublished: ${e(info.unknownFields.map(field=>({brandDescription:'brand description',operationalReturnEligibility:'live return eligibility',stock:'live inventory',gsm:'fabric weight',color:'color'}[field]||humanize(field))).join(', '))}</small>`:''}</div>`;
}
function comparisonMetrics(a,as,b,bs) {
 const am=a?.garmentMeasurements?.[as]||{},bm=b?.garmentMeasurements?.[bs]||{};
 const rows=[['Size',as,bs],['Fit',humanize(a?.fit),humanize(b?.fit)],['Material',a?.material||'Not published',b?.material||'Not published'],['Fabric weight',Number.isFinite(a?.gsm)?`${a.gsm} GSM`:'Not published',Number.isFinite(b?.gsm)?`${b.gsm} GSM (${valueDelta(a?.gsm,b.gsm,'GSM')})`:'Not published'],['Garment chest',measure(am.chestIn),`${measure(bm.chestIn)}${Number.isFinite(bm.chestIn)?' ('+valueDelta(am.chestIn,bm.chestIn)+')':''}`],['Shoulder',measure(am.shoulderIn),`${measure(bm.shoulderIn)}${Number.isFinite(bm.shoulderIn)?' ('+valueDelta(am.shoulderIn,bm.shoulderIn)+')':''}`],['Length',measure(am.lengthIn),`${measure(bm.lengthIn)}${Number.isFinite(bm.lengthIn)?' ('+valueDelta(am.lengthIn,bm.lengthIn)+')':''}`],['Price snapshot',money(a?.priceInr),`${money(b?.priceInr)} · ${deltaText((b?.priceInr||0)-(item().priceInr||a?.priceInr||0))}`],['Demo inventory',`${a?.stock?.[as]||0} simulated units`,`${b?.stock?.[bs]||0} simulated units`]];
 return `<div class="comparison-facts">${rows.map(([key,x,y])=>`<div class="comparison-fact ${key==='Length'&&am.lengthIn!==bm.lengthIn?'measurement-change':''}"><span>${e(key)}</span><span>${e(x)}</span><span>${e(y)}</span></div>`).join('')}</div>`;
}
function measurementCaveat(a,as,b,bs) {const am=a?.garmentMeasurements?.[as],bm=b?.garmentMeasurements?.[bs];return am?.lengthIn!=null&&bm?.lengthIn!=null?(am.lengthIn===bm.lengthIn?'Published length is unchanged; fit is not guaranteed.':`Length changes from ${am.lengthIn} in to ${bm.lengthIn} in. Confirm that difference works for you.`):'The length difference is unknown; the same length cannot be promised.';}
function measurementSummary(a,as,b,bs) {const am=a?.garmentMeasurements?.[as]||{},bm=b?.garmentMeasurements?.[bs]||{};return `Chest ${measure(am.chestIn)} → ${measure(bm.chestIn)}; shoulder ${measure(am.shoulderIn)} → ${measure(bm.shoulderIn)}; length ${measure(am.lengthIn)} → ${measure(bm.lengthIn)}; fabric ${a?.gsm??'unknown'} → ${b?.gsm??'unknown'} GSM. Fit and comfort not guaranteed.`;}
function deltaText(delta) {return delta===0?'No price difference':delta>0?`${money(delta)} additional`:`${money(Math.abs(delta))} refunded`;}
function preferenceList(list,empty) {return list.length?`<div class="preference-list">${list.map(p=>`<article><div><strong>${p.sentiment==='negative'?'Avoids':'Prefers'} ${e(p.value)}</strong>${badge(p.source==='explicit_statement'?'Stated':'Inferred',p.source==='explicit_statement'?'green':'neutral')}</div><p>${e(p.evidence?.[0]||'No evidence attached')}</p><small>${e(humanize(p.attribute))} · heuristic confidence ${Math.round(p.confidence*100)}%</small></article>`).join('')}</div>`:`<p class="no-data">${empty}</p>`;}
async function closeDialog(cancel=true) {
  if(state.busy)return;
  const wasConfirm=state.dialog?.type==='confirm';
  state.dialog=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';
  if(lastFocus?.isConnected)lastFocus.focus();else $('#message-input')?.focus();
  if(wasConfirm&&cancel&&state.session?.pendingAction){await withBusy(async()=>{acceptSession(await api(`/api/sessions/${sessionId()}/cancel-proposal`,{}));});}
  requestAnimationFrame(()=>{if(lastFocus?.isConnected)lastFocus.focus();else $('#message-input')?.focus();});
}
function toast(text) {clearTimeout(toastTimer);$('#toast-root').innerHTML=`<div class="toast" role="status">${icon('check')}${e(text)}</div>`;toastTimer=setTimeout(()=>{$('#toast-root').innerHTML='';},3800);}
async function withBusy(work) {
  if(state.busy)return;
  state.busy=true;state.error='';render();
  try {await work();} catch(err) {state.error=err instanceof Error?err.message:'Something went wrong. Please try again.';}
  finally {state.busy=false;render();scrollTranscript();}
}
function scrollTranscript(){requestAnimationFrame(()=>{const log=$('.transcript');if(log)log.scrollTop=log.scrollHeight;});}
async function startSession(extra={}) {acceptSession(await api('/api/sessions',{customerId:state.customerId,...(state.selectedScenario?{scenario:state.selectedScenario.id,orderId:state.selectedScenario.orderId}:{}),...extra}));state.voiceTranscript=[];}
async function sendMessage(text) {
  const clean=text.trim();if(!clean||state.busy||completed()||modeLive())return;
  await withBusy(async()=>{if(!state.session)await startSession();acceptSession(await api(`/api/sessions/${sessionId()}/messages`,{text:clean}));if(state.session.pendingAction)state.dialog={type:'confirm'};});
  if(!state.dialog){if($('#message-input'))$('#message-input').value='';$('#message-input')?.focus();}
}
async function propose(action, extra={}) {
  await withBusy(async()=>{acceptSession(await api(`/api/sessions/${sessionId()}/propose`,{action,...extra}));state.dialog={type:'confirm'};});
}
async function navigate(view,push=true) {
  if(!['workspace','intelligence','evaluations','policy'].includes(view))return;
  state.view=view;if(push&&location.hash!==`#${view}`)history.pushState(null,'',`#${view}`);render();
  if(view==='intelligence')await fetchInsights();
  if(view==='evaluations')await fetchEvals();
}
async function fetchInsights(){try{state.insights=await api('/api/insights');state.error='';render();}catch(err){state.error=err.message;render();}}
async function fetchEvals(){try{state.evaluations=await api('/api/evaluations');state.error='';render();}catch(err){state.error=err.message;render();}}
async function startVoice() {
  if(state.bootstrap.capabilities?.voice?.status!=='ready'||(!state.session&&!state.replayReceipt)||state.voice||$('#voice-consent')?.checked!==true)return;
  try {
    state.dialog=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';state.error='';
    if(state.replayReceipt&&!state.session)acceptSession(await api('/api/replay-voice-sessions',{receiptId:state.replayReceipt}));
    state.voice=createVoiceClient({sessionId:sessionId(),capabilities:state.bootstrap.capabilities,
      onStatus(event){state.voiceStatus=event.status;state.voiceMuted=Boolean(event.muted);state.voiceReady=Boolean(event.ready);render();if(['ended','error'].includes(event.status)){state.voice=null;state.voiceReady=false;state.voiceTranscript=[];render();}},
      onTool(event){state.voiceTools=state.voiceTools||new Map();state.voiceTools.set(event.callId,event);render();},
      onTranscript(event){state.voiceTranscript=state.voiceTranscript.filter(m=>!event.itemId || m.itemId!==event.itemId || m.role!==event.role);state.voiceTranscript.push({...event,at:new Date().toISOString()});render();scrollTranscript();},
      onError(error){state.error=error.message||String(error);render();},
      onSession(snapshot){acceptSession(snapshot);state.voiceTranscript=[];if(state.session.pendingAction&&!state.dialog)state.dialog={type:'confirm'};render();scrollTranscript();},
    });
    await state.voice.start();
  } catch(error) {state.error=error.message||String(error);state.voiceStatus='error';state.voice=null;render();}
}
async function stopVoice(){const voice=state.voice;state.voice=null;if(voice)await voice.stop('user');state.voiceStatus='ended';state.voiceTranscript=[];render();}
async function performAction(action) {
  switch(action) {
    case 'replay-sources':await withBusy(async()=>{state.replaySources=await api('/api/replays/sources');});openDialog('replay-sources');break;
    case 'exit-replay':if(state.voice)await stopVoice();state.replaySnapshot=null;state.replayReceipt=null;state.session=null;render();break;
    case 'start': await withBusy(()=>startSession());$('#message-input')?.focus();break;
    case 'restart': if(state.voice)await stopVoice();state.session=null;state.voiceTranscript=[];state.selectedScenario=state.bootstrap?.scenarios?.find(s=>s.id==='grounded')||null;state.customerId=state.selectedScenario?.customerId||'CUST-001';state.error='';render();toast('New demo ready. Earlier transcript and insight records are retained.');break;
    case 'scenarios':openDialog('scenarios');break;
    case 'connection':openDialog('connection');break;
    case 'catalog':openDialog('catalog');break;
    case 'public-catalog':openDialog('catalog');break;
    case 'fixture-catalog':openDialog('catalog','fixtures');break;
    case 'customer-detail':openDialog('customer');break;
    case 'diagnosis-detail':openDialog('diagnosis');break;
    case 'all-tools':openDialog('all-tools');break;
    case 'excluded':openDialog('excluded');break;
    case 'items':openDialog('items');break;
    case 'close-dialog':await closeDialog();break;
    case 'dismiss-error':state.error='';render();break;
    case 'refresh-insights':await fetchInsights();toast('Loaded the latest local records');break;
    case 'refresh-evals':await fetchEvals();break;
    case 'show-intelligence':await navigate('intelligence');window.scrollTo({top:0,behavior:'smooth'});break;
    case 'back-workspace':await navigate('workspace');window.scrollTo({top:0,behavior:'smooth'});break;
    case 'review-pending':openDialog('confirm');break;
    case 'refund':await propose('refund');break;
    case 'change-size':if(canChangeSize())openDialog('variant');break;
    case 'replacement':await propose('replacement',{productId:source().id,size:item().size,color:item().color});break;
    case 'escalate':await propose('escalate');break;
    case 'review-exchange':{const p=state.activeProduct;const size=$('#replacement-size')?.value,color=$('#replacement-color')?.value;if(state.dialog?.type==='variant'&&size===item().size&&color===item().color){state.error='Choose a different size or color to request a variant exchange.';renderDialog();break;}await propose('exchange',{productId:p.id,size,color});break;}
    case 'cancel-proposal':await closeDialog();break;
    case 'confirm-resolution':{const proposalId=state.session?.pendingAction?.proposalId;if(!proposalId)break;const conditionConfirmed=$('#condition-confirmed')?.checked===true;await withBusy(async()=>{acceptSession(await api(`/api/sessions/${sessionId()}/resolve`,{proposalId,confirmed:true,conditionConfirmed}));state.dialog=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';toast(state.session.kind==='historical-replay'?'App-owned replay choice recorded. Historical refund unchanged.':'Demo resolution recorded. Product insight saved.');});break;}
    case 'start-voice':await startVoice();break;
    case 'stop-voice':await stopVoice();break;
    case 'mute-voice':state.voice?.mute();break;
    case 'reload':await initialize();break;
  }
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button,[data-insight],[data-sku],[data-overlay]');if(!target||target.disabled)return;
  if(target.hasAttribute('data-overlay')&&event.target===target){await closeDialog();return;}
  if(target.dataset.nav){await navigate(target.dataset.nav);return;}
  if(target.dataset.action){await performAction(target.dataset.action);return;}
  if(target.dataset.send){await sendMessage(target.dataset.send);return;}
  if(target.dataset.compare){const candidate=candidates().find(c=>(c.product?.id||c.productId||c.id)===target.dataset.compare);if(candidate)openDialog('compare',candidate);return;}
  if(target.dataset.tool!==undefined){openDialog('tool',Number(target.dataset.tool));return;}
  if(target.dataset.replaySource!==undefined){const x=state.replaySources?.items[Number(target.dataset.replaySource)];if(!x?.canReplay)return;await closeDialog(false);await withBusy(async()=>{state.replaySnapshot=await api('/api/replays',{sourceToken:x.sourceToken});const receipt=await api(`/api/replays/${state.replaySnapshot.id}/prepare-voice`,{});state.replayReceipt=receipt.receiptId;state.session=null;});return;}
  if(target.dataset.scenario!==undefined){const s=state.bootstrap.scenarios[Number(target.dataset.scenario)];await closeDialog(false);state.customerId=s.customerId;state.selectedScenario=s;state.session=null;await withBusy(async()=>{await startSession({scenario:s.id});acceptSession(await api(`/api/sessions/${sessionId()}/messages`,{text:s.prompt}));if(state.session.pendingAction)state.dialog={type:'confirm'};});return;}
  if(target.dataset.item){const id=target.dataset.item;await closeDialog(false);await withBusy(async()=>{if(!state.session)await startSession({itemId:id});else acceptSession(await api(`/api/sessions/${sessionId()}/select-item`,{itemId:id}));});return;}
  if(target.dataset.insight!==undefined){openDialog('insight',insightRows()[Number(target.dataset.insight)]);return;}
  if(target.dataset.sku){openDialog('sku',target.dataset.sku);return;}
});
document.addEventListener('submit',event=>{if(event.target.id==='message-form'){event.preventDefault();sendMessage(new FormData(event.target).get('message')||'');}});
document.addEventListener('change',event=>{if(event.target.id==='voice-consent'){const button=$('[data-action="start-voice"]');if(button)button.disabled=!event.target.checked||(!state.session&&!state.replayReceipt)||state.busy;}if(['replacement-size','replacement-color'].includes(event.target.id)&&state.dialog?.type==='compare'){state.dialog.selectedSize=$('#replacement-size')?.value;state.dialog.selectedColor=$('#replacement-color')?.value;renderDialog();}if(event.target.id==='condition-confirmed'){if(state.dialog?.type==='confirm')state.dialog.conditionConfirmed=event.target.checked;const button=$('[data-action="confirm-resolution"]');if(button)button.disabled=!event.target.checked||state.busy;}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.dialog){event.preventDefault();closeDialog();}
  if(event.key==='Tab'&&state.dialog){const items=$$('.dialog button:not(:disabled),.dialog input:not(:disabled),.dialog select:not(:disabled),.dialog a[href],.dialog summary');if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  if(event.key==='Enter'&&event.target.matches('[data-insight]'))event.target.click();
});
window.addEventListener('popstate',()=>navigate(location.hash.replace('#','')||'workspace',false));
window.addEventListener('beforeunload',()=>state.voice?.destroy?.());
async function initialize() {
  try {state.bootstrap=await api('/api/bootstrap');if(!state.selectedScenario&&!state.session)state.selectedScenario=state.bootstrap.scenarios?.find(s=>s.id==='grounded')||null;state.error='';render();if(state.view==='intelligence')await fetchInsights();if(state.view==='evaluations')await fetchEvals();}
  catch(error){$('#app').innerHTML=`<main class="reload-screen"><div class="brand-mark">r<span>↗</span></div><h1>The workspace needs its local service.</h1><p>${e(error.message)}<br>Start the project’s demo server, then reload this page.</p>${button('Try again','reload','primary','refresh')}</main>`;}
}
initialize();
