import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, getDoc, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, PRODUCTS, CATS, DENOMS } from './common.js?v=13';

const P = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

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
let settings = { float: 0, open: true, openedAt: 0 };
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
// 金種ごとの枚数入力欄（ログイン・集計で共用）
const cashGrid = () => DENOMS.map(d => `<label>${d.toLocaleString()}円<input data-d="${d}" type="number" inputmode="numeric" min="0" placeholder="0"></label>`).join('');
const readCounts = el => Object.fromEntries([...el.querySelectorAll('input[data-d]')].map(i => [i.dataset.d, Math.max(0, Math.floor(Number(i.value || 0)))]));
const sumCounts = c => DENOMS.reduce((t, d) => t + d * (Number(c?.[d]) || 0), 0);

let mode = 'join';
let newKey = null;
let newLabel = '';
$('#loginFloat').innerHTML = cashGrid();
// 釣り銭準備金を入れないと開始できない
$('#loginFloat').addEventListener('input', () => {
  const v = sumCounts(readCounts($('#loginFloat')));
  $('#loginFloatTotal').textContent = yen(v);
  $('#createBtn').disabled = v <= 0;
});
document.querySelector('.seg').addEventListener('click', e => {
  const m = e.target.dataset.m;
  if (!m) return;
  mode = m;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('#passHint').textContent = m === 'new' ? '新しいセッション名を決めてください（ほかの部員にも伝えます）' : '部で決めたセッション名を入力してください';
  $('#loginBtn').textContent = m === 'new' ? '次へ（釣り銭の入力）' : '始める';
  $('#loginMsg').textContent = '';
});

$('#loginBtn').onclick = async () => {
  const pass = $('#pass').value.trim();
  const name = $('#devname').value.trim();
  const msg = $('#loginMsg');
  if (pass.length < 2) { msg.textContent = 'セッション名を入力してください'; return; }
  if (!name) { msg.textContent = '端末の名前を入力してください'; return; }
  const key = await keyOf(pass);
  msg.textContent = '確認中…';
  let snap;
  try {
    snap = await getDoc(doc(db, 'shops', key, 'meta', 'settings'));
    if (mode === 'join' && !snap.exists()) {
      msg.textContent = 'このセッション名は見つかりません。新しく始める場合は「新しく始める」を選んでください。';
      return;
    }
    if (mode === 'new') {
      if (snap.exists()) { msg.textContent = 'このセッション名はすでに使われています。別のセッション名にしてください。'; return; }
      newKey = key;
      newLabel = pass;
      msg.textContent = '';
      $('#step1').hidden = true;
      $('#step2').hidden = false;
      return;
    }
  } catch (e) {
    msg.textContent = '通信できませんでした。電波のある場所でもう一度試してください。';
    return;
  }
  if (!snap.data()?.label) setDoc(doc(db, 'shops', key, 'meta', 'settings'), { label: pass }, { merge: true }).catch(() => {});
  enter(key, name);
};
$('#backBtn1').onclick = () => { $('#step2').hidden = true; $('#step1').hidden = false; $('#loginMsg').textContent = ''; };
$('#createBtn').onclick = async () => {
  const counts = readCounts($('#loginFloat'));
  const float = sumCounts(counts);
  const msg = $('#loginMsg');
  if (float <= 0 || !newKey) return;
  $('#createBtn').disabled = true;
  msg.textContent = '作成中…';
  try {
    const ref = doc(db, 'shops', newKey, 'meta', 'settings');
    if ((await getDoc(ref)).exists()) { msg.textContent = 'このセッション名はすでに使われています。戻って別のセッション名にしてください。'; return; }
    await setDoc(ref, { createdAt: serverTimestamp(), created: Date.now(), label: newLabel, floatCounts: counts, float, open: true, openedAt: Date.now() });
  } catch (e) {
    msg.textContent = '通信できませんでした。電波のある場所でもう一度試してください。';
    $('#createBtn').disabled = false;
    return;
  }
  enter(newKey, $('#devname').value.trim());
};
function enter(key, name) {
  store.set('pf.key', key);
  store.set('pf.dev', name);
  start(key, name);
}

