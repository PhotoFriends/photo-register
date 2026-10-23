import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, getDoc, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyByNolalAuk-d6LHBwENVrshE7QpKo4Jss',
  authDomain: 'pf-register-1023.firebaseapp.com',
  projectId: 'pf-register-1023',
  storageBucket: 'pf-register-1023.firebasestorage.app',
  messagingSenderId: '944810320688',
  appId: '1:944810320688:web:0f0916483880318fd91ef5',
};

// 商品（在庫は「残り」の目安表示にだけ使う）
const PRODUCTS = [
  { id: 'cal-school', cat: 'cal', name: 'スクールカレンダー 2027', s: 'スクールカレンダー', price: 500, stock: 200, img: 'img/p2.jpg' },
  { id: 'cal-season', cat: 'cal', name: 'シーズナルカレンダー 2027', s: 'シーズナルカレンダー', price: 500, stock: 50, img: 'img/p1.jpg' },
  { id: 'cf-1', cat: 'cf', name: 'クリアファイル 三日月・桜', s: 'CF 三日月・桜', price: 300, stock: 30, img: 'img/p3.jpg' },
  { id: 'cf-2', cat: 'cf', name: 'クリアファイル 飛行機・海', s: 'CF 飛行機・海', price: 300, stock: 30, img: 'img/p4.jpg' },
  { id: 'cf-3', cat: 'cf', name: 'クリアファイル 雪並木・夜景', s: 'CF 雪並木・夜景', price: 300, stock: 30, img: 'img/p9.jpg' },
  { id: 'pc-1', cat: 'pc', name: 'ポストカード ヤドカリ', s: 'PC ヤドカリ', price: 100, stock: 30, img: 'img/p5.jpg' },
  { id: 'pc-2', cat: 'pc', name: 'ポストカード 羽田の空', s: 'PC 羽田の空', price: 100, stock: 30, img: 'img/p6.jpg' },
  { id: 'pc-3', cat: 'pc', name: 'ポストカード 紫陽花', s: 'PC 紫陽花', price: 100, stock: 30, img: 'img/p7.jpg' },
  { id: 'book', cat: 'bk', name: '写真集 光画 vol.2', s: '光画 vol.2', price: 600, stock: 30, img: 'img/p8.jpg' },
];
const CATS = { cal: 'カレンダー', cf: 'クリアファイル', pc: 'ポストカード', bk: '写真集' };
const P = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

const $ = s => document.querySelector(s);
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const db = initializeFirestore(initializeApp(firebaseConfig), {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let shopKey = null;
let device = '';
let sales = [];
let settings = { floats: {} };
let fromCache = true;
let cart = {};
let paidStr = '';

async function keyOf(pass) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pf-register|' + pass));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const salesCol = () => collection(db, 'shops', shopKey, 'sales');
const settingsDoc = () => doc(db, 'shops', shopKey, 'meta', 'settings');

/* ---------- ログイン ---------- */
let pendingCreate = null;
$('#loginBtn').onclick = async () => {
  const pass = $('#pass').value.trim();
  const name = $('#devname').value.trim();
  const msg = $('#loginMsg');
  if (pass.length < 4) { msg.textContent = '合言葉を入力してください'; return; }
  if (!name) { msg.textContent = '端末の名前を入力してください'; return; }
  const key = await keyOf(pass);
  msg.textContent = '確認中…';
  try {
    if (pendingCreate === key) {
      await setDoc(doc(db, 'shops', key, 'meta', 'settings'), { createdAt: serverTimestamp(), floats: {} });
    } else {
      const snap = await getDoc(doc(db, 'shops', key, 'meta', 'settings'));
      if (!snap.exists()) {
        pendingCreate = key;
        msg.textContent = 'この合言葉の販売記録はまだありません。新しく作る場合はもう一度「はじめる」を押してください。';
        $('#loginBtn').textContent = '新しく作ってはじめる';
        return;
      }
    }
  } catch (e) {
    msg.textContent = '通信できませんでした。電波のある場所でもう一度試してください。';
    return;
  }
  store.set('pf.key', key);
  store.set('pf.dev', name);
  start(key, name);
};
$('#pass').addEventListener('input', () => { pendingCreate = null; $('#loginBtn').textContent = 'はじめる'; });

function start(key, name) {
  shopKey = key;
  device = name;
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderGrid();
  onSnapshot(salesCol(), { includeMetadataChanges: true }, snap => {
    fromCache = snap.metadata.fromCache;
    sales = snap.docs.map(d => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }))
      .sort((a, b) => b.t - a.t);
    renderSync();
    renderHist();
    renderSum();
  }, () => renderSync(true));
  onSnapshot(settingsDoc(), snap => {
    settings = { floats: {}, ...(snap.data() || {}) };
    renderSum();
  });
}

