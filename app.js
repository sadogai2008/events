// ============================================================
// app.js — 調整くん
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);
const db  = getFirestore(app);

/* ── Utils ── */
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function randomToken(len = 12) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => b.toString(36)).join('').slice(0, len);
}

function toast(msg, duration = 2800) {
  let c = qs('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; c.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, duration);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'コピー済み ✓'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    toast('クリップボードにコピーしました');
  });
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} (${days[d.getDay()]})`;
}

function getURL(token, type) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  if (type === 'admin') return `${base}admin.html?token=${token}`;
  return `${base}index.html?token=${token}`;
}

function escHtml(str = '') {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Theme ── */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = $('theme-toggle');
  if (!btn) return;
  btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

/* ── QR ── */
async function loadQRLib() {
  if (window.QRCode) return;
  await new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = resolve; document.head.appendChild(s);
  });
}

async function generateQR(url, containerId) {
  const el = $(containerId); if (!el) return;
  await loadQRLib(); el.innerHTML = '';
  new QRCode(el, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
}

async function downloadQR(url, filename) {
  await loadQRLib();
  const container = document.createElement('div');
  document.body.appendChild(container);
  new QRCode(container, { text: url, width: 400, height: 400, correctLevel: QRCode.CorrectLevel.M });
  setTimeout(() => {
    const img = container.querySelector('img') || container.querySelector('canvas');
    if (!img) return;
    const a = document.createElement('a');
    a.href = img.tagName === 'CANVAS' ? img.toDataURL('image/png') : img.src;
    a.download = filename; a.click(); container.remove();
  }, 500);
}

/* ═══════════════════════════════════════
   INDEX PAGE
═══════════════════════════════════════ */
async function initIndex() {
  initTheme();
  const params = new URLSearchParams(location.search);
  const publicToken = params.get('token');

  if (publicToken) {
    // 参加者モード — 作成フォームを完全に非表示
    const createSection = $('create-section');
    if (createSection) createSection.remove();
    await initParticipant(publicToken);
  } else {
    // 作成モード
    initCreateEvent();
  }
}

/* ── CREATE EVENT ── */
function initCreateEvent() {
  const dates = [];
  const dateList = $('date-list');
  const dateInput = $('date-input');
  const addDateBtn = $('add-date-btn');

  function renderDates() {
    dateList.innerHTML = '';
    if (dates.length === 0) {
      dateList.innerHTML = '<p class="text-muted" style="font-size:.82rem;padding:4px 0">候補日を追加してください</p>';
      return;
    }
    dates.forEach((d, i) => {
      const item = document.createElement('div');
      item.className = 'date-item';
      item.innerHTML = `<span class="date-text">📅 ${formatDate(d)}</span><button class="remove-btn" data-i="${i}">✕</button>`;
      dateList.appendChild(item);
    });
    dateList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { dates.splice(+btn.dataset.i, 1); renderDates(); });
    });
  }
  renderDates();

  addDateBtn.addEventListener('click', () => {
    const v = dateInput.value;
    if (!v) { toast('日付を入力してください'); return; }
    if (dates.includes(v)) { toast('既に追加済みです'); return; }
    dates.push(v); dates.sort(); dateInput.value = ''; renderDates();
  });
  dateInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDateBtn.click(); } });

  $('create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const title    = $('event-title').value.trim();
    const desc     = $('event-desc').value.trim();
    const deadline = $('event-deadline').value || null;
    const maxResp  = parseInt($('event-max-resp').value) || null;
    const showOthers = $('show-others').checked;

    if (!title) { toast('イベント名を入力してください'); return; }
    if (dates.length === 0) { toast('候補日を1つ以上追加してください'); return; }

    const btn = $('create-btn');
    btn.disabled = true; btn.textContent = '作成中…';

    try {
      const publicToken = randomToken(10);
      const adminToken  = randomToken(16);
      await addDoc(collection(db, 'events'), {
        title, description: desc, dates, deadline, maxResponses: maxResp,
        showOthers, publicToken, adminToken, createdAt: serverTimestamp()
      });

      $('create-section').classList.add('hidden');
      $('success-section').classList.remove('hidden');

      const publicURL = getURL(publicToken, 'public');
      const adminURL  = getURL(adminToken, 'admin');

      $('public-url-text').textContent = publicURL;
      $('admin-url-text').textContent  = adminURL;
      $('copy-public-btn').onclick = () => copyToClipboard(publicURL, $('copy-public-btn'));
      $('copy-admin-btn').onclick  = () => copyToClipboard(adminURL, $('copy-admin-btn'));

      generateQR(publicURL, 'qr-container');
      $('download-qr-btn').onclick = () => downloadQR(publicURL, `${title}_QR.png`);

    } catch (err) {
      toast('エラー: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'イベントを作成する →';
    }
  });
}

/* ── PARTICIPANT VIEW ── */
async function initParticipant(publicToken) {
  const mainEl = $('main-content');
  mainEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>読み込み中…</p></div>';

  try {
    const q = query(collection(db, 'events'), where('publicToken', '==', publicToken));
    const snap = await getDocs(q);
    if (snap.empty) {
      mainEl.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><h3>イベントが見つかりません</h3><p>URLをご確認ください</p></div>';
      return;
    }
    const event = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const rSnap = await getDocs(query(collection(db, 'responses'), where('eventId', '==', event.id), orderBy('createdAt', 'asc')));
    const responses = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderParticipantPage(mainEl, event, responses);
  } catch (err) {
    mainEl.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>エラー</h3><p>${err.message}</p></div>`;
  }
}

