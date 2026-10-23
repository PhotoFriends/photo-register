// 販売記録・管理画面で共通の設定
export const firebaseConfig = {
  apiKey: 'AIzaSyByNolalAuk-d6LHBwENVrshE7QpKo4Jss',
  authDomain: 'pf-register-1023.firebaseapp.com',
  projectId: 'pf-register-1023',
  storageBucket: 'pf-register-1023.firebasestorage.app',
  messagingSenderId: '944810320688',
  appId: '1:944810320688:web:0f0916483880318fd91ef5',
};

// 商品（在庫は「残り」の目安表示にだけ使う）
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
export const CATS = { cal: 'カレンダー', cf: 'クリアファイル', pc: 'ポストカード', bk: '写真集' };
export const DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];