function start(key, name) {
  shopKey = key;
  device = name;
  $('#login').hidden = true;
  $('#app').hidden = false;
  renderGrid();
  // 参加した端末を記録（売上がまだなくても「端末別」に出すため）
  setDoc(settingsDoc(), { devices: { [name]: Date.now() } }, { merge: true }).catch(() => {});
  onSnapshot(salesCol(), { includeMetadataChanges: true }, snap => {
    fromCache = snap.metadata.fromCache;
    sales = snap.docs.map(d => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }))
      .sort((a, b) => b.t - a.t);
    renderSync();
    renderHist();
    renderDels();
    renderSum();
  }, () => renderSync(true));
  onSnapshot(settingsDoc(), snap => {
    settings = { float: 0, open: true, openedAt: 0, ...(snap.data() || {}) };
    renderOpen();
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
    <div class="item" data-id="${p.id}">
      <button class="ph-btn" data-act="plus" aria-label="${esc(p.name)}を1つ追加"><img class="ph" src="${p.img}" alt="" draggable="false"></button>
      <span class="cat ${p.cat}">${CATS[p.cat]}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="pr">${yen(p.price)}</span>
      <div class="stepper">
        <button data-act="minus" aria-label="1つ減らす">−</button>
        <span class="qty">0</span>
        <button data-act="plus" aria-label="1つ増やす">＋</button>
      </div>
    </div>`).join('');
}
// 左の − で減らす、右の ＋（または写真）で増やす
$('#grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.item').dataset.id;
  if (btn.dataset.act === 'minus') cart[id] = Math.max(0, (cart[id] || 0) - 1);
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
    el.querySelector('.qty').textContent = q;
    el.querySelector('[data-act=minus]').disabled = !q;
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
// 削除の状態：none / requested（リクエスト中）/ deleted（パスワードで削除）
const stOf = s => s.delState || (s.deleted ? 'deleted' : 'none');
const isDel = s => stOf(s) !== 'none';
const itemsText = s => Object.entries(s.items || {}).map(([id, q]) => `${esc(P[id]?.s || id)}×${q}`).join('、');
// 削除済みは履歴・集計から外し、「削除済み」にだけ出す
const shown = () => sales.filter(s => !isDel(s));
function renderHist() {
  if (!shown().length) { $('#hist').innerHTML = '<div class="empty">まだ会計はありません</div>'; return; }
  $('#hist').innerHTML = shown().map(s => `
    <div class="sale ${s.void ? 'void' : ''} ${picked.has(s.id) ? 'picked' : ''}" data-sid="${s.id}">
      <span class="chk">${picked.has(s.id) ? '✓' : ''}</span>
      <div class="meta">${hm(s.t)}　${esc(s.dev)}${s.void ? '<span class="tag">取消済</span>' : ''}${s.rejected ? '<span class="tag">削除却下</span>' : ''}${s.pending ? '<span class="tag pend">未送信</span>' : ''}</div>
      <div class="act"><button data-id="${s.id}">削除をリクエスト</button></div>
      <div class="its">${itemsText(s)}</div>
      <div><div class="tot">${yen(s.total)}</div><div class="pay">預 ${yen(s.paid)}／釣 ${yen(s.change)}</div></div>
    </div>`).join('');
}
// 「削除をリクエスト」は2回タップ（誤操作防止）。パスワード不要で削除済みへ移り、管理者が判断する
$('#hist').addEventListener('click', e => {
  if (selecting) {
    const card = e.target.closest('.sale');
    if (!card) return;
    const id = card.dataset.sid;
    picked.has(id) ? picked.delete(id) : picked.add(id);
    renderSel();
    renderHist();
    return;
  }
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
  if (s) {
    updateDoc(doc(salesCol(), s.id), { delState: 'requested', purgeReq: false, delBy: device, delT: Date.now(), rejected: false })
      .catch(() => renderSync(true));
    $('#histMsg').textContent = '削除をリクエストしました（「削除済み」で確認できます）';
  }
});

/* ---------- 選択して削除 ---------- */
// パスワードはサーバーのルールで照合する（このコードには書かない）
let selecting = false;
const picked = new Set();
function renderSel() {
  $('#hist').classList.toggle('selecting', selecting);
  $('#histNormal').hidden = selecting;
  $('#histSel').hidden = !selecting;
  $('#selCount').textContent = `${picked.size}件選択中`;
  $('#selDel').disabled = !picked.size;
  if (!picked.size) $('#delPwRow').hidden = true;
}
function endSel() {
  selecting = false;
  picked.clear();
  $('#delPw').value = '';
  $('#delPwRow').hidden = true;
  renderSel();
  renderHist();
}
// 削除の状態を変える（削除・戻す・完全削除の依頼）。どれも削除パスワードをサーバーで照合する
async function setDelState(ids, pw, change) {
  const batch = writeBatch(db);
  const now = Date.now();
  for (const id of ids) {
    const op = now.toString(36) + '-' + crypto.randomUUID().slice(0, 8);
    batch.set(doc(db, 'shops', shopKey, 'dellog', op), { pw, by: device, t: now, sale: id, ...change });
    batch.update(doc(salesCol(), id), { ...change, delOp: op, ...(change.delState === 'none' ? { restoredBy: device, restoredT: now } : { delBy: device, delT: now }) });
  }
  await batch.commit();
}

let showDels = false;
let pendingAct = null; // { id, kind: 'restore' | 'purge' }
$('#delsBtn').onclick = () => {
  showDels = !showDels;
  $('#delsBtn').textContent = showDels ? '削除済みを閉じる' : '削除済み';
  $('#delsList').hidden = !showDels;
  $('#hist').hidden = showDels;
  $('#selStart').hidden = showDels;
  pendingAct = null;
  $('#restoreRow').hidden = true;
  $('#histMsg').textContent = '';
  renderDels();
};
function renderDels() {
  if (!showDels) return;
  const ds = sales.filter(isDel).sort((a, b) => (b.delT || 0) - (a.delT || 0));
  $('#delsList').innerHTML = ds.length ? ds.map(s => {
    const st = stOf(s);
    const tag = s.purgeReq ? '完全削除を依頼中' : st === 'requested' ? '削除リクエスト中' : '削除済み';
    return `
    <div class="sale void ${pendingAct?.id === s.id ? 'picked' : ''}">
      <div class="meta">${s.delT ? hm(s.delT) : ''} ${esc(s.delBy || '')}<span class="tag">${tag}</span>（会計 ${hm(s.t)} ${esc(s.dev)}）</div>
      <div class="act">
        <button data-rid="${s.id}" data-k="restore">戻す</button>
        ${s.purgeReq ? '' : `<button data-rid="${s.id}" data-k="purge">完全削除を依頼</button>`}
      </div>
      <div class="its">${itemsText(s)}</div>
      <div><div class="tot">${yen(s.total)}</div><div class="pay">預 ${yen(s.paid)}／釣 ${yen(s.change)}</div></div>
    </div>`;
  }).join('') : '<div class="empty">削除済みの履歴はありません</div>';
}
$('#delsList').addEventListener('click', e => {
  const b = e.target.closest('button[data-rid]');
  if (!b) return;
  pendingAct = { id: b.dataset.rid, kind: b.dataset.k };
  $('#restoreRow').hidden = false;
  $('#restoreGo').textContent = pendingAct.kind === 'restore' ? '戻す' : '完全削除を依頼';
  $('#histMsg').textContent = pendingAct.kind === 'restore'
    ? '履歴に戻すには削除パスワードを入力してください'
    : '完全な削除は管理者が行います。依頼するには削除パスワードを入力してください';
  $('#restorePw').focus();
  renderDels();
});
$('#restorePw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#restoreGo').click(); });
$('#restoreGo').onclick = async () => {
  const pw = $('#restorePw').value;
  const msg = $('#histMsg');
  if (!pw || !pendingAct) return;
  if (!navigator.onLine || fromCache) { msg.textContent = '電波のある場所で行ってください'; return; }
  $('#restoreGo').disabled = true;
  try {
    if (pendingAct.kind === 'restore') {
      await setDelState([pendingAct.id], pw, { delState: 'none', purgeReq: false });
      msg.textContent = '履歴に戻しました';
    } else {
      await setDelState([pendingAct.id], pw, { delState: 'deleted', purgeReq: true });
      msg.textContent = '管理者に完全削除を依頼しました';
    }
    pendingAct = null;
    $('#restoreRow').hidden = true;
  } catch (e) {
    msg.textContent = e.code === 'permission-denied' ? 'パスワードが違います' : 'できませんでした（通信を確認してください）';
  }
  $('#restorePw').value = '';
  $('#restoreGo').disabled = false;
  renderDels();
};
$('#selStart').onclick = () => { selecting = true; $('#histMsg').textContent = ''; renderSel(); renderHist(); };
$('#selCancel').onclick = endSel;
$('#selDel').onclick = () => { $('#delPwRow').hidden = false; $('#delPw').focus(); };
$('#delPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#delGo').click(); });
$('#delGo').onclick = async () => {
  const pw = $('#delPw').value;
  const ids = [...picked];
  if (!pw || !ids.length) return;
  const msg = $('#histMsg');
  // オフラインだとパスワードの照合ができないので、通信できるときだけ
  if (!navigator.onLine || fromCache) { msg.textContent = '削除は電波のある場所で行ってください'; return; }
  $('#delGo').disabled = true;
  msg.textContent = '削除中…';
  try {
    await setDelState(ids, pw, { delState: 'deleted', purgeReq: false });
    msg.textContent = `${ids.length}件削除しました（「削除済み」に残ります）`;
    endSel();
  } catch (e) {
    msg.textContent = e.code === 'permission-denied' ? 'パスワードが違います' : '削除できませんでした（通信を確認してください）';
    $('#delPw').value = '';
  }
  $('#delGo').disabled = false;
};

/* ---------- 集計 ---------- */
let sumBuilt = false;
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
      <div class="lbl">釣り銭準備金（開始時の枚数）</div>
      <div id="floatCash" class="cash">${cashGrid()}</div>
      <div class="row"><span>釣り銭準備金</span><b id="fTotal">¥0</b></div>
      <div id="floatEdit">
        <button id="fEditBtn" class="btn">準備金を修正</button>
        <div id="fPwRow" class="selrow" hidden>
          <input id="fPw" type="password" inputmode="numeric" autocomplete="off" placeholder="締めのパスワード">
          <button id="fSave" class="btn primary">保存</button>
          <button id="fCancel" class="btn ghost">やめる</button>
        </div>
        <p id="fMsg" class="small"></p>
      </div>
      <div class="lbl" style="margin-top:12px">締めのときに数えた枚数（「締めを始める」でパスワードを入れると入力できます）</div>
      <div id="countCash" class="cash">${cashGrid()}</div>
      <div class="row"><span>数えた現金</span><b id="cCounted">¥0</b></div>
      <p class="small">あるはずの現金と差額は、締めたあとに表示されます</p>
      <div id="closeArea">
        <div id="closeLock">
          <button id="closeStart" class="btn danger big">締めを始める</button>
          <div id="closePwRow" class="selrow" hidden style="margin-top:8px">
            <input id="closePw" type="password" inputmode="numeric" autocomplete="off" placeholder="締めのパスワード">
            <button id="closeUnlock" class="btn danger">確認</button>
          </div>
        </div>
        <div id="closeFinal" class="selrow" hidden>
          <button id="closeGo" class="btn danger big" style="flex:1">締める</button>
          <button id="closeCancel" class="btn ghost">やめる</button>
        </div>
        <p id="closeMsg" class="small"></p>
      </div>
    </div>
    <div class="box"><h2>締めの記録</h2><div id="closeList" class="small">まだありません</div></div>
    <div class="box">
      <h2>その他</h2>
      <div class="tools">
        <button id="csvBtn" class="btn">CSVを保存</button>
        <button id="logoutBtn" class="btn">この端末からログアウト</button>
      </div>
      <p class="small" id="logoutNote"></p>
    </div>`;
  // 準備金の修正は締めのパスワードが必要（サーバーのルールで照合）
  $('#fEditBtn').onclick = () => {
    floatEditing = true;
    $('#fEditBtn').hidden = true;
    $('#fPwRow').hidden = false;
    $('#fMsg').textContent = '枚数を直してから、締めのパスワードを入れて「保存」を押してください';
    renderFloatInputs();
  };
  $('#fCancel').onclick = () => endFloatEdit('');
  $('#floatCash').addEventListener('input', () => { if (floatEditing) $('#fTotal').textContent = yen(sumCounts(readCounts($('#floatCash')))); });
  $('#fPw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#fSave').click(); });
  $('#fSave').onclick = async () => {
    const pw = $('#fPw').value;
    const counts = readCounts($('#floatCash'));
    const float = sumCounts(counts);
    if (!pw) return;
    if (float <= 0) { $('#fMsg').textContent = '準備金を入力してください'; return; }
    if (!navigator.onLine || fromCache) { $('#fMsg').textContent = '修正は電波のある場所で行ってください'; return; }
    const op = Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
    $('#fSave').disabled = true;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'shops', shopKey, 'closeauth', op), { pw, by: device, t: Date.now(), kind: 'float' });
      batch.set(settingsDoc(), { floatCounts: counts, float, floatOp: op, floatBy: device, floatT: Date.now() }, { merge: true });
      await batch.commit();
      endFloatEdit('準備金を修正しました');
    } catch (e) {
      $('#fMsg').textContent = e.code === 'permission-denied' ? 'パスワードが違います' : '保存できませんでした（通信を確認してください）';
      $('#fPw').value = '';
    }
    $('#fSave').disabled = false;
  };
  $('#countCash').addEventListener('input', e => { cash[e.target.dataset.d] = Number(e.target.value || 0); renderCash(); });
  $('#closeStart').onclick = () => { $('#closePwRow').hidden = false; $('#closePw').focus(); };
  $('#closePw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#closeUnlock').click(); });
  $('#closeUnlock').onclick = unlockClose;
  $('#closeCancel').onclick = () => lockClose('');
  $('#closeGo').onclick = doClose;
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
  renderCloseLock();
  renderOpen();
  renderCloses();
}

