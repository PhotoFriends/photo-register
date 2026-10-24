// 販売記録・管理画面で共通の設定
export const firebaseConfig = {
  apiKey: 'AIzaSyByNolalAuk-d6LHBwENVrshE7QpKo4Jss',
  authDomain: 'pf-register-1023.firebaseapp.com',
  projectId: 'pf-register-1023',
  storageBucket: 'pf-register-1023.firebasestorage.app',
  messagingSenderId: '944810320688',
  appId: '1:944810320688:web:0f0916483880318fd91ef5',
};

// 初期の商品（管理画面で最初に取り込む。以後はデータベースの catalog を使う）
// 在庫は「残り」の目安表示にだけ使う
export const PRODUCTS = [
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
export const CATS = { cal: 'カレンダー', cf: 'クリアファイル', pc: 'ポストカード', bk: '写真集', other: 'その他' };
export const DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

// データベースの商品を並び順に（削除済みは除く）
export const activeProducts = list => list.filter(p => !p.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// 売上高との比較（締めごと）
// 用意していたお金（開始時）と締めのときのお金を種類ごとに比べ、増えたお金をその期間の売上高と比べる。
// 売上高は締めた時点の記録ではなく今の会計から数え直す（あとから手入力・補正した分も入る）。
const fmtYen = n => (n < 0 ? '−' : '') + '¥' + Math.abs(Math.round(n || 0)).toLocaleString('ja-JP');
const signed = n => (n > 0 ? '+' : '') + (n < 0 ? '−' : '') + Math.abs(n);
const isLive = s => !s.void && (s.delState || (s.deleted ? 'deleted' : 'none')) === 'none';
const DEN_NAME = { 10000: '1万円札', 5000: '5千円札', 1000: '千円札', 500: '500円玉', 100: '100円玉', 50: '50円玉', 10: '10円玉', 5: '5円玉', 1: '1円玉' };
export function compareHTML(c, sales, hm) {
  // 取り消した締め：記録は残すが比較には使わない
  if (c.cancelled) return `
    <div class="cmp cancelled">
      <div class="cmp-head"><b>${hm(c.openedAt)} 〜 ${hm(c.closedAt)}</b><span class="tag">取り消し</span></div>
      <p class="small">この締めは ${hm(c.cancelledAt)} に取り消され、営業を続けています。そのとき数えたお金は ${fmtYen(c.counted)} でした（比較には使っていません）。</p>
    </div>`;
  const inPeriod = sales.filter(s => isLive(s) && s.t >= (c.openedAt || 0) && s.t <= c.closedAt);
  const salesNow = inPeriod.reduce((t, s) => t + s.total, 0);
  const fc = c.floatCounts || {}, cc = c.countCounts || {};
  const rows = DENOMS.filter(d => Number(fc[d]) || Number(cc[d])).map(d => {
    const a = Number(fc[d]) || 0, b = Number(cc[d]) || 0;
    return `<tr><td>${DEN_NAME[d]}</td><td>${a}</td><td>${b}</td><td>${signed(b - a)}</td><td>${fmtYen((b - a) * d)}</td></tr>`;
  }).join('');
  const gained = (c.counted || 0) - (c.float || 0);
  const diff = gained - salesNow;
  const changed = salesNow !== c.sales;
  return `
    <div class="cmp">
      <div class="cmp-head"><b>${hm(c.openedAt)} 〜 ${hm(c.closedAt)}</b><span class="small">${c.by ? '締め：' + c.by.replace(/[<>&]/g, '') : ''}</span></div>
      <table>
        <tr><td>用意していたお金（開始時）</td><td>${fmtYen(c.float)}</td></tr>
        <tr><td>締めのときのお金</td><td>${fmtYen(c.counted)}</td></tr>
        <tr class="subtot"><td>増えたお金</td><td>${fmtYen(gained)}</td></tr>
        <tr><td>売上高（${inPeriod.length}件）</td><td>${fmtYen(salesNow)}</td></tr>
        <tr class="subtot"><td>差（増えたお金 − 売上高）</td><td class="diff ${diff === 0 ? 'ok' : 'ng'}">${diff === 0 ? '¥0（一致）' : (diff > 0 ? '+' : '') + fmtYen(diff) + (diff > 0 ? '（多い）' : '（足りない）')}</td></tr>
      </table>
      ${changed ? `<p class="small">締めた時点の売上は ${fmtYen(c.sales)}（差 ${(c.diff > 0 ? '+' : '') + fmtYen(c.diff)}）。その後の手入力・補正を含めて計算し直しています。</p>` : ''}
      <details><summary>お金の種類ごとの増減</summary>
        <table><tr><th>種類</th><th>開始時</th><th>締め</th><th>増減</th><th>金額</th></tr>${rows}
        <tr class="subtot"><td>合計</td><td>${fmtYen(c.float)}</td><td>${fmtYen(c.counted)}</td><td></td><td>${fmtYen(gained)}</td></tr></table>
      </details>
    </div>`;
}
