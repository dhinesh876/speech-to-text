const $ = (s) => document.querySelector(s);
const API = '/api/transcriptions';
const state = { page: 1, pages: 1, q: '' };
let rec = null;
let editingId = null;

// ---------- helpers ----------
async function req(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}
const fmtDate = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const autoTitle = (text) => text.split(/\s+/).slice(0, 6).join(' ');

// ---------- history ----------
async function load() {
  try {
    const p = new URLSearchParams({ page: state.page, limit: 10, q: state.q });
    const data = await req(`${API}?${p}`);
    state.pages = data.pages;
    state.page = data.page;
    renderList(data.items);
    $('#pageInfo').textContent = `Page ${data.page} of ${data.pages} · ${data.total} saved`;
    $('#prev').disabled = data.page <= 1;
    $('#next').disabled = data.page >= data.pages;
  } catch (e) {
    toast(e.message, true);
  }
}

function renderList(items) {
  const ul = $('#list');
  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = `<li class="empty">${state.q ? 'No matches. Try a different word.' : 'Nothing saved yet. Press Start speaking to record your first transcription.'}</li>`;
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.id = it._id;
    const h = document.createElement('h3');
    h.textContent = it.title || autoTitle(it.text);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [fmtDate(it.createdAt)];
    if (it.durationSec) parts.push(fmtDur(it.durationSec));
    if (it.source === 'manual') parts.push('typed');
    meta.textContent = parts.join(' · ');
    const body = document.createElement('p');
    body.className = 'body';
    body.textContent = it.text;
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.innerHTML =
      '<button type="button" class="ghost" data-act="copy">Copy</button>' +
      '<button type="button" class="ghost" data-act="edit">Edit</button>' +
      '<button type="button" class="ghost danger" data-act="delete">Delete</button>';
    li.append(h, meta, body, acts);
    li._data = it;
    ul.append(li);
  }
}

$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('.item');
  const it = li._data;
  const act = btn.dataset.act;
  if (act === 'copy') {
    await navigator.clipboard.writeText(it.text);
    toast('Copied');
  } else if (act === 'edit') {
    openEditor(it);
  } else if (act === 'delete') {
    if (!confirm('Delete this transcription? This cannot be undone.')) return;
    try {
      await req(`${API}/${it._id}`, { method: 'DELETE' });
      toast('Deleted');
      load();
    } catch (err) {
      toast(err.message, true);
    }
  }
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    load();
  }, 300);
});
$('#prev').onclick = () => { state.page--; load(); };
$('#next').onclick = () => { state.page++; load(); };

// ---------- editor dialog (create + update) ----------
function openEditor(item) {
  editingId = item ? item._id : null;
  $('#editorTitle').textContent = item ? 'Edit transcription' : 'Add note';
  $('#edTitle').value = item?.title || '';
  $('#edText').value = item?.text || '';
  $('#editor').showModal();
}
$('#newBtn').onclick = () => openEditor(null);
$('#edCancel').onclick = () => $('#editor').close();
$('#editorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#edTitle').value.trim();
  const text = $('#edText').value.trim();
  if (!text) return toast('Text cannot be empty', true);
  try {
    if (editingId) {
      await req(`${API}/${editingId}`, { method: 'PUT', body: JSON.stringify({ title, text }) });
      toast('Changes saved');
    } else {
      await req(API, { method: 'POST', body: JSON.stringify({ title, text, source: 'manual' }) });
      toast('Note added');
    }
    $('#editor').close();
    load();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- live recording ----------
const live = $('#live');
const recBtn = $('#recBtn');
let timerId;

function setLive(text) {
  live.textContent = text || 'Your words will appear here.';
  live.dataset.empty = text ? 'false' : 'true';
  live.scrollTop = live.scrollHeight;
}
function setUI(mode) {
  recBtn.classList.toggle('on', mode === 'recording');
  recBtn.disabled = mode === 'connecting' || mode === 'finishing';
  $('#recLabel').textContent = { idle: 'Start speaking', connecting: 'Connecting…', recording: 'Stop', finishing: 'Finishing…' }[mode];
  $('#status').textContent = { idle: '', connecting: 'Allow microphone access if asked.', recording: 'Listening', finishing: 'Saving your transcription…' }[mode];
  $('#timer').hidden = mode !== 'recording';
}

async function startRecording() {
  setUI('connecting');
  setLive('');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    setUI('idle');
    return toast('Microphone blocked. Allow access in your browser settings.', true);
  }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/pcm-worklet.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-processor');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/live`);
  ws.binaryType = 'arraybuffer';
  rec = { stream, ctx, src, node, ws, text: '', startedAt: 0, done: false };

  ws.onopen = () => ws.send(JSON.stringify({ type: 'start' }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'ready') {
      rec.startedAt = Date.now();
      src.connect(node);
      node.port.onmessage = (e) => ws.readyState === 1 && ws.send(e.data);
      setUI('recording');
      timerId = setInterval(() => ($('#timer').textContent = fmtDur((Date.now() - rec.startedAt) / 1000)), 500);
    } else if (m.type === 'transcript') {
      rec.text += m.text;
      setLive(rec.text.trim());
    } else if (m.type === 'final') {
      finish();
    } else if (m.type === 'error') {
      toast(m.message, true);
      abort();
    }
  };
  ws.onclose = () => { if (rec && !rec.done) abort(); };
}

function teardown() {
  clearInterval(timerId);
  if (!rec) return;
  rec.stream.getTracks().forEach((t) => t.stop());
  try { rec.src.disconnect(); rec.node.disconnect(); } catch { }
  rec.ctx.close().catch(() => { });
}

function stopRecording() {
  setUI('finishing');
  const duration = Math.round((Date.now() - rec.startedAt) / 1000);
  rec.duration = duration;
  teardown();
  if (rec.ws.readyState === 1) rec.ws.send(JSON.stringify({ type: 'stop' }));
  else finish();
}

async function finish() {
  if (!rec || rec.done) return;
  rec.done = true;
  const text = rec.text.trim();
  const duration = rec.duration || 0;
  rec.ws.close();
  rec = null;
  if (!text) {
    setUI('idle');
    return toast('No speech detected. Try again closer to the microphone.', true);
  }
  try {
    await req(API, { method: 'POST', body: JSON.stringify({ title: autoTitle(text), text, durationSec: duration, source: 'live' }) });
    toast('Transcription saved');
    setLive('');
    state.page = 1;
    load();
  } catch (e) {
    toast(e.message, true);
  }
  setUI('idle');
}

function abort() {
  if (!rec || rec.done) return;
  rec.done = true;
  teardown();
  try { rec.ws.close(); } catch { }
  rec = null;
  setUI('idle');
}

recBtn.addEventListener('click', () => (rec && rec.startedAt ? stopRecording() : startRecording()));
window.addEventListener('beforeunload', abort);

setUI('idle');
load();