function renderSum() {
  if (!shopKey) return;
  if (!sumBuilt) buildSum();
  const live = sales.filter(s => !s.void && !isDel(s));
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
  const names = [...new Set([device, ...Object.keys(settings.devices || {}), ...Object.keys(devs)])];
  $('#byDev').innerHTML = `<table><tr><th>端末</th><th>会計数</th><th>売上</th></tr>${
    names.map(n => `<tr><td>${esc(n)}</td><td>${devs[n]?.n || 0}</td><td>${yen(devs[n]?.y || 0)}</td></tr>`).join('')}</table>`;

  renderFloatInputs();
  renderCash();
}

// 準備金の欄は「修正」中だけ入力できる。修正中は他端末の更新で上書きしない
let floatEditing = false;
function renderFloatInputs() {
  $('#floatCash').querySelectorAll('input').forEach(i => {
    i.disabled = !floatEditing;
    if (!floatEditing) { const n = Number(settings.floatCounts?.[i.dataset.d] || 0); i.value = n ? n : ''; }
  });
}
function endFloatEdit(text) {
  floatEditing = false;
  $('#fPw').value = '';
  $('#fPwRow').hidden = true;
  $('#fEditBtn').hidden = false;
  $('#fMsg').textContent = text;
  renderFloatInputs();
  renderCash();
}