/* ---------- 同期表示 ---------- */
function renderSync(err) {
  const pend = sales.filter(s => s.pending).length;
  const el = $('#sync');
  el.className = 'sync';
  let text;
  if (err) { el.classList.add('off'); text = 'エラー'; }
  else if (!navigator.onLine || fromCache) { el.classList.add('off'); text = pend ? `オフライン（未送信${pend}件）` : 'オフライン'; }
  else if (pend) { el.classList.add('wait'); text = `送信中 ${pend}件`; }
  else { el.classList.add('on'); text = '同期済み'; }
  $('#syncText').textContent = `${device}・${text}`;
}
addEventListener('online', () => renderSync());
addEventListener('offline', () => renderSync());

/* ---------- 会計 ---------- */
function renderGrid() {
  $('#grid').innerHTML = PRODUCTS.map(p => `
    <button class="item" data-id="${p.id}">
      <img class="ph" src="${p.img}" alt="" draggable="false">
      <span class="cat ${p.cat}">${CATS[p.cat]}</span>
      <span class="qty" hidden></span>
      <span class="minus" role="button" aria-label="1つ減らす" hidden>−</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="pr">${yen(p.price)}</span>
    </button>`).join('');
}
$('#grid').addEventListener('click', e => {
  const item = e.target.closest('.item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.closest('.minus')) cart[id] = Math.max(0, (cart[id] || 0) - 1);
  else cart[id] = (cart[id] || 0) + 1;
  if (!cart[id]) delete cart[id];
  renderCart();
});
const cartTotal = () => Object.entries(cart).reduce((t, [id, q]) => t + P[id].price * q, 0);
const cartCount = () => Object.values(cart).reduce((t, q) => t + q, 0);
function renderCart() {
  document.querySelectorAll('.item').forEach(el => {
    const q = cart[el.dataset.id] || 0;
    el.classList.toggle('sel', q > 0);
    el.querySelector('.qty').hidden = !q;
    el.querySelector('.qty').textContent = q;
    el.querySelector('.minus').hidden = !q;
  });
  $('#cartTotal').textContent = yen(cartTotal());
  $('#cartCount').textContent = cartCount() + '点';
  $('#payBtn').disabled = !cartCount();
}
$('#clearBtn').onclick = () => { cart = {}; renderCart(); };

/* ---------- お会計 ---------- */
$('#payBtn').onclick = () => {
  paidStr = '';
  $('#lines').innerHTML = Object.entries(cart).map(([id, q]) =>
    `<div><span>${esc(P[id].name)} × ${q}</span><span>${yen(P[id].price * q)}</span></div>`).join('');
  $('#billAmt').textContent = yen(cartTotal());
  renderPay();
  $('#sheet').hidden = false;
};
$('#backBtn').onclick = () => { $('#sheet').hidden = true; };
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });

function renderPay() {
  const bill = cartTotal();
  const paid = Number(paidStr || 0);
  $('#paidAmt').textContent = paidStr ? yen(paid) : '¥0';
  const box = $('#changeAmt').parentElement;
  if (!paidStr) {
    box.classList.remove('short');
    $('#changeLabel').textContent = 'お釣り';
    $('#changeAmt').textContent = '—';
  } else if (paid < bill) {
    box.classList.add('short');
    $('#changeLabel').textContent = '不足';
    $('#changeAmt').textContent = yen(bill - paid);
  } else {
    box.classList.remove('short');
    $('#changeLabel').textContent = 'お釣り';
    $('#changeAmt').textContent = yen(paid - bill);
  }
  $('#okBtn').disabled = !paidStr || paid < bill;
}
document.querySelector('.keys').addEventListener('click', e => {
  const k = e.target.dataset.k;
  if (!k) return;
  if (k === 'C') paidStr = '';
  else if ((paidStr + k).replace(/^0+/, '').length <= 6) paidStr = (paidStr + k).replace(/^0+/, '');
  renderPay();
});
document.querySelector('.quick').addEventListener('click', e => {
  const q = e.target.dataset.q;
  if (!q) return;
  paidStr = String(q === 'exact' ? cartTotal() : q);
  renderPay();
});

