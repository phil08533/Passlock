'use strict';

/**
 * Passlock App — main UI and state logic.
 * Features: password vault, file vault, 5 themes, PIN unlock, encrypted backup.
 */
const App = (() => {

  /* ─── State ─── */
  let vaultKey    = null;   // CryptoKey | null — cleared on lock
  let entries     = [];     // PasswordEntry[]
  let editingId   = null;   // string | null
  let idleTimer   = null;
  let pinInput    = '';     // current PIN digit buffer
  let pinAttempts = 0;      // wrong PIN counter (max 3 before falling back to password)

  const IDLE_MS        = 5 * 60 * 1000;
  const MAX_PIN_TRIES  = 3;

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

  /* ─── DOM helpers ─── */
  const $    = id => document.getElementById(id);
  const show = id => $(id).classList.remove('hidden');
  const hide = id => $(id).classList.add('hidden');

  function showScreen(name) {
    ['screen-setup', 'screen-auth', 'screen-vault'].forEach(s => hide(s));
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

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─── THEME ─── */
  function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('passlock-theme', name);
    document.querySelectorAll('.theme-swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.theme === name)
    );
  }

  /* ─── TAB SWITCHING ─── */
  function switchTab(name) {
    ['passwords', 'files'].forEach(t => {
      $(`tab-content-${t}`).classList.toggle('hidden', t !== name);
      $(`tab-${t}`).classList.toggle('active', t === name);
    });
  }

  /* ─── PIN DISPLAY ─── */
  function updatePinDisplay() {
    $('pin-display').textContent =
      pinInput.length === 0 ? '○ ○ ○ ○' : '● '.repeat(pinInput.length).trim();
  }

  /* ─── PIN PAD ─── */
  function pinDigit(d) {
    if (pinInput.length >= 6) return;
    pinInput += d;
    updatePinDisplay();
    clearError('pin-error');
  }

  function pinClear() {
    pinInput = pinInput.slice(0, -1);
    updatePinDisplay();
  }

  async function pinSubmit() {
    if (pinInput.length < 4) {
      setError('pin-error', 'PIN must be at least 4 digits.');
      return;
    }
    showLoading('Unlocking…');
    try {
      const record      = await Storage.load();
      const pinSalt     = Crypto.fromB64(record.pinSalt);
      const pinWrapping = await Crypto.deriveWrappingKeyFromPin(pinInput, pinSalt);
      const key         = await Crypto.unwrapVaultKey(record.pinWrappedKey, pinWrapping);
      const loaded      = await Crypto.decrypt({ iv: record.vaultIv, data: record.vaultData }, key);

      vaultKey    = key;
      entries     = loaded;
      pinInput    = '';
      pinAttempts = 0;
      updatePinDisplay();
      showScreen('vault');
      switchTab('passwords');
      renderEntries();
      resetIdle();
    } catch {
      pinAttempts++;
      if (pinAttempts >= MAX_PIN_TRIES) {
        pinInput    = '';
        pinAttempts = 0;
        updatePinDisplay();
        showPasswordForm();
        setError('auth-error', 'Too many incorrect PINs — enter your master password.');
      } else {
        setError('pin-error', `Incorrect PIN (${MAX_PIN_TRIES - pinAttempts} attempt(s) left).`);
        pinInput = '';
        updatePinDisplay();
      }
    } finally {
      hideLoading();
    }
  }

  function showPasswordForm() {
    hide('pin-section');
    show('pw-section');
    Storage.load().then(r => {
      if (r?.pinWrappedKey) show('switch-to-pin');
      else hide('switch-to-pin');
    }).catch(() => hide('switch-to-pin'));
    setTimeout(() => $('auth-pw').focus(), 100);
  }

  function showPinForm() {
    pinInput = '';
    updatePinDisplay();
    clearError('pin-error');
    show('pin-section');
    hide('pw-section');
  }

  /* ─── BOOT ─── */
  async function init() {
    // Load saved theme
    const savedTheme = localStorage.getItem('passlock-theme') || 'dark';
    setTheme(savedTheme);

    // Eye-toggle buttons
    document.querySelectorAll('.eye-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.for);
        if (!target) return;
        target.type = target.type === 'password' ? 'text' : 'password';
        btn.textContent = target.type === 'password' ? '👁' : '🙈';
      });
    });

    // Enter-key shortcuts
    $('auth-pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
    $('setup-pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('setup-confirm').focus(); });
    $('setup-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') $('setup-pin').focus(); });

    // Idle reset
    document.addEventListener('pointerdown', resetIdle);
    document.addEventListener('keydown', resetIdle);

    // Lock when tab hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && vaultKey) {
        setTimeout(() => { if (document.hidden) lock(); }, IDLE_MS);
      }
    });

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Route to correct screen
    const hasVault = await Storage.exists();
    if (!hasVault) {
      showScreen('setup');
      setTimeout(() => $('setup-pw').focus(), 100);
      return;
    }

    showScreen('auth');
    try {
      const record = await Storage.load();
      if (record?.pinWrappedKey) {
        show('pin-section');
        hide('pw-section');
        updatePinDisplay();
      } else {
        hide('pin-section');
        show('pw-section');
        hide('switch-to-pin');
        setTimeout(() => $('auth-pw').focus(), 100);
      }
    } catch {
      hide('pin-section');
      show('pw-section');
      hide('switch-to-pin');
      setTimeout(() => $('auth-pw').focus(), 100);
    }
  }

  /* ─── CREATE VAULT (first time) ─── */
  async function createVault() {
    clearError('setup-error');
    const pw  = $('setup-pw').value;
    const pw2 = $('setup-confirm').value;
    const pin = $('setup-pin').value.trim();

    if (pw.length < 8)                    return setError('setup-error', 'Password must be at least 8 characters.');
    if (pw !== pw2)                        return setError('setup-error', 'Passwords do not match.');
    if (pin && !/^\d{4,6}$/.test(pin))   return setError('setup-error', 'PIN must be 4–6 digits (or leave blank).');

    showLoading('Creating your vault…');
    try {
      const salt        = Crypto.randomBytes(32);
      const wrappingKey = await Crypto.deriveWrappingKey(pw, salt);
      const newKey      = await Crypto.generateVaultKey();
      const wrappedKey  = await Crypto.wrapVaultKey(newKey, wrappingKey);
      const { iv, data } = await Crypto.encrypt([], newKey);

      const record = {
        version:   1,
        salt:      Crypto.toB64(salt),
        wrappedKey,
        vaultIv:   iv,
        vaultData: data,
      };

      // Optional PIN
      if (pin) {
        const pSalt    = Crypto.randomBytes(32);
        const pWrap    = await Crypto.deriveWrappingKeyFromPin(pin, pSalt);
        record.pinSalt       = Crypto.toB64(pSalt);
        record.pinWrappedKey = await Crypto.wrapVaultKey(newKey, pWrap);
      }

      await Storage.save(record);
      vaultKey = newKey;
      entries  = [];
      $('setup-pw').value      = '';
      $('setup-confirm').value = '';
      $('setup-pin').value     = '';
      showScreen('vault');
      switchTab('passwords');
      renderEntries();
      resetIdle();
    } catch (e) {
      setError('setup-error', 'Failed to create vault. Please try again.');
      console.error(e);
    } finally {
      hideLoading();
    }
  }

  /* ─── UNLOCK (password) ─── */
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
      const loaded      = await Crypto.decrypt({ iv: record.vaultIv, data: record.vaultData }, key);

      vaultKey = key;
      entries  = loaded;
      $('auth-pw').value = '';
      showScreen('vault');
      switchTab('passwords');
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
  async function lock() {
    clearTimeout(idleTimer);
    vaultKey    = null;
    entries     = [];
    pinInput    = '';
    pinAttempts = 0;
    $('auth-pw').value = '';
    clearError('auth-error');
    clearError('pin-error');
    showScreen('auth');

    try {
      const record = await Storage.load();
      if (record?.pinWrappedKey) {
        show('pin-section');
        hide('pw-section');
        updatePinDisplay();
      } else {
        hide('pin-section');
        show('pw-section');
        hide('switch-to-pin');
        setTimeout(() => $('auth-pw').focus(), 100);
      }
    } catch {
      hide('pin-section');
      show('pw-section');
      hide('switch-to-pin');
      setTimeout(() => $('auth-pw').focus(), 100);
    }
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

    const sorted = [...filtered].sort((a, b) => a.title.localeCompare(b.title));

    list.innerHTML = '';
    if (sorted.length === 0) {
      show('empty-state');
      return;
    }
    hide('empty-state');

    sorted.forEach(entry => {
      const card  = document.createElement('div');
      card.className = 'entry-card';
      const color = entryColor(entry.title);
      const sub   = entry.username || entry.url || '—';

      card.innerHTML = `
        <div class="entry-initial" style="background:${color}">${escHtml(entry.title[0]?.toUpperCase() ?? '?')}</div>
        <div class="entry-info">
          <div class="entry-title">${escHtml(entry.title)}</div>
          <div class="entry-sub">${escHtml(sub)}</div>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" title="Copy password" data-id="${entry.id}" data-action="copy">📋</button>
          <button class="entry-btn" title="Edit"          data-id="${entry.id}" data-action="edit">✏️</button>
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

  function search(q) { renderEntries(q); }

  /* ─── COPY PASSWORD ─── */
  let clipTimer;
  function copyPassword(id) {
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    navigator.clipboard.writeText(entry.password).then(() => {
      toast('Password copied — clears in 30 s');
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30_000);
    }).catch(() => toast('Could not access clipboard'));
    resetIdle();
  }

  /* ─── ADD / EDIT ENTRY ─── */
  function openAddEntry() {
    editingId = null;
    $('entry-modal-title').textContent = 'Add Password';
    ['e-title', 'e-username', 'e-password', 'e-url', 'e-notes'].forEach(id => $(id).value = '');
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
      entries.push({ id: crypto.randomUUID(), title, username, password, url, notes, createdAt: now, updatedAt: now });
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
  async function showSettings() {
    ['s-current', 's-new', 's-confirm'].forEach(id => $(id).value = '');
    $('new-pin').value     = '';
    $('confirm-pin').value = '';
    clearError('settings-error');
    clearError('pin-setup-error');
    hide('pin-setup-form');
    show('pin-action-btns');
    await updatePinStatus();
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    document.querySelectorAll('.theme-swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.theme === theme)
    );
    show('modal-settings');
  }

  function closeSettings() { hide('modal-settings'); }

  /* ─── PIN SETTINGS ─── */
  async function updatePinStatus() {
    try {
      const record  = await Storage.load();
      const hasPin  = !!(record?.pinWrappedKey);
      $('pin-status-text').textContent   = hasPin ? 'PIN unlock is currently ON.' : 'PIN unlock is OFF.';
      $('btn-toggle-pin').textContent    = hasPin ? 'Remove PIN' : 'Set PIN';
    } catch { /* ignore */ }
  }

  async function togglePinSetup() {
    const record = await Storage.load().catch(() => null);
    if (record?.pinWrappedKey) {
      if (!confirm('Remove PIN unlock from this vault?')) return;
      const { pinSalt: _ps, pinWrappedKey: _pk, ...rest } = record;
      await Storage.save(rest);
      await updatePinStatus();
      toast('PIN removed');
    } else {
      $('new-pin').value     = '';
      $('confirm-pin').value = '';
      clearError('pin-setup-error');
      show('pin-setup-form');
      hide('pin-action-btns');
    }
  }

  async function savePin() {
    clearError('pin-setup-error');
    const pin     = $('new-pin').value.trim();
    const confirm = $('confirm-pin').value.trim();

    if (!/^\d{4,6}$/.test(pin))  return setError('pin-setup-error', 'PIN must be 4–6 digits.');
    if (pin !== confirm)          return setError('pin-setup-error', 'PINs do not match.');

    showLoading('Saving PIN…');
    try {
      const record  = await Storage.load();
      const pSalt   = Crypto.randomBytes(32);
      const pWrap   = await Crypto.deriveWrappingKeyFromPin(pin, pSalt);
      const pWrapped = await Crypto.wrapVaultKey(vaultKey, pWrap);

      await Storage.save({ ...record, pinSalt: Crypto.toB64(pSalt), pinWrappedKey: pWrapped });

      $('new-pin').value     = '';
      $('confirm-pin').value = '';
      hide('pin-setup-form');
      show('pin-action-btns');
      await updatePinStatus();
      toast('PIN set! You can now use it to unlock.');
    } catch (e) {
      setError('pin-setup-error', 'Failed to save PIN. Try again.');
      console.error(e);
    } finally {
      hideLoading();
    }
  }

  function cancelPinSetup() {
    hide('pin-setup-form');
    show('pin-action-btns');
    clearError('pin-setup-error');
  }

  /* ─── CHANGE PASSWORD ─── */
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
      const record      = await Storage.load();
      const salt        = Crypto.fromB64(record.salt);
      const oldWrapping = await Crypto.deriveWrappingKey(current, salt);
      await Crypto.unwrapVaultKey(record.wrappedKey, oldWrapping); // throws if wrong

      const newSalt     = Crypto.randomBytes(32);
      const newWrapping = await Crypto.deriveWrappingKey(pw, newSalt);
      const wrappedKey  = await Crypto.wrapVaultKey(vaultKey, newWrapping);

      await Storage.save({ ...record, salt: Crypto.toB64(newSalt), wrappedKey });
      ['s-current', 's-new', 's-confirm'].forEach(id => $(id).value = '');
      closeSettings();
      toast('Password changed successfully!');
    } catch (e) {
      const msg = String(e);
      if (msg.includes('OperationError') || msg.includes('unwrap')) {
        setError('settings-error', 'Current password is incorrect.');
      } else {
        setError('settings-error', 'Failed to change password. Try again.');
        console.error(e);
      }
    } finally {
      hideLoading();
    }
  }

  /* ─── FILE VAULT — ENCRYPT ─── */
  async function lockFiles(input) {
    const files = Array.from(input.files);
    if (!files.length) return;
    input.value = '';
    if (!vaultKey) { toast('Vault is locked — please unlock first.'); return; }

    show('file-progress');
    try {
      const fileData = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        $('file-progress-msg').textContent = `Encrypting ${i + 1}/${files.length}: ${f.name}…`;
        const buf        = await f.arrayBuffer();
        const { iv, data } = await Crypto.encryptBytes(buf, vaultKey);
        fileData.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, iv, data });
      }

      const vault = JSON.stringify({ version: 1, type: 'passlock-vault', files: fileData });
      const blob  = new Blob([vault], { type: 'application/octet-stream' });
      const url   = URL.createObjectURL(blob);
      const date  = new Date().toISOString().split('T')[0];

      const a = document.createElement('a');
      a.href = url; a.download = `files-${date}.vault`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast(`${files.length} file(s) encrypted → files-${date}.vault`, 3500);
    } catch (e) {
      toast('Encryption failed: ' + e.message);
      console.error(e);
    } finally {
      hide('file-progress');
      $('file-progress-msg').textContent = 'Working…';
    }
  }

  /* ─── FILE VAULT — DECRYPT ─── */
  async function unlockFiles(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (!vaultKey) { toast('Vault is locked — please unlock first.'); return; }

    show('file-progress');
    try {
      const text  = await file.text();
      const vault = JSON.parse(text);

      if (vault.type !== 'passlock-vault' || !Array.isArray(vault.files)) {
        throw new Error('Not a valid .vault file created by Passlock.');
      }

      for (let i = 0; i < vault.files.length; i++) {
        const f = vault.files[i];
        $('file-progress-msg').textContent = `Decrypting ${i + 1}/${vault.files.length}: ${f.name}…`;
        const buf  = await Crypto.decryptBytes(f.iv, f.data, vaultKey);
        const blob = new Blob([buf], { type: f.type });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        // brief pause between downloads so browser doesn't block them
        if (vault.files.length > 1) await new Promise(r => setTimeout(r, 150));
      }

      toast(`${vault.files.length} file(s) decrypted!`, 3000);
    } catch (e) {
      toast('Decryption failed: ' + e.message);
      console.error(e);
    } finally {
      hide('file-progress');
      $('file-progress-msg').textContent = 'Working…';
    }
  }

  /* ─── EXPORT BACKUP ─── */
  async function exportBackup() {
    showLoading('Preparing backup…');
    try {
      const record = await Storage.load();
      if (!record) { toast('No vault to export.'); return; }

      const { id: _id, ...exportData } = record;
      exportData.exportedAt = new Date().toISOString();
      exportData.appVersion = 1;

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const date = new Date().toISOString().split('T')[0];

      const a = document.createElement('a');
      a.href = url; a.download = `passlock-backup-${date}.passlock`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast('Backup downloaded! Store it somewhere safe.', 3500);
    } finally {
      hideLoading();
    }
  }

  /* ─── IMPORT HELPERS ─── */
  function validateBackupRecord(r) {
    if (!r || typeof r !== 'object')     throw new Error('Not a valid backup file.');
    if (!r.version || !r.salt)           throw new Error('Missing vault metadata.');
    if (!r.wrappedKey)                   throw new Error('Missing encryption key data.');
    if (!r.vaultIv || !r.vaultData)     throw new Error('Missing encrypted vault data.');
  }

  async function readFileAsJSON(file) {
    const text = await file.text();
    try { return JSON.parse(text); }
    catch { throw new Error('File is not valid JSON.'); }
  }

  async function verifyAndLoad(record, password) {
    const salt        = Crypto.fromB64(record.salt);
    const wrappingKey = await Crypto.deriveWrappingKey(password, salt);
    const key         = await Crypto.unwrapVaultKey(record.wrappedKey, wrappingKey);
    const loaded      = await Crypto.decrypt({ iv: record.vaultIv, data: record.vaultData }, key);
    return { key, entries: loaded };
  }

  /* ─── IMPORT FROM AUTH SCREEN ─── */
  async function importFromAuth(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';

    let record;
    try { record = await readFileAsJSON(file); validateBackupRecord(record); }
    catch (e) { alert(e.message); return; }

    const pw = prompt('Enter the master password for this backup:');
    if (!pw) return;

    showLoading('Restoring backup…');
    try {
      const { key, entries: loaded } = await verifyAndLoad(record, pw);
      const { id: _id, exportedAt: _e, appVersion: _a, ...vaultRecord } = record;
      await Storage.save(vaultRecord);
      vaultKey = key;
      entries  = loaded;
      showScreen('vault');
      switchTab('passwords');
      renderEntries();
      resetIdle();
      toast(`Restored ${loaded.length} password(s) from backup!`, 3000);
    } catch {
      alert('Incorrect password for this backup, or the file is corrupted.');
    } finally {
      hideLoading();
    }
  }

  /* ─── IMPORT FROM SETTINGS ─── */
  async function importFromSettings(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';

    let record;
    try { record = await readFileAsJSON(file); validateBackupRecord(record); }
    catch (e) { setError('settings-error', e.message); return; }

    const pw = prompt('Enter the master password for this backup to verify it:');
    if (!pw) return;
    if (!confirm('This will REPLACE your current vault with the backup. Continue?')) return;

    showLoading('Restoring backup…');
    try {
      const { key, entries: loaded } = await verifyAndLoad(record, pw);
      const { id: _id, exportedAt: _e, appVersion: _a, ...vaultRecord } = record;
      await Storage.save(vaultRecord);
      vaultKey = key;
      entries  = loaded;
      closeSettings();
      renderEntries($('search').value);
      toast(`Restored ${loaded.length} password(s) from backup!`, 3000);
    } catch {
      setError('settings-error', 'Incorrect password or corrupted backup file.');
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
    exportBackup, importFromAuth, importFromSettings,
    // PIN
    pinDigit, pinClear, pinSubmit, showPasswordForm, showPinForm,
    // Settings extras
    setTheme, togglePinSetup, savePin, cancelPinSetup,
    // Tab + file vault
    switchTab, lockFiles, unlockFiles,
  };
})();