function renderCash() {
  if (!floatEditing) $('#fTotal').textContent = yen(settings.float || 0);
  // あるはずの現金・差額は締める前には出さない（締めの結果として表示）
  $('#cCounted').textContent = yen(DENOMS.reduce((t, d) => t + d * (cash[d] || 0), 0));
}
const diffText = d => (d > 0 ? '+' : d < 0 ? '−' : '') + yen(Math.abs(d)) + (d === 0 ? '（一致）' : d > 0 ? '（多い）' : '（足りない）');

/* ---------- 締める・開ける ---------- */
// 締めのパスワードはサーバーのルールで照合する（このコードには書かない）
const sessionSales = () => sales.filter(s => !s.void && !isDel(s) && s.t >= (settings.openedAt || 0));
let closes = [];
let closesOn = false;

// 数えた枚数の入力は、締めのパスワードをサーバーで確認できてから
let closePwOk = null;
async function unlockClose() {
  const pw = $('#closePw').value;
  const msg = $('#closeMsg');
  if (!pw) return;
  if (!navigator.onLine || fromCache) { msg.textContent = '締めは電波のある場所で行ってください'; return; }
  const op = Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
  $('#closeUnlock').disabled = true;
  try {
    await setDoc(doc(db, 'shops', shopKey, 'closeauth', op), { pw, by: device, t: Date.now(), kind: 'unlock' });
    closePwOk = pw;
    msg.textContent = '数えた枚数を入力して「締める」を押してください';
    renderCloseLock();
  } catch (e) {
    msg.textContent = e.code === 'permission-denied' ? 'パスワードが違います' : '確認できませんでした（通信を確認してください）';
  }
  $('#closePw').value = '';
  $('#closeUnlock').disabled = false;
}
function lockClose(text) {
  closePwOk = null;
  DENOMS.forEach(d => { cash[d] = 0; });
  document.querySelectorAll('#countCash input').forEach(i => { i.value = ''; });
  $('#closePwRow').hidden = true;
  $('#closeMsg').textContent = text;
  renderCloseLock();
  renderCash();
}
function renderCloseLock() {
  const unlocked = !!closePwOk;
  $('#closeLock').hidden = unlocked;
  $('#closeFinal').hidden = !unlocked;
  document.querySelectorAll('#countCash input').forEach(i => { i.disabled = !unlocked; });
}

