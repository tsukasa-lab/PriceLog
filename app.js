(() => {
'use strict';

const STORAGE_KEY = 'pricelog_v02_data';
const SETTINGS_KEY = 'pricelog_v02_settings';

const defaultSettings = {
  standardTax: 10,
  reducedTax: 8,
  defaultPriceType: 'inc'
};

let settings = loadJson(SETTINGS_KEY, defaultSettings);
let products = loadJson(STORAGE_KEY, []);
let openProductId = null;
let editProductId = null;
let saveTimer = null;

const $ = (id) => document.getElementById(id);
const listEl = $('productList');
const productTemplate = $('productTemplate');
const storeTemplate = $('storeTemplate');

seedIfEmpty();
render();

$('searchInput').addEventListener('input', render);
$('btnAddProduct').addEventListener('click', () => openProductDialog());
$('btnSettings').addEventListener('click', openSettings);

$('productForm').addEventListener('submit', (e) => {
  e.preventDefault();
  saveProductFromDialog();
});

$('btnDeleteProduct').addEventListener('click', () => {
  if (!editProductId) return;
  products = products.filter(p => p.id !== editProductId);
  if (openProductId === editProductId) openProductId = null;
  persistNow();
  $('productDialog').close();
  render();
});

$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const st = clampNumber($('standardTax').value, 0, 100, 10);
  const rt = clampNumber($('reducedTax').value, 0, 100, 8);
  settings = {
    standardTax: st,
    reducedTax: rt,
    defaultPriceType: $('defaultPriceType').value === 'ex' ? 'ex' : 'inc'
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  $('settingsDialog').close();
  render();
});

$('btnExport').addEventListener('click', exportBackup);
$('importFile').addEventListener('change', importBackup);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredCloneSafe(fallback);
  } catch {
    return structuredCloneSafe(fallback);
  }
}