function isClosed(event, responses) {
  if (event.deadline && new Date(event.deadline + 'T23:59:59') < new Date()) return { closed: true, reason: '締切日を過ぎました' };
  if (event.maxResponses && responses.length >= event.maxResponses) return { closed: true, reason: `回答上限（${event.maxResponses}名）に達しました` };
  return { closed: false };
}

function renderParticipantPage(container, event, responses) {
  const closedInfo = isClosed(event, responses);
  const maxR = event.maxResponses || null;

  // ── 上部: イベント情報のみ ──
  let headerHTML = `
    <div class="event-header">
      <h1>${escHtml(event.title)}</h1>
      ${event.description ? `<p class="event-desc">${escHtml(event.description).replace(/\n/g,'<br>')}</p>` : ''}
      ${event.deadline ? `<span class="deadline-badge">⏰ 締切: ${formatDate(event.deadline)}</span>` : ''}
    </div>
  `;

  // 定員バー
  let capacityHTML = '';
  if (maxR) {
    const pct = Math.min(100, Math.round(responses.length / maxR * 100));
    const cls = pct >= 100 ? 'full' : pct >= 70 ? 'warn' : '';
    capacityHTML = `
      <div class="capacity-bar">
        <span class="cap-label">残り枠</span>
        <div class="cap-track"><div class="cap-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="cap-count">${responses.length}/${maxR}名</span>
      </div>
    `;
  }

  // 締切バナー
  const closedHTML = closedInfo.closed
    ? `<div class="closed-banner">🔒 ${escHtml(closedInfo.reason)}。現在回答を受け付けていません。</div>`
    : '';

  container.innerHTML = headerHTML + capacityHTML + closedHTML + `
    <div id="others-section"></div>
    <div id="answer-section-wrap"></div>
  `;

  // 他の回答者表示
  renderOthersSection(event, responses);

  // 回答フォーム
  if (!closedInfo.closed) {
    renderAnswerSection(event, responses);
  }
}