async function doClose() {
  const pw = closePwOk;
  const msg = $('#closeMsg');
  if (!pw) return;
  if (!navigator.onLine || fromCache) { msg.textContent = '締めは電波のある場所で行ってください'; return; }
  if (sales.some(s => s.pending)) { msg.textContent = '未送信の会計があります。送信が終わってから締めてください'; return; }
  const counted = DENOMS.reduce((t, d) => t + d * (cash[d] || 0), 0);
  const ss = sessionSales();
  const total = ss.reduce((t, s) => t + s.total, 0);
  const expected = Number(settings.float || 0) + total;
  const now = Date.now();
  const cid = now.toString(36) + '-' + crypto.randomUUID().slice(0, 8);
  $('#closeGo').disabled = true;
  msg.textContent = '締めています…';
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'shops', shopKey, 'closeauth', cid), { pw, by: device, t: now });
    batch.set(doc(db, 'shops', shopKey, 'closes', cid), {
      openedAt: settings.openedAt || 0, closedAt: now, by: device,
      float: Number(settings.float || 0), floatCounts: settings.floatCounts || {},
      sales: total, count: ss.length, expected, counted, countCounts: { ...cash }, diff: counted - expected,
    });
    batch.set(settingsDoc(), { open: false, closeId: cid, closedAt: now }, { merge: true });
    await batch.commit();
    lockClose('');
  } catch (e) {
    msg.textContent = e.code === 'permission-denied' ? 'パスワードが違います' : '締められませんでした（通信を確認してください）';
  }
  $('#closeGo').disabled = false;
}

