import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore, collectionGroup, doc, getDocFromServer, setDoc, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, PRODUCTS } from './common.js?v=16';

const P = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const $ = s => document.querySelector(s);
const yen = n => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = t => { if (!t) return '—'; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const stOf = s => s.delState || (s.deleted ? 'deleted' : 'none');
const isDel = s => stOf(s) !== 'none';
const itemsText = s => Object.entries(s.items || {}).map(([id, q]) => `${esc(P[id]?.s || id)}×${q}`).join('、');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- ログイン ---------- */
// ID・パスワードはサーバーのルールで照合する（このコードには書かない）
const adminDoc = uid => doc(db, 'admins', uid);
let started = false;
let loggingIn = false;
// 管理者かどうかは必ずサーバーに確認する（端末内の未確定の書き込みでは判断しない）
onAuthStateChanged(auth, async user => {
  if (loggingIn) return;
  if (user) {
    try {
      if ((await getDocFromServer(adminDoc(user.uid))).exists()) { showApp(); return; }
    } catch {}
  }
  $('#login').hidden = false;
});
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
$('#loginBtn').onclick = async () => {
  const id = $('#uid').value.trim();
  const pw = $('#pw').value;
  const msg = $('#loginMsg');
  if (!id || !pw) { msg.textContent = 'User ID とパスワードを入力してください'; return; }
  msg.textContent = '確認中…';
  loggingIn = true;
  try {
    const cred = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
    await setDoc(adminDoc(cred.user.uid), { id, pw, t: Date.now() });
    if (!(await getDocFromServer(adminDoc(cred.user.uid))).exists()) throw { code: 'permission-denied' };
    msg.textContent = '';
    showApp();
  } catch (e) {
    msg.textContent = e.code === 'permission-denied' ? 'User ID またはパスワードが違います'
      : e.code === 'auth/operation-not-allowed' || e.code === 'auth/configuration-not-found' ? 'ログインの設定がまだ有効になっていません'
      : '通信できませんでした';
    $('#pw').value = '';
  }
  loggingIn = false;
};
$('#logoutBtn').onclick = async () => { await signOut(auth); location.reload(); };

/* ---------- データ ---------- */
// 全ての販売記録（セッション）をまたいで読む。キーは shops/{key}
let shops = {};   // key -> settings
let sales = [];   // { key, id, ...data }
let closes = [];  // { key, ...data }
const keyOf = ref => ref.parent.parent.id;

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (started) return;
  started = true;
  onSnapshot(collectionGroup(db, 'meta'), snap => {
    shops = {};
    snap.docs.filter(d => d.id === 'settings').forEach(d => { shops[keyOf(d.ref)] = d.data(); });
    render();
  }, err => showErr(err));
  onSnapshot(collectionGroup(db, 'sales'), snap => {
    sales = snap.docs.map(d => ({ key: keyOf(d.ref), id: d.id, ...d.data() })).sort((a, b) => b.t - a.t);
    render();
  }, err => showErr(err));
  onSnapshot(collectionGroup(db, 'closes'), snap => {
    closes = snap.docs.map(d => ({ key: keyOf(d.ref), ...d.data() })).sort((a, b) => b.closedAt - a.closedAt);
    render();
  }, err => showErr(err));
}
function showErr(err) {
  // 権限がない（管理者でない）ときはログイン画面に戻す
  if (err.code === 'permission-denied') { $('#app').hidden = true; $('#login').hidden = false; started = false; return; }
  $('#reqList').innerHTML = `<div class="empty">読み込めませんでした（${esc(err.code || err.message)}）</div>`;
}
const label = key => shops[key]?.label || `（名前なし ${key.slice(0, 6)}）`;

/* ---------- 画面切替 ---------- */
document.querySelector('.tabs').addEventListener('click', e => {
  const v = e.target.dataset.v;
  if (!v) return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  ['req', 'shops'].forEach(x => { $('#v-' + x).hidden = x !== v; });
});

function render() { renderReq(); renderShops(); }