function structuredCloneSafe(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function seedIfEmpty() {
  if (products.length) return;
  products = [
    {
      id: makeId('p'),
      name: 'ブレンディ',
      amount: 110,
      unit: 'g',
      defaultTax: 8,
      stores: [
        {id:makeId('s'),store:'平和堂',price:598,priceType:'inc',tax:8,couponType:'none',couponValue:0},
        {id:makeId('s'),store:'業務スーパー',price:620,priceType:'inc',tax:8,couponType:'percent',couponValue:20},
        {id:makeId('s'),store:'イオン',price:580,priceType:'inc',tax:8,couponType:'yen',couponValue:50}
      ]
    },
    {
      id: makeId('p'),
      name: '牛乳',
      amount: 1000,
      unit: 'ml',
      defaultTax: 8,
      stores: [
        {id:makeId('s'),store:'平和堂',price:218,priceType:'inc',tax:8,couponType:'none',couponValue:0}
      ]
    }
  ];
  persistNow();
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
}

function persistNow() {
  clearTimeout(saveTimer);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function taxOptions(selected) {
  const values = Array.from(new Set([Number(settings.reducedTax), Number(settings.standardTax), Number(selected)]))
    .filter(v => Number.isFinite(v) && v >= 0);
  return values.map(v => `<option value="${escapeAttr(v)}"${Number(v)===Number(selected)?' selected':''}>${v}%</option>`).join('');
}

function render() {
  const q = $('searchInput').value.trim().toLowerCase();
  document.body.classList.toggle('focus-mode', !!openProductId);
  listEl.innerHTML = '';

  const visible = products.filter(p => !q || p.name.toLowerCase().includes(q));
  $('productCount').textContent = `${visible.length}/${products.length}`;
  $('emptyState').classList.toggle('hidden', visible.length !== 0);

  visible.forEach(product => {
    const node = productTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = product.id;

    const best = getBest(product);
    node.querySelector('.product-name').textContent = product.name;
    node.querySelector('.product-size').textContent = `${fmt(product.amount)}${product.unit}`;

    const bestStore = node.querySelector('.best-store');
    const bestUnit = node.querySelector('.best-unit');
    if (best) {
      bestStore.textContent = `★${best.store || '店舗未入力'}`;
      bestUnit.textContent = `${fmtUnit(best.calc.afterUnit)}円/${product.unit}`;
      node.classList.add('has-best');
    } else {
      bestStore.textContent = '価格未登録';
      bestUnit.textContent = '-';
    }

    const summary = node.querySelector('.product-summary');
    summary.addEventListener('click', () => {
      openProductId = openProductId === product.id ? null : product.id;
      render();
    });

    const detail = node.querySelector('.product-detail');
    const isOpen = openProductId === product.id;
    detail.classList.toggle('hidden', !isOpen);
    node.classList.toggle('open', isOpen);

    if (isOpen) {
      node.querySelector('.btn-edit-product').addEventListener('click', () => openProductDialog(product.id));
      node.querySelector('.btn-add-store').addEventListener('click', () => {
        product.stores.push({
          id: makeId('s'),
          store: '',
          price: '',
          priceType: settings.defaultPriceType,
          tax: product.defaultTax,
          couponType: 'none',
          couponValue: ''
        });
        persistNow();
        render();
        requestAnimationFrame(() => {
          const card = listEl.querySelector(`[data-id="${cssEscape(product.id)}"]`);
          const rows = card?.querySelectorAll('.store-row');
          rows?.[rows.length - 1]?.querySelector('.st-store')?.focus();
        });
      });

      const storeList = node.querySelector('.store-list');
      const bestId = best?.row.id || null;

      product.stores.forEach(row => {
        storeList.appendChild(renderStoreRow(product, row, row.id === bestId));
      });

      if (!product.stores.length) {
        const hint = document.createElement('div');
        hint.className = 'empty';
        hint.textContent = '「＋店舗」で価格を追加';
        storeList.appendChild(hint);
      }
    }

    listEl.appendChild(node);
  });
}

function renderStoreRow(product, row, isBest) {
  const el = storeTemplate.content.firstElementChild.cloneNode(true);
  if (isBest) el.classList.add('best');

  const store = el.querySelector('.st-store');
  const price = el.querySelector('.st-price');
  const priceType = el.querySelector('.st-price-type');
  const tax = el.querySelector('.st-tax');
  const couponType = el.querySelector('.st-coupon-type');
  const couponValue = el.querySelector('.st-coupon-value');
  const unitOut = el.querySelector('.st-unit');
  const totalOut = el.querySelector('.st-total');
  const beforeOut = el.querySelector('.st-before');

  store.value = row.store ?? '';
  price.value = row.price ?? '';
  priceType.value = row.priceType === 'ex' ? 'ex' : 'inc';
  tax.innerHTML = taxOptions(row.tax ?? product.defaultTax);
  couponType.value = ['percent','yen'].includes(row.couponType) ? row.couponType : 'none';
  couponValue.value = row.couponValue ?? '';

  function sync() {
    row.store = store.value.trim();
    row.price = numberOrBlank(price.value);
    row.priceType = priceType.value;
    row.tax = Number(tax.value);
    row.couponType = couponType.value;
    row.couponValue = numberOrBlank(couponValue.value);

    couponValue.disabled = row.couponType === 'none';
    couponValue.placeholder = row.couponType === 'percent' ? '%' : row.couponType === 'yen' ? '円' : '-';

    const calc = calcRow(product, row);
    if (calc) {
      unitOut.textContent = `${fmtUnit(calc.afterUnit)}`;
      if (Math.abs(calc.grossBefore - calc.afterTotal) > 0.0001) {
        totalOut.textContent = `通常 ${fmtYen(calc.grossBefore)} → 適用後 ${fmtYen(calc.afterTotal)}`;
        beforeOut.textContent = `${fmtUnit(calc.beforeUnit)}→${fmtUnit(calc.afterUnit)}円/${product.unit}`;
      } else {
        totalOut.textContent = `価格 ${fmtYen(calc.grossBefore)}`;
        beforeOut.textContent = `${fmtUnit(calc.beforeUnit)}円/${product.unit}`;
      }
    } else {
      unitOut.textContent = '-';
      totalOut.textContent = '';
      beforeOut.textContent = '';
    }

    persistSoon();
    refreshBestOnly(product.id);
  }

  [store, price, priceType, tax, couponType, couponValue].forEach(ctrl => {
    ctrl.addEventListener('input', sync);
    ctrl.addEventListener('change', sync);
  });

  el.querySelector('.st-delete').addEventListener('click', () => {
    product.stores = product.stores.filter(s => s.id !== row.id);
    persistNow();
    render();
  });

  sync();
  return el;
}

function refreshBestOnly(productId) {
  const product = products.find(p => p.id === productId);
  const card = listEl.querySelector(`[data-id="${cssEscape(productId)}"]`);
  if (!product || !card) return;

  const best = getBest(product);
  card.querySelector('.best-store').textContent = best ? `★${best.store || '店舗未入力'}` : '価格未登録';
  card.querySelector('.best-unit').textContent = best ? `${fmtUnit(best.calc.afterUnit)}円/${product.unit}` : '-';
  card.classList.toggle('has-best', !!best);

  const rowEls = card.querySelectorAll('.store-row');
  rowEls.forEach((r, i) => {
    r.classList.remove('best');
    const out = r.querySelector('.st-unit');
    const row = product.stores[i];
    const calc = row ? calcRow(product, row) : null;
    if (out) out.textContent = calc ? fmtUnit(calc.afterUnit) : '-';
  });
  if (best && openProductId === productId) {
    const index = product.stores.findIndex(s => s.id === best.row.id);
    const bestEl = rowEls[index];
    bestEl?.classList.add('best');
    const out = bestEl?.querySelector('.st-unit');
    if (out) out.textContent = `${fmtUnit(best.calc.afterUnit)}`;
  }
}

function calcRow(product, row) {
  const price = Number(row.price);
  const amount = Number(product.amount);
  const tax = Number(row.tax);
  if (!(price > 0) || !(amount > 0) || !(tax >= 0)) return null;

  const grossBefore = row.priceType === 'ex' ? price * (1 + tax / 100) : price;
  const netBefore = row.priceType === 'ex' ? price : price / (1 + tax / 100);

  let afterTotal = grossBefore;
  const cv = Math.max(0, Number(row.couponValue) || 0);

  if (row.couponType === 'percent') {
    afterTotal = grossBefore * (1 - Math.min(cv, 100) / 100);
  } else if (row.couponType === 'yen') {
    afterTotal = Math.max(0, grossBefore - cv);
  }

  return {
    grossBefore,
    netBefore,
    afterTotal,
    beforeUnit: grossBefore / amount,
    afterUnit: afterTotal / amount
  };
}

function getBest(product) {
  let best = null;
  product.stores.forEach(row => {
    const calc = calcRow(product, row);
    if (!calc) return;
    if (!best || calc.afterUnit < best.calc.afterUnit) {
      best = { row, store: row.store, calc };
    }
  });
  return best;
}

function openProductDialog(id = null) {
  editProductId = id;
  const p = id ? products.find(x => x.id === id) : null;

  $('productDialogTitle').textContent = p ? '商品設定' : '商品追加';
  $('productName').value = p?.name ?? '';
  $('productAmount').value = p?.amount ?? 100;
  $('productUnit').value = p?.unit ?? 'g';

  const taxSelect = $('productTax');
  const selectedTax = p?.defaultTax ?? settings.reducedTax;
  taxSelect.innerHTML = taxOptions(selectedTax);
  taxSelect.value = String(selectedTax);

  $('btnDeleteProduct').classList.toggle('hidden', !p);
  $('productDialog').showModal();
  requestAnimationFrame(() => $('productName').focus());
}

function saveProductFromDialog() {
  const name = $('productName').value.trim();
  const amount = Number($('productAmount').value);
  if (!name || !(amount > 0)) return;

  if (editProductId) {
    const p = products.find(x => x.id === editProductId);
    if (p) {
      p.name = name;
      p.amount = amount;
      p.unit = $('productUnit').value;
      p.defaultTax = Number($('productTax').value);
    }
  } else {
    const p = {
      id: makeId('p'),
      name,
      amount,
      unit: $('productUnit').value,
      defaultTax: Number($('productTax').value),
      stores: [{
        id: makeId('s'),
        store: '',
        price: '',
        priceType: settings.defaultPriceType,
        tax: Number($('productTax').value),
        couponType: 'none',
        couponValue: ''
      }]
    };
    products.unshift(p);
    openProductId = p.id;
  }

  persistNow();
  $('productDialog').close();
  render();
}

function openSettings() {
  $('standardTax').value = settings.standardTax;
  $('reducedTax').value = settings.reducedTax;
  $('defaultPriceType').value = settings.defaultPriceType;
  $('settingsDialog').showModal();
}

function exportBackup() {
  const payload = {
    app: 'PriceLog',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    products
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PriceLog-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!Array.isArray(data.products)) throw new Error('invalid');
      products = data.products;
      settings = {...defaultSettings, ...(data.settings || {})};
      persistNow();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      $('settingsDialog').close();
      render();
    } catch {
      alert('バックアップファイルを読み込めなかったよ。');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}

function numberOrBlank(v) {
  if (v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fmt(v) {
  return Number(v).toLocaleString('ja-JP', {maximumFractionDigits:2});
}

function fmtUnit(v) {
  return Number(v).toLocaleString('ja-JP', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function fmtYen(v) {
  return Number(v).toLocaleString('ja-JP', {maximumFractionDigits:1}) + '円';
}

function escapeAttr(v) {
  return String(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
})();