$('#openCash').innerHTML = cashGrid();
$('#openCash').addEventListener('input', () => {
  const v = sumCounts(readCounts($('#openCash')));
  $('#openTotal').textContent = yen(v);
  $('#openBtn').disabled = v <= 0;
});
$('#openBtn').disabled = true;
$('#openBtn').onclick = () => {
  const counts = readCounts($('#openCash'));
  if (sumCounts(counts) <= 0) return;
  const v = { open: true, openedAt: Date.now(), floatCounts: counts, float: sumCounts(counts) };
  settings = { ...settings, ...v };
  setDoc(settingsDoc(), v, { merge: true }).catch(() => renderSync(true));
  document.querySelectorAll('#openCash input').forEach(i => { i.value = ''; });
  $('#openTotal').textContent = '¥0';
  $('#openBtn').disabled = true;
  renderOpen();
  renderSum();
};

function renderOpen() {
  const closed = settings.open === false;
  $('#v-reg').classList.toggle('closed', closed);
  $('#closedPanel').hidden = !closed;
  if (closed) $('#closedAt').textContent = settings.closedAt ? `${hm(settings.closedAt)} に締めました。次に始めるときは、釣り銭の枚数を入れて「開ける」を押してください。` : '';
  renderLastClose();
  if (sumBuilt) {
    $('#closeArea').hidden = closed;
    $('#floatEdit').hidden = closed;
    if (closed && floatEditing) endFloatEdit('');
  }
  if (!closesOn && shopKey) {
    closesOn = true;
    onSnapshot(collection(db, 'shops', shopKey, 'closes'), snap => {
      closes = snap.docs.map(d => d.data()).sort((a, b) => b.closedAt - a.closedAt);
      renderCloses();
    });
  }
}

