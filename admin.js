import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocFromServer, setDoc, deleteDoc, onSnapshot, writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, PRODUCTS, CATS, activeProducts } from './common.js?v=23';

// 商品（catalog）。読み込むまでは初期の商品
let catalog = PRODUCTS.map((p, i) => ({ ...p, order: i }));
let P = Object.fromEntries(catalog.map(p => [p.id, p]));
const genreOf = p => p.genre || CATS[p.cat] || 'その他';
const $ = s => document.querySelector(s);
const yen = n => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n || 0)).toLocaleString('ja-JP');
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
  onSnapshot(collection(db, 'catalog'), async snap => {
    // 初めてのときは、今までの9商品を取り込む
    if (snap.empty) { await seedCatalog(); return; }
    catalog = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    P = Object.fromEntries(catalog.map(p => [p.id, p]));
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
  ['req', 'shops', 'prods'].forEach(x => { $('#v-' + x).hidden = x !== v; });
});

function render() { renderReq(); renderShops(); renderProds(); }

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
    const status = st.ended ? '終了' : isOpen ? '営業中' : st.closedAt ? '締め済み' : '未開始';
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
          <h3>扱う商品（${Array.isArray(st.products) ? st.products.length : 'すべて'}）</h3>
          <div class="small">${(Array.isArray(st.products) ? st.products.map(id => P[id]) : activeProducts(catalog)).filter(Boolean).map(p => esc(p.s || p.name)).join('、') || 'なし'}</div>
          <div class="adm-act" style="margin:12px 0 0"><button class="btn primary" data-manual="${k}">記録されなかった会計を手入力</button></div>
          ${st.ended ? '' : `<div class="adm-act" style="margin:12px 0">
            <button class="btn" data-prods="${k}">扱う商品を変える</button>
            <button class="btn danger" data-end="${k}">このセッションを強制終了</button></div>`}
          ${ss.map(s => `
            <div class="adm-sale ${s.void || isDel(s) ? 'void' : ''}">
              <span>${hm(s.t)} ${esc(s.dev)}${s.manual ? '<span class="tag">手入力</span>' : ''}${s.void ? '<span class="tag">取消済</span>' : ''}${isDel(s) ? `<span class="tag">${stOf(s) === 'requested' ? '削除リクエスト' : '削除済み'}</span>` : ''}${s.rejected ? '<span class="tag">削除却下</span>' : ''}<br>${itemsText(s)}</span>
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
$('#shopList').addEventListener('click', e => {
  const b = e.target.closest('button[data-manual]');
  if (!b) return;
  e.stopPropagation();
  openManualSheet(b.dataset.manual);
});
$('#shopList').addEventListener('click', e => {
  const b = e.target.closest('button[data-prods]');
  if (!b) return;
  e.stopPropagation();
  openSessionSheet(b.dataset.prods);
});
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

/* ---------- 下から出るシート ---------- */
const sheet = $('#sheet');
const closeSheet = () => { sheet.hidden = true; $('#sheetBody').innerHTML = ''; };
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
const uid36 = () => Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 6);

// 会計画面と同じ見た目の商品カード
const card = (p, extra = '') => `
  <span class="ph-btn"><img class="ph" src="${p.img || ''}" alt=""></span>
  <span class="cat ${p.cat || ''}">${esc(genreOf(p))}</span>
  <span class="nm">${esc(p.name)}</span>
  <span class="pr">${yen(p.price)}${p.stock != null ? `<span class="small">　在庫 ${p.stock}</span>` : ''}</span>${extra}`;

/* ---------- 商品 ---------- */
let showArch = false;
$('#showArch').onclick = () => { showArch = !showArch; $('#showArch').textContent = showArch ? '削除した商品を隠す' : '削除した商品を表示'; renderProds(); };
function renderProds() {
  const list = [...catalog].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter(p => showArch || !p.archived);
  $('#prodGrid').innerHTML = list.map(p => `<div class="item ${p.archived ? 'arch' : ''}" data-pid="${p.id}">${card(p, p.archived ? '<span class="small" style="padding:0 6px 6px">削除済み</span>' : '')}</div>`).join('')
    + '<div class="item add" data-pid="">＋ 商品を追加</div>';
}
$('#prodGrid').addEventListener('click', e => {
  const c = e.target.closest('.item');
  if (c) openProdSheet(c.dataset.pid || null);
});

async function seedCatalog() {
  const batch = writeBatch(db);
  PRODUCTS.forEach((p, i) => batch.set(doc(db, 'catalog', p.id), { ...p, genre: CATS[p.cat], order: i, created: Date.now() }));
  try { await batch.commit(); } catch {}
}

// 写真は端末で縮小してから保存（最大 600px の JPEG）
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function openProdSheet(pid) {
  const p = pid ? P[pid] : { name: '', genre: '', price: '', stock: '', img: '' };
  const genres = [...new Set(catalog.map(genreOf))];
  let img = p.img || '';
  $('#sheetBody').innerHTML = `
    <div class="sheet-head"><button class="btn ghost" id="pBack">戻る</button><span>${pid ? '商品を編集' : '商品を追加'}</span><span></span></div>
    <div class="form">
      <label class="ph-pick"><img id="pImg" src="${esc(img)}" alt="" ${img ? '' : 'hidden'}><span id="pImgHint">${img ? 'タップで写真を変える' : 'タップで写真を選ぶ'}</span><input id="pFile" type="file" accept="image/*"></label>
      <label>商品名<input id="pName" value="${esc(p.name)}" maxlength="40"></label>
      <label>短い名前（履歴・集計で使う。空なら商品名）<input id="pShort" value="${esc(p.s && p.s !== p.name ? p.s : '')}" maxlength="20"></label>
      <label>ジャンル<input id="pGenre" value="${esc(pid ? genreOf(p) : '')}" list="genreList" maxlength="20" placeholder="例：カレンダー"></label>
      <datalist id="genreList">${genres.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <label>値段（円）<input id="pPrice" type="number" inputmode="numeric" min="0" value="${p.price ?? ''}"></label>
      <label>在庫（目安。空なら表示しない）<input id="pStock" type="number" inputmode="numeric" min="0" value="${p.stock ?? ''}"></label>
      <p id="pMsg" class="msg"></p>
      <div class="sheet-actions">
        ${pid ? `<button class="btn" id="pUp">← 前へ</button><button class="btn" id="pDown">後ろへ →</button>` : ''}
      </div>
      <button class="btn primary big" id="pSave">保存</button>
      ${pid ? (p.archived ? '<button class="btn big" id="pRestore">削除を取り消して戻す</button>' : '<button class="btn danger big" id="pDel">この商品を削除</button>') : ''}
    </div>`;
  sheet.hidden = false;
  $('#pBack').onclick = closeSheet;
  $('#pFile').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      img = await shrink(f);
      $('#pImg').src = img; $('#pImg').hidden = false; $('#pImgHint').textContent = 'タップで写真を変える';
    } catch { $('#pMsg').textContent = '写真を読み込めませんでした'; }
  };
  $('#pSave').onclick = async () => {
    const name = $('#pName').value.trim();
    const price = Number($('#pPrice').value);
    const stockV = $('#pStock').value.trim();
    if (!name) { $('#pMsg').textContent = '商品名を入力してください'; return; }
    if (!Number.isFinite(price) || price < 0 || $('#pPrice').value === '') { $('#pMsg').textContent = '値段を入力してください'; return; }
    const data = {
      name, s: $('#pShort').value.trim() || name, genre: $('#pGenre').value.trim() || 'その他',
      price: Math.round(price), stock: stockV === '' ? null : Math.max(0, Math.round(Number(stockV))), img,
      order: pid ? (p.order ?? 0) : Math.max(0, ...catalog.map(x => x.order ?? 0)) + 1, updated: Date.now(),
    };
    $('#pSave').disabled = true;
    try {
      await setDoc(doc(db, 'catalog', pid || 'p-' + uid36()), data, { merge: true });
      closeSheet();
    } catch (e) { $('#pMsg').textContent = '保存できませんでした（' + (e.code || '') + '）'; $('#pSave').disabled = false; }
  };
  // 並び順：となりの商品と入れ替える
  const move = async dir => {
    const list = activeProducts(catalog);
    const i = list.findIndex(x => x.id === pid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const batch = writeBatch(db);
    list.forEach((x, n) => { const o = n === i ? j : n === j ? i : n; if ((x.order ?? -1) !== o) batch.set(doc(db, 'catalog', x.id), { order: o }, { merge: true }); });
    await batch.commit();
  };
  if (pid) { $('#pUp').onclick = () => move(-1); $('#pDown').onclick = () => move(1); }
  // 削除：会計画面から消える（過去の売上の名前は残る）。2回タップ
  if ($('#pDel')) $('#pDel').onclick = async () => {
    const b = $('#pDel');
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'もう一度タップで削除'; return; }
    await setDoc(doc(db, 'catalog', pid), { archived: true, updated: Date.now() }, { merge: true });
    closeSheet();
  };
  if ($('#pRestore')) $('#pRestore').onclick = async () => {
    await setDoc(doc(db, 'catalog', pid), { archived: false, updated: Date.now() }, { merge: true });
    closeSheet();
  };
}

/* ---------- セッションを作る／扱う商品を変える ---------- */
// セッション名から販売記録と同じ方法でキーを作る
async function keyOfName(name) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pf-register|' + name));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
$('#newSession').onclick = () => openSessionSheet(null);
function openSessionSheet(key) {
  const st = key ? shops[key] : null;
  const list = activeProducts(catalog);
  const picked = new Set(st && Array.isArray(st.products) ? st.products : list.map(p => p.id));
  $('#sheetBody').innerHTML = `
    <div class="sheet-head"><button class="btn ghost" id="sBack">戻る</button><span>${key ? '扱う商品を変える' : '新しいセッション'}</span><span></span></div>
    <div class="form">
      ${key ? `<div class="row"><span>セッション名</span><b>${esc(label(key))}</b></div>` : '<label>セッション名（部員はこの名前を入力して参加します）<input id="sName" maxlength="40" autocapitalize="off" autocorrect="off" spellcheck="false"></label>'}
      <div class="row"><span>扱う商品（タップで選ぶ）</span><span><button class="btn ghost" id="sAll" style="padding:4px 8px">全部</button><button class="btn ghost" id="sNone" style="padding:4px 8px">なし</button></span></div>
      <div class="adm-grid" id="sGrid" style="padding:0"></div>
      <p id="sMsg" class="msg"></p>
      <button class="btn primary big" id="sSave">${key ? '保存' : '作成'}</button>
    </div>`;
  const draw = () => {
    $('#sGrid').innerHTML = list.map(p => `<div class="item pick ${picked.has(p.id) ? 'on' : ''}" data-pid="${p.id}">${card(p, '<span class="chk2">✓</span>')}</div>`).join('');
  };
  draw();
  sheet.hidden = false;
  $('#sBack').onclick = closeSheet;
  $('#sGrid').onclick = e => { const c = e.target.closest('.item'); if (!c) return; const id = c.dataset.pid; picked.has(id) ? picked.delete(id) : picked.add(id); draw(); };
  $('#sAll').onclick = () => { list.forEach(p => picked.add(p.id)); draw(); };
  $('#sNone').onclick = () => { picked.clear(); draw(); };
  $('#sSave').onclick = async () => {
    const msg = $('#sMsg');
    if (!picked.size) { msg.textContent = '商品を1つ以上選んでください'; return; }
    const products = list.filter(p => picked.has(p.id)).map(p => p.id);
    $('#sSave').disabled = true;
    try {
      if (key) {
        await setDoc(doc(db, 'shops', key, 'meta', 'settings'), { products }, { merge: true });
      } else {
        const name = $('#sName').value.trim();
        if (name.length < 2) { msg.textContent = 'セッション名を2文字以上で入力してください'; $('#sSave').disabled = false; return; }
        const k = await keyOfName(name);
        if ((await getDoc(doc(db, 'shops', k, 'meta', 'settings'))).exists()) {
          msg.textContent = 'このセッション名はすでに使われています'; $('#sSave').disabled = false; return;
        }
        // 開始時はまだ開いていない。最初の端末が釣り銭の枚数を入れて「開ける」
        await setDoc(doc(db, 'shops', k, 'meta', 'settings'), {
          label: name, products, open: false, float: 0, floatCounts: {}, created: Date.now(), createdBy: 'admin',
        });
      }
      closeSheet();
    } catch (e) { msg.textContent = '保存できませんでした（' + (e.code || '') + '）'; $('#sSave').disabled = false; }
  };
}

/* ---------- 記録されなかった会計を手入力 ---------- */
// 会計画面と同じ − ／ ＋ で数を入れる。日時と理由も残す。売上・集計に入り、履歴には「手入力」と出る
const toLocalInput = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function openManualSheet(key) {
  const st = shops[key];
  const ids = Array.isArray(st.products) ? st.products : activeProducts(catalog).map(p => p.id);
  const list = ids.map(id => P[id]).filter(Boolean);
  const qty = {};
  // 既定の日時：締め済みなら締めの1分前（その営業の売上に入るように）、それ以外は今
  const defT = st.open === false && st.closedAt ? st.closedAt - 60000 : Date.now();
  $('#sheetBody').innerHTML = `
    <div class="sheet-head"><button class="btn ghost" id="mBack">戻る</button><span>会計を手入力</span><span></span></div>
    <div class="form">
      <div class="row"><span>セッション</span><b>${esc(label(key))}</b></div>
      <div class="adm-grid" id="mGrid" style="padding:0"></div>
      <div class="row"><span>合計</span><b id="mTotal" style="font-size:22px">¥0</b></div>
      <label>会計の日時<input id="mTime" type="datetime-local" value="${toLocalInput(defT)}"></label>
      <label>理由・メモ<input id="mNote" maxlength="80" placeholder="例：15:20以降の記録漏れ（商品の残りから確認）"></label>
      <p class="small">締めのあとに入力した場合、締めの記録（あるはずの現金・差額）は変わりません。売上合計と商品別の集計には入ります。</p>
      <p id="mMsg" class="msg"></p>
      <button class="btn primary big" id="mSave" disabled>この会計を記録する</button>
    </div>`;
  const total = () => list.reduce((t, p) => t + (qty[p.id] || 0) * p.price, 0);
  const draw = () => {
    $('#mGrid').innerHTML = list.map(p => `
      <div class="item ${qty[p.id] ? 'sel' : ''}" data-pid="${p.id}" style="cursor:default">
        ${card(p)}
        <div class="stepper">
          <button data-act="minus" ${qty[p.id] ? '' : 'disabled'}>−</button>
          <span class="qty">${qty[p.id] || 0}</span>
          <button data-act="plus">＋</button>
        </div>
      </div>`).join('');
    $('#mTotal').textContent = yen(total());
    $('#mSave').disabled = !total() && !Object.values(qty).some(Boolean);
  };
  draw();
  sheet.hidden = false;
  $('#mBack').onclick = closeSheet;
  $('#mGrid').onclick = e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('.item').dataset.pid;
    qty[id] = Math.max(0, (qty[id] || 0) + (b.dataset.act === 'plus' ? 1 : -1));
    if (!qty[id]) delete qty[id];
    draw();
  };
  $('#mSave').onclick = async () => {
    const items = Object.fromEntries(Object.entries(qty).filter(([, q]) => q > 0));
    if (!Object.keys(items).length) return;
    const t = new Date($('#mTime').value).getTime();
    if (!Number.isFinite(t)) { $('#mMsg').textContent = '日時を入力してください'; return; }
    const sum = total();
    const now = Date.now();
    const id = 'm-' + now.toString(36) + '-' + crypto.randomUUID().slice(0, 6);
    $('#mSave').disabled = true;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'shops', key, 'sales', id), {
        items, prices: Object.fromEntries(Object.keys(items).map(i => [i, P[i].price])),
        total: sum, paid: sum, change: 0, t, at: now, dev: '管理者（手入力）', void: false,
        manual: true, note: $('#mNote').value.trim(),
      });
      batch.set(doc(db, 'shops', key, 'adminlog', `${now.toString(36)}-manual`), { action: 'manual', sale: id, total: sum, t: now });
      await batch.commit();
      closeSheet();
    } catch (e) { $('#mMsg').textContent = '記録できませんでした（' + (e.code || '') + '）'; $('#mSave').disabled = false; }
  };
}