function renderOthersSection(event, responses) {
  const sec = $('others-section');
  if (!sec) return;

  // showOthers が false なら完全非表示
  if (event.showOthers === false) { sec.innerHTML = ''; return; }

  // ON/OFF トグルボタン（ローカル状態）
  const storageKey = 'showOthers_' + event.id;
  let visible = localStorage.getItem(storageKey) !== 'false';

  function render() {
    localStorage.setItem(storageKey, visible);
    if (responses.length === 0) {
      sec.innerHTML = '<div class="card mb-0"><div class="empty"><div class="empty-icon">📭</div><h3>まだ回答がありません</h3></div></div><div class="mt-16"></div>';
      return;
    }

    const tally = {};
    event.dates.forEach(d => { tally[d] = { o: 0, t: 0, x: 0 }; });
    responses.forEach(r => {
      event.dates.forEach(d => {
        const a = r.answers?.[d] || 'x';
        if (tally[d]) tally[d][a]++;
      });
    });

    sec.innerHTML = `
      <div class="card">
        <div class="card-title" style="justify-content:space-between">
          <span style="display:flex;align-items:center;gap:8px"><span class="icon">📊</span>回答状況（${responses.length}名）</span>
          <button class="others-toggle-btn ${visible ? 'active' : ''}" id="others-toggle-pill">
            ${visible ? '👁 非表示にする' : '👁 表示する'}
          </button>
        </div>
        ${visible ? `
        <div class="schedule-grid">
          <table class="schedule-table">
            <thead><tr>
              <th>名前</th>
              ${event.dates.map(d => `<th>${formatDate(d).replace(' ','<br>')}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${responses.map(r => `
                <tr>
                  <td><strong>${escHtml(r.name)}</strong></td>
                  ${event.dates.map(d => {
                    const a = r.answers?.[d] || 'x';
                    const map = { o: '○', t: '△', x: '×' };
                    const cls = { o: 'tally-o', t: 'tally-t', x: 'tally-x' };
                    return `<td class="tally-cell ${cls[a]}">${map[a]}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
            <tfoot><tr>
              <td><strong>集計</strong></td>
              ${event.dates.map(d => `<td>
                <span class="tally-o">○${tally[d].o}</span>
                <span class="tally-t"> △${tally[d].t}</span>
                <span class="tally-x"> ×${tally[d].x}</span>
              </td>`).join('')}
            </tr></tfoot>
          </table>
        </div>` : '<p class="text-muted" style="padding:8px 0">他の回答者の状況は非表示中です</p>'}
      </div>
      <div class="mt-16"></div>
    `;

    $('others-toggle-pill')?.addEventListener('click', () => {
      visible = !visible; render();
    });
  }
  render();
}

function renderAnswerSection(event, responses) {
  const wrap = $('answer-section-wrap');
  if (!wrap) return;

  const answers = {};
  event.dates.forEach(d => answers[d] = 'x');

  // 既存回答者チェック用
  let myExistingResp = null;

  wrap.innerHTML = `
    <div class="card" id="answer-card">
      <div class="card-title"><span class="icon">✏️</span>回答する</div>
      <div class="form-group">
        <label class="required">お名前</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="resp-name" placeholder="山田 太郎" autocomplete="name" style="flex:1">
          <button class="btn btn-secondary" id="load-my-ans-btn" title="以前の回答を読み込む">📥 読込</button>
        </div>
        <p class="hint-text">以前に回答済みの場合、名前を入力して「読込」で編集できます</p>
      </div>
      <div id="answer-grid"></div>
      <div class="mt-16">
        <button class="btn btn-success btn-block btn-lg" id="submit-resp-btn">回答を送信する</button>
      </div>
    </div>
  `;

  renderAnswerGrid(event, answers);

  // 読込ボタン
  $('load-my-ans-btn').addEventListener('click', async () => {
    const name = $('resp-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    const found = responses.find(r => r.name === name);
    if (!found) { toast('この名前の回答は見つかりませんでした'); return; }
    myExistingResp = found;
    event.dates.forEach(d => { answers[d] = found.answers?.[d] || 'x'; });
    renderAnswerGrid(event, answers);
    toast(`「${name}」の回答を読み込みました ✓`);
  });

  // 送信
  $('submit-resp-btn').addEventListener('click', async () => {
    const name = $('resp-name').value.trim();
    if (!name) { toast('お名前を入力してください'); $('resp-name').focus(); return; }

    // 上限チェック（読込なし新規の場合のみ）
    if (!myExistingResp && event.maxResponses && responses.length >= event.maxResponses) {
      toast('回答上限に達しました'); return;
    }

    const btn = $('submit-resp-btn');
    btn.disabled = true; btn.textContent = '送信中…';

    try {
      // 同名の既存回答を確認（読込してない場合）
      const existing = myExistingResp || responses.find(r => r.name === name);
      if (existing) {
        if (!myExistingResp && !confirm(`「${name}」はすでに回答済みです。上書きしますか？`)) {
          btn.disabled = false; btn.textContent = '回答を送信する'; return;
        }
        await updateDoc(doc(db, 'responses', existing.id), { name, answers, createdAt: serverTimestamp() });
        toast('回答を更新しました ✓ 🎉');
      } else {
        await addDoc(collection(db, 'responses'), { eventId: event.id, name, answers, createdAt: serverTimestamp() });
        toast('回答を送信しました 🎉');
      }
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      toast('エラー: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '回答を送信する';
    }
  });
}

function renderAnswerGrid(event, answers) {
  const grid = $('answer-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="schedule-grid mt-16">
      <table class="schedule-table">
        <thead><tr>
          <th>候補日</th>
          <th class="tally-o">○ 参加</th>
          <th class="tally-t">△ 未定</th>
          <th class="tally-x">× 不可</th>
        </tr></thead>
        <tbody>
          ${event.dates.map(d => `
            <tr>
              <td>${formatDate(d)}</td>
              <td><button class="ans-btn ${answers[d]==='o'?'active-o':''}" data-date="${d}" data-val="o">○</button></td>
              <td><button class="ans-btn ${answers[d]==='t'?'active-t':''}" data-date="${d}" data-val="t">△</button></td>
              <td><button class="ans-btn ${answers[d]==='x'?'active-x':''}" data-date="${d}" data-val="x">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  grid.querySelectorAll('.ans-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.date; const v = btn.dataset.val;
      answers[d] = v;
      grid.querySelectorAll(`.ans-btn[data-date="${d}"]`).forEach(b => b.classList.remove('active-o','active-t','active-x'));
      btn.classList.add('active-' + v);
    });
  });
}

/* ═══════════════════════════════════════
   ADMIN PAGE
═══════════════════════════════════════ */
async function initAdmin() {
  initTheme();
  const params = new URLSearchParams(location.search);
  const adminToken = params.get('token');
  const mainEl = $('admin-main');
  if (!mainEl) return;

  if (!adminToken) {
    mainEl.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><h3>管理者URLからアクセスしてください</h3></div>';
    return;
  }

  mainEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>読み込み中…</p></div>';

  try {
    const q = query(collection(db, 'events'), where('adminToken', '==', adminToken));
    const snap = await getDocs(q);
    if (snap.empty) {
      mainEl.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><h3>イベントが見つかりません</h3></div>';
      return;
    }
    const event = { id: snap.docs[0].id, ...snap.docs[0].data() };
    await renderAdminPage(mainEl, event);
  } catch (err) {
    mainEl.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>エラー</h3><p>${err.message}</p></div>`;
  }
}

async function renderAdminPage(container, event) {
  const publicURL = getURL(event.publicToken, 'public');
  const rSnap = await getDocs(query(collection(db, 'responses'), where('eventId', '==', event.id), orderBy('createdAt', 'asc')));
  let responses = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const closedInfo = isClosed(event, responses);
  const maxR = event.maxResponses || null;

  container.innerHTML = `
    <div class="event-header">
      <h1>🔑 ${escHtml(event.title)}<span style="font-size:.7em;font-weight:400;color:var(--text3)"> 管理画面</span></h1>
      ${event.description ? `<p class="event-desc">${escHtml(event.description)}</p>` : ''}
      ${closedInfo.closed ? `<div class="closed-banner">🔒 ${escHtml(closedInfo.reason)}</div>` : ''}
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="overview">概要</button>
      <button class="tab-btn" data-tab="responses">回答一覧</button>
      <button class="tab-btn" data-tab="settings">設定</button>
    </div>

    <!-- OVERVIEW -->
    <div class="tab-panel active" id="tab-overview">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${responses.length}${maxR ? `<span style="font-size:.6em;color:var(--text3)">/${maxR}</span>` : ''}</div><div class="stat-label">回答数</div></div>
        <div class="stat-card"><div class="stat-num">${event.dates.length}</div><div class="stat-label">候補日数</div></div>
        <div class="stat-card"><div class="stat-num">${event.deadline ? formatDate(event.deadline).split('/').slice(1).join('/').split(' ')[0] : '—'}</div><div class="stat-label">締切</div></div>
      </div>

      ${maxR ? (() => {
        const pct = Math.min(100, Math.round(responses.length / maxR * 100));
        const cls = pct >= 100 ? 'full' : pct >= 70 ? 'warn' : '';
        return `<div class="capacity-bar"><span class="cap-label">回答枠</span><div class="cap-track"><div class="cap-fill ${cls}" style="width:${pct}%"></div></div><span class="cap-count">${responses.length}/${maxR}名</span></div>`;
      })() : ''}

      <div class="card">
        <div class="card-title"><span class="icon">🔗</span>参加者URL</div>
        <div class="url-box">
          <span class="url-text">${publicURL}</span>
          <button class="copy-btn" id="copy-public">コピー</button>
        </div>
        <div class="mt-12 flex gap-8 flex-wrap">
          <button class="btn btn-secondary btn-sm" id="show-qr-btn">📱 QRコード</button>
          <button class="btn btn-secondary btn-sm" id="dl-qr-btn">⬇️ QR保存</button>
        </div>
        <div id="qr-area" class="hidden">
          <div class="qr-wrap"><div id="qr-container"></div></div>
        </div>
      </div>

      <div class="card mt-20" id="tally-card">
        <div class="card-title"><span class="icon">📊</span>日程別集計</div>
        <div id="tally-body"></div>
      </div>

      <div class="mt-16 flex gap-8 flex-wrap">
        <button class="btn btn-secondary" id="export-csv-btn">📥 CSVダウンロード</button>
      </div>
    </div>

    <!-- RESPONSES -->
    <div class="tab-panel" id="tab-responses">
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="名前で検索…">
        <button class="btn btn-secondary" id="search-btn">検索</button>
      </div>
      <div id="resp-list-container"></div>
    </div>

    <!-- SETTINGS -->
    <div class="tab-panel" id="tab-settings">
      <div class="card">
        <div class="card-title"><span class="icon">✏️</span>イベント設定</div>
        <div class="form-group">
          <label>イベント名</label>
          <input type="text" id="edit-title" value="${escHtml(event.title)}">
        </div>
        <div class="form-group">
          <label>説明</label>
          <textarea id="edit-desc">${escHtml(event.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>回答締切</label>
          <input type="date" id="edit-deadline" value="${event.deadline || ''}">
        </div>
        <div class="form-group">
          <label>回答上限数</label>
          <input type="number" id="edit-max-resp" value="${event.maxResponses || ''}" placeholder="空欄=無制限" min="1" max="999">
        </div>
        <div class="form-group">
          <div class="toggle-row">
            <div>
              <div class="toggle-label">他の回答者の状況を表示</div>
              <div class="toggle-desc">参加者が互いの回答を見られるようにする</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="edit-show-others" ${event.showOthers !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label>候補日</label>
          <div id="edit-date-list"></div>
          <div class="add-date-row mt-8">
            <input type="date" id="edit-date-input">
            <button class="btn btn-secondary" id="edit-add-date-btn">追加</button>
          </div>
        </div>
        <button class="btn btn-primary mt-16" id="save-event-btn">変更を保存</button>
      </div>
      <div class="card mt-20">
        <div class="card-title"><span class="icon">🗑️</span>危険な操作</div>
        <p class="text-muted mb-0">イベントを削除すると全回答も削除されます。この操作は取り消せません。</p>
        <button class="btn btn-danger mt-16" id="delete-event-btn">イベントを削除する</button>
      </div>
    </div>
  `;

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Copy / QR
  $('copy-public').onclick = () => copyToClipboard(publicURL, $('copy-public'));
  $('show-qr-btn').onclick = () => {
    const area = $('qr-area'); area.classList.toggle('hidden');
    if (!area.classList.contains('hidden')) generateQR(publicURL, 'qr-container');
  };
  $('dl-qr-btn').onclick = () => downloadQR(publicURL, `${event.title}_QR.png`);

  // Tally
  renderTally(event, responses);

  // Response list
  renderRespList(event, responses);

  // Search
  $('search-btn').onclick = () => {
    const q = $('search-input').value.trim().toLowerCase();
    renderRespList(event, q ? responses.filter(r => r.name.toLowerCase().includes(q)) : responses);
  };
  $('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('search-btn').click(); });

  // CSV
  $('export-csv-btn').onclick = () => exportCSV(event, responses);

  // Edit dates
  const editDates = [...event.dates];
  function renderEditDates() {
    const list = $('edit-date-list'); list.innerHTML = '';
    editDates.forEach((d, i) => {
      const item = document.createElement('div');
      item.className = 'date-item';
      item.innerHTML = `<span class="date-text">📅 ${formatDate(d)}</span><button class="remove-btn" data-i="${i}">✕</button>`;
      list.appendChild(item);
    });
    list.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { editDates.splice(+btn.dataset.i, 1); renderEditDates(); });
    });
  }
  renderEditDates();
  $('edit-add-date-btn').onclick = () => {
    const v = $('edit-date-input').value;
    if (!v || editDates.includes(v)) return;
    editDates.push(v); editDates.sort(); $('edit-date-input').value = ''; renderEditDates();
  };

  // Save
  $('save-event-btn').onclick = async () => {
    const btn = $('save-event-btn');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      const maxVal = parseInt($('edit-max-resp').value) || null;
      await updateDoc(doc(db, 'events', event.id), {
        title: $('edit-title').value.trim(),
        description: $('edit-desc').value.trim(),
        deadline: $('edit-deadline').value || null,
        maxResponses: maxVal,
        showOthers: $('edit-show-others').checked,
        dates: editDates
      });
      toast('保存しました ✓'); setTimeout(() => location.reload(), 1000);
    } catch(e) { toast('エラー: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '変更を保存'; }
  };

  // Delete
  $('delete-event-btn').onclick = () => {
    showModal('本当に削除しますか？', 'イベントと全ての回答が完全に削除されます。', async () => {
      try {
        const rDocs = await getDocs(query(collection(db, 'responses'), where('eventId', '==', event.id)));
        await Promise.all(rDocs.docs.map(d => deleteDoc(doc(db, 'responses', d.id))));
        await deleteDoc(doc(db, 'events', event.id));
        toast('削除しました');
        setTimeout(() => location.href = location.origin + location.pathname.replace(/[^/]*$/, ''), 1200);
      } catch(e) { toast('エラー: ' + e.message); }
    });
  };
}

function renderTally(event, responses) {
  const body = $('tally-body');
  if (!body) return;
  if (responses.length === 0) { body.innerHTML = '<p class="text-muted">まだ回答がありません</p>'; return; }

  const tally = {};
  event.dates.forEach(d => { tally[d] = { o: 0, t: 0, x: 0 }; });
  responses.forEach(r => {
    event.dates.forEach(d => {
      const a = r.answers?.[d] || 'x';
      if (tally[d]) tally[d][a]++;
    });
  });

  const maxO = Math.max(...event.dates.map(d => tally[d].o));
  const sorted = [...event.dates].sort((a, b) => tally[b].o - tally[a].o);

  body.innerHTML = `
    <div class="schedule-grid">
      <table class="schedule-table">
        <thead><tr><th>候補日</th><th class="tally-o">○</th><th class="tally-t">△</th><th class="tally-x">×</th></tr></thead>
        <tbody>
          ${sorted.map(d => {
            const isTop = tally[d].o === maxO && maxO > 0;
            return `<tr style="${isTop ? 'background:var(--green-soft)' : ''}">
              <td style="font-weight:${isTop ? '700' : '400'}">${formatDate(d)}${isTop ? ' 👑' : ''}</td>
              <td class="tally-cell tally-o">${tally[d].o}</td>
              <td class="tally-cell tally-t">${tally[d].t}</td>
              <td class="tally-cell tally-x">${tally[d].x}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRespList(event, responses) {
  const container = $('resp-list-container');
  if (!container) return;
  if (responses.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><h3>回答がありません</h3></div>'; return;
  }
  container.innerHTML = `<div class="resp-list">${responses.map(r => renderRespCard(event, r)).join('')}</div>`;
  container.querySelectorAll('[data-delete-resp]').forEach(btn => {
    btn.addEventListener('click', () => {
      showModal('回答を削除しますか？', `「${btn.dataset.deleteResp}」の回答を削除します。`, async () => {
        await deleteDoc(doc(db, 'responses', btn.dataset.id));
        toast('削除しました'); setTimeout(() => location.reload(), 800);
      });
    });
  });
  container.querySelectorAll('[data-edit-resp]').forEach(btn => {
    btn.addEventListener('click', () => openEditRespModal(event, responses.find(r => r.id === btn.dataset.id)));
  });
}

function renderRespCard(event, r) {
  const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('ja-JP') : '';
  const map = { o: '○', t: '△', x: '×' };
  const tags = event.dates.map(d => {
    const a = r.answers?.[d] || 'x';
    return `<span class="answer-tag ${a}">${map[a]} ${formatDate(d)}</span>`;
  }).join('');
  return `
    <div class="resp-card">
      <div class="resp-card-header">
        <div><div class="resp-name">👤 ${escHtml(r.name)}</div><div class="resp-date-small">${date}</div></div>
        <div class="resp-actions">
          <button class="btn btn-secondary btn-sm" data-edit-resp data-id="${r.id}">編集</button>
          <button class="btn btn-danger btn-sm" data-delete-resp="${escHtml(r.name)}" data-id="${r.id}">削除</button>
        </div>
      </div>
      <div class="answers-row">${tags}</div>
    </div>
  `;
}

function openEditRespModal(event, resp) {
  const answers = { ...resp.answers };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">✏️ 回答を編集 — ${escHtml(resp.name)}</div>
      <div class="form-group">
        <label>お名前</label>
        <input type="text" id="edit-resp-name" value="${escHtml(resp.name)}">
      </div>
      <div class="schedule-grid mt-12">
        <table class="schedule-table">
          <thead><tr><th>候補日</th><th>○</th><th>△</th><th>×</th></tr></thead>
          <tbody>
            ${event.dates.map(d => `
              <tr>
                <td>${formatDate(d)}</td>
                <td><button class="ans-btn ${answers[d]==='o'?'active-o':''}" data-date="${d}" data-val="o">○</button></td>
                <td><button class="ans-btn ${answers[d]==='t'?'active-t':''}" data-date="${d}" data-val="t">△</button></td>
                <td><button class="ans-btn ${answers[d]==='x'?'active-x':''}" data-date="${d}" data-val="x">×</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">キャンセル</button>
        <button class="btn btn-primary" id="modal-save">保存する</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.ans-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.date; const v = btn.dataset.val;
      answers[d] = v;
      overlay.querySelectorAll(`.ans-btn[data-date="${d}"]`).forEach(b => b.classList.remove('active-o','active-t','active-x'));
      btn.classList.add('active-' + v);
    });
  });
  overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#modal-save').onclick = async () => {
    const name = overlay.querySelector('#edit-resp-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    try {
      await updateDoc(doc(db, 'responses', resp.id), { name, answers });
      toast('保存しました ✓'); overlay.remove(); setTimeout(() => location.reload(), 800);
    } catch(e) { toast('エラー: ' + e.message); }
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showModal(title, body, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${title}</div>
      <p class="text-muted">${body}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="mc">キャンセル</button>
        <button class="btn btn-danger" id="mok">削除する</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#mc').onclick = () => overlay.remove();
  overlay.querySelector('#mok').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function exportCSV(event, responses) {
  const headers = ['名前', ...event.dates.map(d => formatDate(d))];
  const map = { o: '○', t: '△', x: '×' };
  const rows = responses.map(r => [r.name, ...event.dates.map(d => map[r.answers?.[d] || 'x'])]);
  const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${event.title}_回答.csv`; a.click();
}

/* ── Router ── */
const page = document.documentElement.getAttribute('data-page');
if (page === 'index') initIndex();
if (page === 'admin') initAdmin();