// 締め済み画面に、直前の締めの結果（あるはずの現金・差額）を出す
function renderLastClose() {
  const c = closes.find(x => x.closedAt === settings.closedAt) || closes[0];
  const el = $('#lastClose');
  if (settings.open !== false || !c) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="row"><span>売上（${hm(c.openedAt)} 〜 ${hm(c.closedAt)}）</span><b>${yen(c.sales)}</b></div>
    <div class="row"><span>釣り銭準備金</span><b>${yen(c.float)}</b></div>
    <div class="row"><span>あるはずの現金</span><b>${yen(c.expected)}</b></div>
    <div class="row"><span>数えた現金</span><b>${yen(c.counted)}</b></div>
    <div class="row"><span>差額</span><span class="diff ${c.diff === 0 ? 'ok' : 'ng'}">${diffText(c.diff)}</span></div>`;
}
function renderCloses() {
  renderLastClose();
  if (!sumBuilt) return;
  $('#closeList').innerHTML = closes.length ? `<table class="closes"><tr><th>締め</th><th>売上</th><th>あるはず</th><th>数えた</th><th>差額</th></tr>${
    closes.map(c => `<tr><td>${hm(c.closedAt)}<br>${esc(c.by)}</td><td>${yen(c.sales)}</td><td>${yen(c.expected)}</td><td>${yen(c.counted)}</td><td>${c.diff > 0 ? '+' : c.diff < 0 ? '−' : ''}${yen(Math.abs(c.diff))}</td></tr>`).join('')}</table>` : 'まだありません';
}

function downloadCsv() {
  const head = ['日時', '端末', '状態', ...PRODUCTS.map(p => p.s), '合計', '預かり', 'お釣り'];
  const lines = [...sales].reverse().map(s => {
    const d = new Date(s.t);
    return [
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.toTimeString().slice(0, 8)}`,
      s.dev, isDel(s) ? '削除' : s.void ? '取消' : '', ...PRODUCTS.map(p => s.items?.[p.id] || ''), s.total, s.paid, s.change,
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