$('#okBtn').onclick = () => {
  const total = cartTotal();
  const paid = Number(paidStr);
  if (!paid || paid < total) return;
  $('#okBtn').disabled = true;
  const now = Date.now();
  const id = now.toString(36) + '-' + crypto.randomUUID().slice(0, 8);
  // 待たずに書き込む：端末内のキャッシュには即時反映、送信は裏で行われる
  setDoc(doc(salesCol(), id), {
    items: { ...cart }, total, paid, change: paid - total,
    t: now, at: serverTimestamp(), dev: device, void: false,
  }).catch(() => renderSync(true));
  $('#doneChange').textContent = yen(paid - total);
  $('#doneSub').textContent = `請求 ${yen(total)} ／ お預かり ${yen(paid)}`;
  $('#sheet').hidden = true;
  $('#done').hidden = false;
  cart = {};
  renderCart();
};
$('#nextBtn').onclick = () => { $('#done').hidden = true; };

/* ---------- 画面切替 ---------- */
document.querySelector('.tabs').addEventListener('click', e => {
  const v = e.target.dataset.v;
  if (!v) return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['reg', 'hist', 'sum'].forEach(x => { $('#v-' + x).hidden = x !== v; });
});

/* ---------- 履歴 ---------- */
const hm = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function renderHist() {
  if (!sales.length) { $('#hist').innerHTML = '<div class="empty">まだ会計はありません</div>'; return; }
  $('#hist').innerHTML = sales.map(s => `
    <div class="sale ${s.void ? 'void' : ''}">
      <div class="meta">${hm(s.t)}　${esc(s.dev)}${s.void ? '<span class="tag">取消済</span>' : ''}${s.pending ? '<span class="tag pend">未送信</span>' : ''}</div>
      <div class="act"><button data-id="${s.id}">${s.void ? '取消を戻す' : '取消'}</button></div>
      <div class="its">${Object.entries(s.items || {}).map(([id, q]) => `${esc(P[id]?.s || id)}×${q}`).join('、')}</div>
      <div><div class="tot">${yen(s.total)}</div><div class="pay">預 ${yen(s.paid)}／釣 ${yen(s.change)}</div></div>
    </div>`).join('');
}
// 取消は2回タップ（誤操作防止）
$('#hist').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  if (!b.classList.contains('arm')) {
    b.classList.add('arm');
    b.dataset.label = b.textContent;
    b.textContent = 'もう一度タップ';
    setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = b.dataset.label; } }, 3000);
    return;
  }
  const s = sales.find(x => x.id === b.dataset.id);
  if (s) updateDoc(doc(salesCol(), s.id), { void: !s.void, voidBy: device, voidT: Date.now() }).catch(() => renderSync(true));
});

/* ---------- 集計 ---------- */
let sumBuilt = false;
let cashDev = null;
const cash = {};

