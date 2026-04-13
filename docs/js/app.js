'use strict';

/**
 * Passlock App — main UI and state logic.
 */
const App = (() => {

  /* ─── State ─── */
  let vaultKey   = null;   // CryptoKey | null — cleared on lock
  let entries    = [];     // PasswordEntry[]
  let editingId  = null;   // string | null
  let idleTimer  = null;

  const IDLE_MS = 5 * 60 * 1000; // 5 minutes

  /* ─── Entry colours ─── */
  const COLORS = [
    '#5C6BC0','#26A69A','#EF5350','#AB47BC',
    '#42A5F5','#FF7043','#66BB6A','#EC407A',
  ];
  function entryColor(title) {
    let h = 0;
    for (const c of title) h = (h * 31 + c.charCodeAt(0)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  /* ─── Helpers ─── */
  const $  = id => document.getElementById(id);
  const show  = id => $(id).classList.remove('hidden');
  const hide  = id => $(id).classList.add('hidden');

  function showScreen(name) {
    ['screen-setup','screen-auth','screen-vault'].forEach(s => hide(s));
    show('screen-' + name);
  }

  let toastTimer;
  function toast(msg, ms = 2400) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function setError(id, msg) { $(id).textContent = msg; }
  function clearError(id)    { $(id).textContent = ''; }

  function showLoading(msg = 'Working…') {
    $('loading-msg').textContent = msg;
    show('loading');
  }
  function hideLoading() { hide('loading'); }

  function resetIdle() {
    clearTimeout(idleTimer);
    if (vaultKey) idleTimer = setTimeout(() => lock(), IDLE_MS);
  }

  /* ─── Boot ─── */
  async function init() {
    // Wire up eye-toggle buttons
    document.querySelectorAll('.eye-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.for);
        if (!target) return;
        target.type = target.type === 'password' ? 'text' : 'password';
        btn.textContent = target.type === 'password' ? '👁' : '🙈';
      });
    });

    // Wire up Enter key on auth screen
    $('auth-pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
    $('setup-pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('setup-confirm').focus(); });
    $('setup-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') createVault(); });

    // Reset idle on any interaction
    document.addEventListener('pointerdown', resetIdle);
    document.addEventListener('keydown', resetIdle);

    // Lock when tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && vaultKey) {
        setTimeout(() => { if (document.hidden) lock(); }, IDLE_MS);
      }
    });

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Route to correct screen
    const hasVault = await Storage.exists();
    showScreen(hasVault ? 'auth' : 'setup');
    if (hasVault) setTimeout(() => $('auth-pw').focus(), 100);
  }

  /* ─── CREATE VAULT (first time) ─── */
  async function createVault() {
    clearError('setup-error');
    const pw  = $('setup-pw').value;
    const pw2 = $('setup-confirm').value;

    if (pw.length < 8)   return setError('setup-error', 'Password must be at least 8 characters.');
    if (pw !== pw2)      return setError('setup-error', 'Passwords do not match.');

    showLoading('Creating your vault…');
    try {
      const salt        = Crypto.randomBytes(32);
      const wrappingKey = await Crypto.deriveWrappingKey(pw, salt);
      const newKey      = await Crypto.generateVaultKey();
      const wrappedKey  = await Crypto.wrapVaultKey(newKey, wrappingKey);
      const { iv, data } = await Crypto.encrypt([], newKey);

      await Storage.save({
        version:    1,
        salt:       Crypto.toB64(salt),
        wrappedKey,
        vaultIv:    iv,
        vaultData:  data,
      });

      vaultKey = newKey;
      entries  = [];
      $('setup-pw').value = '';
      $('setup-confirm').value = '';
      showScreen('vault');
      renderEntries();
      resetIdle();
    } catch (e) {
      setError('setup-error', 'Failed to create vault. Please try again.');
      console.error(e);
    } finally {
      hideLoading();
    }
  }

  /* ─── UNLOCK ─── */
  async function unlock() {
    clearError('auth-error');
    const pw = $('auth-pw').value;
    if (!pw) return setError('auth-error', 'Please enter your password.');

    showLoading('Unlocking vault…');
    try {
      const record      = await Storage.load();
      const salt        = Crypto.fromB64(record.salt);
      const wrappingKey = await Crypto.deriveWrappingKey(pw, salt);
      const key         = await Crypto.unwrapVaultKey(record.wrappedKey, wrappingKey);

      // Decrypt entries to verify key is correct
      const loaded = await Crypto.decrypt({ iv: record.vaultIv, data: record.vaultData }, key);

      vaultKey = key;
      entries  = loaded;
      $('auth-pw').value = '';
      showScreen('vault');
      renderEntries();
      resetIdle();
    } catch {
      setError('auth-error', 'Incorrect password. Please try again.');
      $('auth-pw').value = '';
      $('auth-pw').focus();
    } finally {
      hideLoading();
    }
  }

  /* ─── LOCK ─── */
  function lock() {
    clearTimeout(idleTimer);
    vaultKey = null;
    entries  = [];
    $('auth-pw').value = '';
    clearError('auth-error');
    showScreen('auth');
    setTimeout(() => $('auth-pw').focus(), 100);
  }

  /* ─── RENDER ENTRIES ─── */
  function renderEntries(filter = '') {
    const list = $('entry-list');
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? entries.filter(e =>
          e.title.toLowerCase().includes(q) ||
          (e.username || '').toLowerCase().includes(q) ||
          (e.url || '').toLowerCase().includes(q))
      : entries;

    // Sort alphabetically
    const sorted = [...filtered].sort((a, b) => a.title.localeCompare(b.title));

    list.innerHTML = '';
    if (sorted.length === 0) {
      show('empty-state');
      return;
    }
    hide('empty-state');

    sorted.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'entry-card';

      const initial = entry.title[0]?.toUpperCase() ?? '?';
      const sub = entry.username || entry.url || '—';
      const color = entryColor(entry.title);

      card.innerHTML = `
        <div class="entry-initial" style="background:${color}">${initial}</div>
        <div class="entry-info">
          <div class="entry-title">${escHtml(entry.title)}</div>
          <div class="entry-sub">${escHtml(sub)}</div>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" title="Copy password" data-id="${entry.id}" data-action="copy">📋</button>
          <button class="entry-btn" title="Edit" data-id="${entry.id}" data-action="edit">✏️</button>
          <button class="entry-btn danger" title="Delete" data-id="${entry.id}" data-action="delete">🗑</button>
        </div>`;
      list.appendChild(card);
    });

    list.querySelectorAll('.entry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { id, action } = btn.dataset;
        if (action === 'copy')   copyPassword(id);
        if (action === 'edit')   openEditEntry(id);
        if (action === 'delete') deleteEntry(id);
      });
    });
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function search(q) { renderEntries(q); }

  /* ─── COPY PASSWORD ─── */
  let clipTimer;
  function copyPassword(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    navigator.clipboard.writeText(entry.password).then(() => {
      toast(`Password copied — clears in 30 s`);
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {});
      }, 30_000);
    }).catch(() => toast('Could not access clipboard'));
    resetIdle();
  }

  /* ─── ADD / EDIT ENTRY ─── */
  function openAddEntry() {
    editingId = null;
    $('entry-modal-title').textContent = 'Add Password';
    ['e-title','e-username','e-password','e-url','e-notes'].forEach(id => {
      const el = $(id);
      if (el.tagName === 'TEXTAREA') el.value = '';
      else el.value = '';
    });
    $('e-password').type = 'password';
    clearError('entry-error');
    show('modal-entry');
    setTimeout(() => $('e-title').focus(), 100);
  }

  function openEditEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    editingId = id;
    $('entry-modal-title').textContent = 'Edit Password';
    $('e-title').value    = entry.title;
    $('e-username').value = entry.username ?? '';
    $('e-password').value = entry.password;
    $('e-url').value      = entry.url ?? '';
    $('e-notes').value    = entry.notes ?? '';
    $('e-password').type  = 'password';
    clearError('entry-error');
    show('modal-entry');
  }

  function closeEntry() { hide('modal-entry'); }

  async function saveEntry() {
    clearError('entry-error');
    const title    = $('e-title').value.trim();
    const username = $('e-username').value.trim();
    const password = $('e-password').value;
    const url      = $('e-url').value.trim();
    const notes    = $('e-notes').value.trim();

    if (!title)    return setError('entry-error', 'Title is required.');
    if (!password) return setError('entry-error', 'Password is required.');

    const now = Date.now();
    if (editingId) {
      const idx = entries.findIndex(e => e.id === editingId);
      if (idx >= 0) entries[idx] = { ...entries[idx], title, username, password, url, notes, updatedAt: now };
    } else {
      entries.push({
        id: crypto.randomUUID(),
        title, username, password, url, notes,
        createdAt: now, updatedAt: now,
      });
    }

    await persistEntries();
    closeEntry();
    renderEntries($('search').value);
    toast(editingId ? 'Entry updated' : 'Entry saved');
    resetIdle();
  }

  /* ─── DELETE ─── */
  async function deleteEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    if (!confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    entries = entries.filter(e => e.id !== id);
    await persistEntries();
    renderEntries($('search').value);
    toast('Entry deleted');
    resetIdle();
  }

  /* ─── PERSIST ─── */
  async function persistEntries() {
    const record = await Storage.load();
    const { iv, data } = await Crypto.encrypt(entries, vaultKey);
    await Storage.save({ ...record, vaultIv: iv, vaultData: data });
  }

  /* ─── GENERATE PASSWORD ─── */
  function fillGeneratedPassword() {
    const pw = Crypto.generatePassword(20);
    $('e-password').value = pw;
    $('e-password').type  = 'text';
    toast('Strong password generated!');
  }

  /* ─── SETTINGS ─── */
  function showSettings() {
    ['s-current','s-new','s-confirm'].forEach(id => $(id).value = '');
    clearError('settings-error');
    show('modal-settings');
  }

  function closeSettings() { hide('modal-settings'); }

  async function changePassword() {
    clearError('settings-error');
    const current = $('s-current').value;
    const pw      = $('s-new').value;
    const confirm = $('s-confirm').value;

    if (!current)       return setError('settings-error', 'Enter your current password.');
    if (pw.length < 8)  return setError('settings-error', 'New password must be at least 8 characters.');
    if (pw !== confirm) return setError('settings-error', 'New passwords do not match.');

    showLoading('Changing password…');
    try {
      // Verify current password
      const record      = await Storage.load();
      const salt        = Crypto.fromB64(record.salt);
      const oldWrapping = await Crypto.deriveWrappingKey(current, salt);
      await Crypto.unwrapVaultKey(record.wrappedKey, oldWrapping); // throws if wrong

      // Re-wrap vault key with new password
      const newSalt     = Crypto.randomBytes(32);
      const newWrapping = await Crypto.deriveWrappingKey(pw, newSalt);
      const wrappedKey  = await Crypto.wrapVaultKey(vaultKey, newWrapping);

      await Storage.save({ ...record, salt: Crypto.toB64(newSalt), wrappedKey });
      closeSettings();
      toast('Password changed successfully!');
    } catch (e) {
      if (e?.message?.includes('unwrap') || String(e).includes('OperationError')) {
        setError('settings-error', 'Current password is incorrect.');
      } else {
        setError('settings-error', 'Failed to change password. Try again.');
        console.error(e);
      }
    } finally {
      hideLoading();
    }
  }

  /* ─── Start ─── */
  document.addEventListener('DOMContentLoaded', init);

  return {
    createVault, unlock, lock, search,
    openAddEntry, closeEntry, saveEntry, fillGeneratedPassword,
    showSettings, closeSettings, changePassword,
  };
})();