/* ---------- 削除リクエスト ---------- */
function renderReq() {
  const rs = sales.filter(isDel).sort((a, b) => (b.delT || 0) - (a.delT || 0));
  $('#reqList').innerHTML = rs.length ? rs.map(s => {
    const tag = s.purgeReq ? '完全削除の依頼（パスワード確認済み）' : stOf(s) === 'requested' ? '削除リクエスト' : '削除済み（パスワード確認済み）';
    return `
    <div class="sale">
      <div class="meta"><b>${esc(label(s.key))}</b><span class="tag">${tag}</span></div>
      <div class="act"></div>
      <div class="its">会計 ${hm(s.t)} ${esc(s.dev)}<br>${itemsText(s)}<br><span class="small">${hm(s.delT)} ${esc(s.delBy || '')} が操作</span></div>
      <div><div class="tot">${yen(s.total)}</div><div class="pay">預 ${yen(s.paid)}／釣 ${yen(s.change)}</div></div>
      <div class="adm-act">
        <button class="btn" data-a="reject" data-k="${s.key}" data-id="${s.id}">却下（元に戻す）</button>
        <button class="btn danger" data-a="purge" data-k="${s.key}" data-id="${s.id}">完全に削除</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">削除リクエストはありません</div>';
}
// どちらも2回タップで実行（誤操作防止）。操作は adminlog に残す
$('#reqList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  if (!b.classList.contains('arm')) {
    b.classList.add('arm');
    b.dataset.label = b.textContent;
    b.textContent = 'もう一度タップ';
    setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = b.dataset.label; } }, 3000);
    return;
  }
  const { a, k, id } = b.dataset;
  const s = sales.find(x => x.key === k && x.id === id);
  if (!s) return;
  const { key, id: _id, ...sale } = s;
  const now = Date.now();
  const batch = writeBatch(db);
  batch.set(doc(db, 'shops', k, 'adminlog', `${now.toString(36)}-${id}`), { action: a, sale: id, data: sale, t: now });
  if (a === 'purge') batch.delete(doc(db, 'shops', k, 'sales', id));
  else batch.update(doc(db, 'shops', k, 'sales', id), { delState: 'none', deleted: false, purgeReq: false, rejected: true, rejectT: now });
  b.disabled = true;
  try { await batch.commit(); } catch (err) { b.disabled = false; b.textContent = 'できませんでした'; }
});

/* ---------- セッション一覧 ---------- */
const open = new Set();
function renderShops() {
  const keys = Object.keys(shops).sort((a, b) => (shops[b].created || shops[b].openedAt || 0) - (shops[a].created || shops[a].openedAt || 0));
  if (!keys.length) { $('#shopList').innerHTML = '<div class="empty">まだありません</div>'; return; }
  $('#shopList').innerHTML = keys.map(k => {
    const st = shops[k];
    const ss = sales.filter(s => s.key === k);
    const live = ss.filter(s => !s.void && !isDel(s));
    const total = live.reduce((t, s) => t + s.total, 0);
    const dels = ss.filter(isDel).length;
    const cs = closes.filter(c => c.key === k);
    const isOpen = st.open !== false && !st.ended;
    const status = st.ended ? '終了' : isOpen ? '営業中' : '締め済み';
    const devs = Object.keys(st.devices || {});
    let detail = '';
    if (open.has(k)) {
      const cur = isOpen ? live.filter(s => s.t >= (st.openedAt || 0)) : [];
      const curTotal = cur.reduce((t, s) => t + s.total, 0);
      const byDev = {};
      live.forEach(s => { byDev[s.dev] = byDev[s.dev] || { n: 0, y: 0 }; byDev[s.dev].n++; byDev[s.dev].y += s.total; });
      const devNames = [...new Set([...devs, ...Object.keys(byDev)])];
      detail = `
        <div class="adm-detail">
          <div class="row"><span>セッション名</span><b>${esc(st.label || '（不明：この機能を入れる前に作られたため）')}</b></div>
          ${st.ended ? `<div class="row"><span>終了</span><b>${hm(st.endedAt)}（管理者）</b></div>` : ''}
          <h3>登録レジ（${devNames.length}台）</h3>
          <table>
            <tr><th>端末名</th><th>参加</th><th>会計</th><th>売上</th></tr>
            ${devNames.map(n => `<tr><td>${esc(n)}</td><td>${hm(st.devices?.[n])}</td><td>${byDev[n]?.n || 0}</td><td>${yen(byDev[n]?.y || 0)}</td></tr>`).join('') || '<tr><td colspan="4">記録なし</td></tr>'}
          </table>
          <h3>営業の記録</h3>
          <table>
            <tr><th>期間</th><th>会計</th><th>売上</th><th>準備金</th><th>差額</th></tr>
            ${isOpen ? `<tr><td>${hm(st.openedAt)} 〜 営業中</td><td>${cur.length}</td><td>${yen(curTotal)}</td><td>${yen(st.float)}</td><td>—</td></tr>` : ''}
            ${cs.map(c => `<tr><td>${hm(c.openedAt)} 〜 ${hm(c.closedAt)}</td><td>${c.count ?? ''}</td><td>${yen(c.sales)}</td><td>${yen(c.float)}</td><td>${c.diff > 0 ? '+' : c.diff < 0 ? '−' : ''}${yen(Math.abs(c.diff))}</td></tr>`).join('')}
          </table>
          <h3>会計の一覧（${ss.length}件）</h3>
          ${st.ended ? '' : `<div class="adm-act" style="margin:12px 0"><button class="btn danger" data-end="${k}">このセッションを強制終了</button></div>`}
          ${ss.map(s => `
            <div class="adm-sale ${s.void || isDel(s) ? 'void' : ''}">
              <span>${hm(s.t)} ${esc(s.dev)}${s.void ? '<span class="tag">取消済</span>' : ''}${isDel(s) ? `<span class="tag">${stOf(s) === 'requested' ? '削除リクエスト' : '削除済み'}</span>` : ''}${s.rejected ? '<span class="tag">削除却下</span>' : ''}<br>${itemsText(s)}</span>
              <b>${yen(s.total)}</b>
            </div>`).join('') || '<div class="small">会計はありません</div>'}
        </div>`;
    }
    return `
    <div class="box adm-shop" data-k="${k}">
      <div class="adm-head">
        <div><b>${esc(label(k))}</b><span class="tag">${status}</span><br>
          <span class="small">作成 ${hm(st.created || st.openedAt)}・端末 ${devs.length ? devs.map(esc).join('、') : '—'}</span></div>
        <div style="text-align:right"><b>${yen(total)}</b><br><span class="small">${live.length}件${dels ? `・削除 ${dels}件` : ''}</span></div>
      </div>
      ${detail}
    </div>`;
  }).join('');
}
// 強制終了：全端末で使えなくなる（データは残る）。2回タップで実行
$('#shopList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-end]');
  if (!b) return;
  e.stopPropagation();
  if (!b.classList.contains('arm')) {
    b.classList.add('arm');
    b.textContent = 'もう一度タップで終了（元に戻せません）';
    setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = 'このセッションを強制終了'; } }, 4000);
    return;
  }
  const k = b.dataset.end;
  const now = Date.now();
  b.disabled = true;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'shops', k, 'meta', 'settings'), { ended: true, open: false, endedAt: now, endedBy: 'admin' }, { merge: true });
    batch.set(doc(db, 'shops', k, 'adminlog', `${now.toString(36)}-end`), { action: 'end', t: now });
    await batch.commit();
  } catch (err) { b.disabled = false; b.textContent = 'できませんでした'; }
});
$('#shopList').addEventListener('click', e => {
  const card = e.target.closest('.adm-head');
  if (!card) return;
  const k = card.parentElement.dataset.k;
  open.has(k) ? open.delete(k) : open.add(k);
  renderShops();
});