function buildSum() {
  $('#sum').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>売上合計</span><b id="kTotal">¥0</b></div>
      <div class="kpi"><span>会計数</span><b id="kCount">0</b></div>
      <div class="kpi"><span>点数</span><b id="kItems">0</b></div>
    </div>
    <div class="box"><h2>商品別</h2><div id="byProd"></div></div>
    <div class="box"><h2>端末別</h2><div id="byDev"></div></div>
    <div class="box">
      <h2>締め（現金の確認）</h2>
      <div class="row"><span>端末</span><select id="cashDev"></select></div>
      <div class="row"><span>釣り銭準備金</span><input id="float" type="number" inputmode="numeric" min="0"></div>
      <div class="cash">${DENOMS.map(d => `<label>${d.toLocaleString()}円<input data-d="${d}" type="number" inputmode="numeric" min="0" placeholder="0"></label>`).join('')}</div>
      <div class="row"><span>数えた現金</span><b id="cCounted">¥0</b></div>
      <div class="row"><span>あるはずの現金</span><b id="cExpected">¥0</b></div>
      <div class="row"><span>差額</span><span id="cDiff" class="diff">¥0</span></div>
      <p class="small">あるはずの現金 ＝ 釣り銭準備金 ＋ その端末の売上</p>
    </div>
    <div class="box">
      <h2>その他</h2>
      <div class="tools">
        <button id="csvBtn" class="btn">CSVを保存</button>
        <button id="logoutBtn" class="btn">この端末からログアウト</button>
      </div>
      <p class="small" id="logoutNote"></p>
    </div>`;
  $('#cashDev').onchange = e => { cashDev = e.target.value; DENOMS.forEach(d => { cash[d] = 0; }); document.querySelectorAll('.cash input').forEach(i => { i.value = ''; }); renderSum(); };
  $('#float').onchange = e => {
    const v = Math.max(0, Number(e.target.value || 0));
    setDoc(settingsDoc(), { floats: { [cashDev]: v } }, { merge: true }).catch(() => renderSync(true));
  };
  document.querySelector('.cash').addEventListener('input', e => { cash[e.target.dataset.d] = Number(e.target.value || 0); renderCash(); });
  $('#csvBtn').onclick = downloadCsv;
  $('#logoutBtn').onclick = () => {
    const pend = sales.filter(s => s.pending).length;
    if (pend && $('#logoutBtn').dataset.arm !== '1') {
      $('#logoutBtn').dataset.arm = '1';
      $('#logoutNote').textContent = `未送信の会計が${pend}件あります。送信前にログアウトすると失われる可能性があります。それでもログアウトする場合はもう一度押してください。`;
      return;
    }
    store.del('pf.key');
    location.reload();
  };
  sumBuilt = true;
}

function renderSum() {
  if (!shopKey) return;
  if (!sumBuilt) buildSum();
  const live = sales.filter(s => !s.void);
  const sold = {};
  let items = 0;
  live.forEach(s => Object.entries(s.items || {}).forEach(([id, q]) => { sold[id] = (sold[id] || 0) + q; items += q; }));
  $('#kTotal').textContent = yen(live.reduce((t, s) => t + s.total, 0));
  $('#kCount').textContent = live.length;
  $('#kItems').textContent = items;

  let rows = '';
  for (const c of Object.keys(CATS)) {
    const ps = PRODUCTS.filter(p => p.cat === c);
    let cq = 0, cy = 0;
    ps.forEach(p => {
      const q = sold[p.id] || 0; cq += q; cy += q * p.price;
      rows += `<tr><td>${esc(p.s)}</td><td>${q}</td><td>${p.stock - q}</td><td>${yen(q * p.price)}</td></tr>`;
    });
    if (ps.length > 1) rows += `<tr class="subtot"><td>${CATS[c]} 計</td><td>${cq}</td><td></td><td>${yen(cy)}</td></tr>`;
  }
  $('#byProd').innerHTML = `<table><tr><th>商品</th><th>販売数</th><th>残り</th><th>売上</th></tr>${rows}</table>`;

  const devs = {};
  live.forEach(s => { devs[s.dev] = devs[s.dev] || { n: 0, y: 0 }; devs[s.dev].n++; devs[s.dev].y += s.total; });
  const names = [...new Set([device, ...Object.keys(devs), ...Object.keys(settings.floats || {})])];
  $('#byDev').innerHTML = `<table><tr><th>端末</th><th>会計数</th><th>売上</th></tr>${
    names.map(n => `<tr><td>${esc(n)}</td><td>${devs[n]?.n || 0}</td><td>${yen(devs[n]?.y || 0)}</td></tr>`).join('')}</table>`;

  if (!cashDev) cashDev = device;
  const sel = $('#cashDev');
  sel.innerHTML = names.map(n => `<option ${n === cashDev ? 'selected' : ''}>${esc(n)}</option>`).join('');
  sel.value = cashDev;
  const fl = $('#float');
  if (document.activeElement !== fl) fl.value = settings.floats?.[cashDev] ?? 0;
  renderCash();
}

function renderCash() {
  const counted = DENOMS.reduce((t, d) => t + d * (cash[d] || 0), 0);
  const expected = Number(settings.floats?.[cashDev] || 0) +
    sales.filter(s => !s.void && s.dev === cashDev).reduce((t, s) => t + s.total, 0);
  const diff = counted - expected;
  $('#cCounted').textContent = yen(counted);
  $('#cExpected').textContent = yen(expected);
  const el = $('#cDiff');
  el.textContent = (diff > 0 ? '+' : diff < 0 ? '−' : '') + yen(Math.abs(diff)) + (diff === 0 ? '（一致）' : diff > 0 ? '（多い）' : '（足りない）');
  el.className = 'diff ' + (diff === 0 ? 'ok' : 'ng');
}

function downloadCsv() {
  const head = ['日時', '端末', '状態', ...PRODUCTS.map(p => p.s), '合計', '預かり', 'お釣り'];
  const lines = [...sales].reverse().map(s => {
    const d = new Date(s.t);
    return [
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.toTimeString().slice(0, 8)}`,
      s.dev, s.void ? '取消' : '', ...PRODUCTS.map(p => s.items?.[p.id] || ''), s.total, s.paid, s.change,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `売上_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 起動 ---------- */
const savedKey = store.get('pf.key');
const savedDev = store.get('pf.dev');
if (savedKey && savedDev) start(savedKey, savedDev);
else {
  if (savedDev) $('#devname').value = savedDev;
  $('#login').hidden = false;
}
