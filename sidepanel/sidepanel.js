/**
 * Meta.ai AutoPrompt - Side Panel Controller Pro
 * 4-Phase System: Queue Manager, Matrix Generator, History & Gallery, Stats & Settings.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements: Navigation Tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = {
    queue: document.getElementById('tabContentQueue'),
    matrix: document.getElementById('tabContentMatrix'),
    history: document.getElementById('tabContentHistory'),
    settings: document.getElementById('tabContentSettings')
  };
  const tabCountBadge = document.getElementById('tabCountBadge');
  const historyCountBadge = document.getElementById('historyCountBadge');

  // Elements: Header & Indicator
  const statusBadge = document.getElementById('statusBadge');
  const tabIndicator = document.getElementById('tabIndicator');
  const tabIndicatorText = document.getElementById('tabIndicatorText');
  const btnQuickFocus = document.getElementById('btnQuickFocus');

  // Elements: Progress Section
  const progressStepText = document.getElementById('progressStepText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const taskQueuePosition = document.getElementById('taskQueuePosition');
  const currentPromptPreview = document.getElementById('currentPromptPreview');
  const statusSpinner = document.getElementById('statusSpinner');
  const statusDetailText = document.getElementById('statusDetailText');

  // Elements: Tab 1 - Queue
  const btnViewText = document.getElementById('btnViewText');
  const btnViewVisual = document.getElementById('btnViewVisual');
  const viewModeText = document.getElementById('viewModeText');
  const viewModeVisual = document.getElementById('viewModeVisual');
  const promptInput = document.getElementById('promptInput');
  const delimiterToggle = document.getElementById('delimiterToggle');
  const visualQueueList = document.getElementById('visualQueueList');
  const btnLoadSample = document.getElementById('btnLoadSample');
  const btnClearInput = document.getElementById('btnClearInput');
  const btnImportQueue = document.getElementById('btnImportQueue');
  const btnExportQueue = document.getElementById('btnExportQueue');
  const fileImporter = document.getElementById('fileImporter');

  // Elements: Tab 2 - Matrix Generator
  const matrixTemplateInput = document.getElementById('matrixTemplateInput');
  const btnGenerateMatrix = document.getElementById('btnGenerateMatrix');
  const btnMatrixSample = document.getElementById('btnMatrixSample');
  const matrixPreviewSection = document.getElementById('matrixPreviewSection');
  const matrixPreviewCount = document.getElementById('matrixPreviewCount');
  const matrixResultList = document.getElementById('matrixResultList');
  const btnApplyMatrixToQueue = document.getElementById('btnApplyMatrixToQueue');
  let currentGeneratedMatrixPrompts = [];

  // Elements: Tab 3 - History & Gallery
  const historyTotalBadge = document.getElementById('historyTotalBadge');
  const historyListContainer = document.getElementById('historyListContainer');
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const historyFilterPills = document.querySelectorAll('.history-filter-pills .pill-btn');
  let activeHistoryFilter = 'all';

  // Elements: Tab 4 - Stats & Settings
  const statTotalProcessed = document.getElementById('statTotalProcessed');
  const statTotalImages = document.getElementById('statTotalImages');
  const statSuccessRate = document.getElementById('statSuccessRate');
  const statAvgDuration = document.getElementById('statAvgDuration');

  const autoDownloadImages = document.getElementById('autoDownloadImages');
  const alwaysNewChat = document.getElementById('alwaysNewChat');
  const maxConcurrent = document.getElementById('maxConcurrent');
  const maxRetries = document.getElementById('maxRetries');
  const delayAfterResponse = document.getElementById('delayAfterResponse');
  const maxTimeout = document.getElementById('maxTimeout');
  const audioChimeToggle = document.getElementById('audioChimeToggle');
  const systemNotificationsToggle = document.getElementById('systemNotificationsToggle');

  // Elements: Action Controls
  const btnStart = document.getElementById('btnStart');
  const btnStartText = document.getElementById('btnStartText');
  const btnPause = document.getElementById('btnPause');
  const btnStop = document.getElementById('btnStop');
  const btnOpenMeta = document.getElementById('btnOpenMeta');

  // ==========================================
  // INITIAL DATA LOAD
  // ==========================================

  const store = await chrome.storage.local.get([
    'draftText',
    'queue',
    'currentIndex',
    'status',
    'statusDetail',
    'settings',
    'executionHistory',
    'stats'
  ]);

  if (store.draftText !== undefined) {
    promptInput.value = store.draftText;
  }

  const userSettings = store.settings || {};
  if (userSettings.delayAfterResponse !== undefined) delayAfterResponse.value = userSettings.delayAfterResponse;
  if (userSettings.maxConcurrent !== undefined) maxConcurrent.value = userSettings.maxConcurrent;
  if (userSettings.maxRetries !== undefined) maxRetries.value = userSettings.maxRetries;
  if (userSettings.maxTimeout !== undefined) maxTimeout.value = userSettings.maxTimeout;
  if (userSettings.alwaysNewChat !== undefined) alwaysNewChat.checked = userSettings.alwaysNewChat;
  if (userSettings.autoDownloadImages !== undefined) autoDownloadImages.checked = userSettings.autoDownloadImages;
  if (userSettings.useDelimiter !== undefined) delimiterToggle.checked = userSettings.useDelimiter;
  if (userSettings.audioChime !== undefined) audioChimeToggle.checked = userSettings.audioChime;
  if (userSettings.systemNotifications !== undefined) systemNotificationsToggle.checked = userSettings.systemNotifications;

  updateQueueCountAndVisuals(store.queue || parsePrompts(promptInput.value, delimiterToggle.checked), store.currentIndex || 0);
  applyState(store.status || 'idle', store.currentIndex || 0, store.queue || [], store.statusDetail);
  renderHistory(store.executionHistory || []);
  updateStats(store.executionHistory || []);

  checkMetaTabStatus();
  setInterval(checkMetaTabStatus, 2500);

  // ==========================================
  // NAVIGATION TABS
  // ==========================================

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      Object.keys(tabPanes).forEach(k => {
        if (tabPanes[k]) {
          tabPanes[k].classList.toggle('active', k === target);
        }
      });
    });
  });

  // ==========================================
  // TAB 1: QUEUE MANAGER & VIEW SWITCHER
  // ==========================================

  btnViewText.addEventListener('click', () => {
    btnViewText.classList.add('active');
    btnViewVisual.classList.remove('active');
    viewModeText.classList.add('active');
    viewModeVisual.classList.remove('active');
  });

  btnViewVisual.addEventListener('click', async () => {
    btnViewVisual.classList.add('active');
    btnViewText.classList.remove('active');
    viewModeVisual.classList.add('active');
    viewModeText.classList.remove('active');

    const data = await chrome.storage.local.get(['queue', 'currentIndex']);
    const currentQueue = (data.queue && data.queue.length > 0)
      ? data.queue
      : parsePrompts(promptInput.value, delimiterToggle.checked);
    renderVisualQueue(currentQueue, data.currentIndex || 0);
  });

  promptInput.addEventListener('input', () => {
    chrome.storage.local.set({ draftText: promptInput.value });
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    updateQueueCountAndVisuals(prompts, 0);
  });

  delimiterToggle.addEventListener('change', () => {
    saveSettings();
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    updateQueueCountAndVisuals(prompts, 0);
  });

  btnLoadSample.addEventListener('click', () => {
    const samples = [
      "buatkan gambar kucing 3d oren gemoy dengan syal hijau rajutan",
      "buatkan gambar kafe estetik bernuansa senja di Kyoto saat musim gugur",
      "jelaskan secara sederhana apa itu artificial intelligence dan machine learning"
    ];
    promptInput.value = samples.join('\n');
    chrome.storage.local.set({ draftText: promptInput.value });
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    updateQueueCountAndVisuals(prompts, 0);
  });

  btnClearInput.addEventListener('click', () => {
    if (confirm('Bersihkan semua teks prompt di antrian?')) {
      promptInput.value = '';
      chrome.storage.local.set({ draftText: '' });
      updateQueueCountAndVisuals([], 0);
    }
  });

  // Import Queue from File
  btnImportQueue.addEventListener('click', () => {
    fileImporter.click();
  });

  fileImporter.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : (parsed.queue || []);
          promptInput.value = list.map(item => (typeof item === 'string' ? item : item.prompt || '')).join('\n');
        } else {
          promptInput.value = text;
        }
        chrome.storage.local.set({ draftText: promptInput.value });
        const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
        updateQueueCountAndVisuals(prompts, 0);
        alert(`Berhasil mengimpor ${prompts.length} prompt!`);
      } catch (err) {
        alert('Gagal membaca berkas: ' + err.message);
      }
      fileImporter.value = '';
    };
    reader.readAsText(file);
  });

  // Export Queue to File
  btnExportQueue.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['queue']);
    const currentQueue = (data.queue && data.queue.length > 0)
      ? data.queue
      : parsePrompts(promptInput.value, delimiterToggle.checked);

    if (currentQueue.length === 0) {
      alert('Antrian kosong, tidak ada yang dapat diekspor.');
      return;
    }

    const blob = new Blob([currentQueue.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meta_autoprompt_queue_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Visual Queue Render
  function renderVisualQueue(queue, currentIndex) {
    visualQueueList.innerHTML = '';

    if (queue.length === 0) {
      visualQueueList.innerHTML = '<div class="empty-state">Antrian kosong. Masukkan teks prompt di tab "Teks".</div>';
      return;
    }

    queue.forEach((prompt, idx) => {
      const card = document.createElement('div');
      let statusClass = 'pending';
      let statusLabel = 'Menunggu';

      if (idx < currentIndex) {
        statusClass = 'completed';
        statusLabel = 'Selesai';
      } else if (idx === currentIndex) {
        statusClass = 'running';
        statusLabel = 'Aktif';
      }

      card.className = `queue-item-card ${statusClass}`;
      card.innerHTML = `
        <div class="queue-item-header">
          <span class="queue-index-badge">#${idx + 1}</span>
          <span class="queue-status-chip ${statusClass}">${statusLabel}</span>
        </div>
        <div class="queue-prompt-text">${escapeHtml(prompt)}</div>
        <div class="queue-actions-row">
          <button class="action-icon-btn btn-move-up" title="Geser ke atas" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="action-icon-btn btn-move-down" title="Geser ke bawah" ${idx === queue.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="action-icon-btn delete btn-delete-item" title="Hapus dari antrian">✕</button>
        </div>
      `;

      // Handlers
      card.querySelector('.btn-move-up')?.addEventListener('click', () => moveQueueItem(queue, idx, idx - 1));
      card.querySelector('.btn-move-down')?.addEventListener('click', () => moveQueueItem(queue, idx, idx + 1));
      card.querySelector('.btn-delete-item')?.addEventListener('click', () => deleteQueueItem(queue, idx));

      visualQueueList.appendChild(card);
    });
  }

  async function moveQueueItem(queue, from, to) {
    if (to < 0 || to >= queue.length) return;
    const temp = queue[from];
    queue[from] = queue[to];
    queue[to] = temp;

    promptInput.value = queue.join('\n');
    await chrome.storage.local.set({ queue, draftText: promptInput.value });
    const data = await chrome.storage.local.get(['currentIndex']);
    updateQueueCountAndVisuals(queue, data.currentIndex || 0);
  }

  async function deleteQueueItem(queue, index) {
    queue.splice(index, 1);
    promptInput.value = queue.join('\n');
    await chrome.storage.local.set({ queue, draftText: promptInput.value });
    const data = await chrome.storage.local.get(['currentIndex']);
    updateQueueCountAndVisuals(queue, data.currentIndex || 0);
  }

  function updateQueueCountAndVisuals(prompts, currentIndex) {
    tabCountBadge.textContent = prompts.length;
    renderVisualQueue(prompts, currentIndex);
  }

  // ==========================================
  // TAB 2: COMBINATORIAL MATRIX GENERATOR
  // ==========================================

  btnMatrixSample.addEventListener('click', () => {
    matrixTemplateInput.value = 'buatkan gambar [kucing, kelinci, panda] gaya [3d realistis, kartun disney] dengan warna [putih, oren]';
  });

  btnGenerateMatrix.addEventListener('click', () => {
    const template = matrixTemplateInput.value.trim();
    if (!template) {
      alert('Masukkan template dengan kurung siku [opsi1, opsi2] terlebih dahulu.');
      return;
    }

    const results = generateCombinations(template);
    currentGeneratedMatrixPrompts = results;

    matrixPreviewSection.style.display = 'flex';
    matrixPreviewCount.textContent = `${results.length} variasi prompt`;

    matrixResultList.innerHTML = '';
    results.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'matrix-item';
      item.textContent = `${idx + 1}. ${p}`;
      matrixResultList.appendChild(item);
    });
  });

  btnApplyMatrixToQueue.addEventListener('click', async () => {
    if (currentGeneratedMatrixPrompts.length === 0) return;

    const existingText = promptInput.value.trim();
    promptInput.value = existingText 
      ? existingText + '\n' + currentGeneratedMatrixPrompts.join('\n') 
      : currentGeneratedMatrixPrompts.join('\n');

    await chrome.storage.local.set({ draftText: promptInput.value });
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    updateQueueCountAndVisuals(prompts, 0);

    // Beralih ke tab antrian
    navTabs[0].click();
    alert(`Berhasil menambahkan ${currentGeneratedMatrixPrompts.length} prompt ke antrian!`);
  });

  /**
   * Cartesian Product Generator for [opt1, opt2]
   */
  function generateCombinations(template) {
    const matches = [];
    const regex = /\[(.*?)\]/g;
    let match;

    while ((match = regex.exec(template)) !== null) {
      matches.push({
        raw: match[0],
        options: match[1].split(',').map(s => s.trim()).filter(Boolean)
      });
    }

    if (matches.length === 0) {
      return [template];
    }

    let combinations = [''];
    let lastIndex = 0;

    matches.forEach(m => {
      const matchIndex = template.indexOf(m.raw, lastIndex);
      const prefix = template.substring(lastIndex, matchIndex);

      combinations = combinations.map(c => c + prefix);

      const nextCombos = [];
      combinations.forEach(combo => {
        m.options.forEach(opt => {
          nextCombos.push(combo + opt);
        });
      });
      combinations = nextCombos;
      lastIndex = matchIndex + m.raw.length;
    });

    const suffix = template.substring(lastIndex);
    return combinations.map(c => (c + suffix).replace(/\s+/g, ' ').trim());
  }

  // ==========================================
  // TAB 3: RIWAYAT & GALERI MEDIA
  // ==========================================

  historyFilterPills.forEach(pill => {
    pill.addEventListener('click', async () => {
      historyFilterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeHistoryFilter = pill.dataset.filter;

      const data = await chrome.storage.local.get(['executionHistory']);
      renderHistory(data.executionHistory || []);
    });
  });

  function renderHistory(history) {
    historyTotalBadge.textContent = `${history.length} item`;
    historyCountBadge.textContent = history.length;

    let filtered = history.slice().reverse();

    if (activeHistoryFilter === 'images') {
      filtered = filtered.filter(h => h.imageUrl || h.filename);
    } else if (activeHistoryFilter === 'success') {
      filtered = filtered.filter(h => h.status === 'success');
    } else if (activeHistoryFilter === 'failed') {
      filtered = filtered.filter(h => h.status === 'failed');
    }

    historyListContainer.innerHTML = '';

    if (filtered.length === 0) {
      historyListContainer.innerHTML = '<div class="empty-state">Tidak ada data riwayat yang sesuai filter.</div>';
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
      const durationStr = item.durationSec ? `${item.durationSec}s` : '-';
      const isSuccess = item.status === 'success';

      let mediaHtml = '';
      if (item.imageUrl) {
        mediaHtml = `
          <div class="history-media-row">
            <img class="thumb-preview" src="${item.imageUrl}" alt="Preview" title="Klik untuk membuka gambar">
            <div class="media-meta-info">
              <span class="media-filename">${escapeHtml(item.filename || 'Unduhan Gambar')}</span>
              <span class="media-status">✓ Tersimpan otomatis di folder Unduhan</span>
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="history-card-top">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="queue-status-chip ${isSuccess ? 'completed' : 'failed'}">${isSuccess ? 'BERHASIL' : 'GAGAL'}</span>
            <span class="history-time">${timeStr}</span>
          </div>
          <span class="history-duration-badge">⏱ ${durationStr}</span>
        </div>
        <div class="history-prompt">${escapeHtml(item.prompt)}</div>
        ${item.error ? `<div style="font-size: 10px; color: #f87171;">⚠️ ${escapeHtml(item.error)}</div>` : ''}
        ${mediaHtml}
      `;

      card.querySelector('.thumb-preview')?.addEventListener('click', () => {
        window.open(item.imageUrl, '_blank');
      });

      historyListContainer.appendChild(card);
    });
  }

  btnClearHistory.addEventListener('click', async () => {
    if (confirm('Hapus seluruh catatan riwayat dan galeri?')) {
      await chrome.storage.local.set({ executionHistory: [] });
      renderHistory([]);
      updateStats([]);
    }
  });

  btnExportCSV.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['executionHistory']);
    const history = data.executionHistory || [];
    if (history.length === 0) {
      alert('Riwayat masih kosong.');
      return;
    }

    const headers = ['ID', 'Prompt', 'Status', 'Durasi (Detik)', 'Waktu', 'File Gambar', 'Error'];
    const rows = history.map(h => [
      h.id || '',
      `"${(h.prompt || '').replace(/"/g, '""')}"`,
      h.status || '',
      h.durationSec || '',
      h.timestamp || '',
      h.filename || '',
      `"${(h.error || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csvContent, `meta_autoprompt_history_${Date.now()}.csv`, 'text/csv;charset=utf-8');
  });

  btnExportJSON.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['executionHistory']);
    const history = data.executionHistory || [];
    if (history.length === 0) {
      alert('Riwayat masih kosong.');
      return;
    }
    const jsonContent = JSON.stringify(history, null, 2);
    downloadFile(jsonContent, `meta_autoprompt_history_${Date.now()}.json`, 'application/json');
  });

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // TAB 4: STATS & SETTINGS
  // ==========================================

  function updateStats(history) {
    const total = history.length;
    const images = history.filter(h => h.imageUrl || h.filename).length;
    const success = history.filter(h => h.status === 'success').length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

    let totalDuration = 0;
    let countWithDuration = 0;
    history.forEach(h => {
      if (h.durationSec) {
        totalDuration += parseFloat(h.durationSec);
        countWithDuration++;
      }
    });

    const avg = countWithDuration > 0 ? (totalDuration / countWithDuration).toFixed(1) : '0';

    statTotalProcessed.textContent = total;
    statTotalImages.textContent = images;
    statSuccessRate.textContent = `${successRate}%`;
    statAvgDuration.textContent = `${avg}s`;
  }

  function saveSettings() {
    const settings = {
      delayAfterResponse: Math.max(1, parseInt(delayAfterResponse.value, 10) || 5),
      maxConcurrent: Math.max(1, parseInt(maxConcurrent.value, 10) || 5),
      maxRetries: Math.max(0, parseInt(maxRetries.value, 10) || 2),
      maxTimeout: Math.max(10, parseInt(maxTimeout.value, 10) || 90),
      alwaysNewChat: alwaysNewChat.checked,
      autoDownloadImages: autoDownloadImages.checked,
      useDelimiter: delimiterToggle.checked,
      audioChime: audioChimeToggle.checked,
      systemNotifications: systemNotificationsToggle.checked
    };
    chrome.storage.local.set({ settings });
  }

  [delayAfterResponse, maxConcurrent, maxRetries, maxTimeout, alwaysNewChat, autoDownloadImages, audioChimeToggle, systemNotificationsToggle].forEach(el => {
    el.addEventListener('change', saveSettings);
  });

  // ==========================================
  // AUDIO CHIME SYNTHESIZER (Web Audio API)
  // ==========================================

  function playChimeSound() {
    if (!audioChimeToggle.checked) return;

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // Chord C Major: C5, E5, G5, C6

      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0.15, audioCtx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.08 + 0.6);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(audioCtx.currentTime + idx * 0.08);
        osc.stop(audioCtx.currentTime + idx * 0.08 + 0.65);
      });
    } catch (e) {
      console.warn('[Meta AutoPrompt] Gagal memutar chime:', e);
    }
  }

  // ==========================================
  // QUEUE CONTROL BUTTONS
  // ==========================================

  btnStart.addEventListener('click', async () => {
    const currentStatus = (await chrome.storage.local.get('status')).status || 'idle';

    if (currentStatus === 'paused') {
      await chrome.storage.local.set({
        status: 'running',
        statusDetail: 'Melanjutkan antrian...'
      });
      await ensureMetaTabActive();
      notifyActiveTab();
      return;
    }

    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    if (prompts.length === 0) {
      alert('Silakan masukkan minimal 1 prompt sebelum memulai antrian.');
      navTabs[0].click();
      promptInput.focus();
      return;
    }

    saveSettings();

    await chrome.storage.local.set({
      queue: prompts,
      currentIndex: 0,
      status: 'running',
      statusDetail: 'Memulai antrian di Meta.ai...'
    });

    await ensureMetaTabActive();
    notifyActiveTab();
  });

  btnPause.addEventListener('click', async () => {
    await chrome.storage.local.set({
      status: 'paused',
      statusDetail: 'Antrian dijeda oleh pengguna.'
    });
    notifyActiveTab();
  });

  btnStop.addEventListener('click', async () => {
    if (confirm('Hentikan seluruh antrian prompt yang sedang berjalan?')) {
      await chrome.storage.local.set({
        status: 'idle',
        statusDetail: 'Antrian dihentikan oleh pengguna.',
        currentIndex: 0
      });
      notifyActiveTab();
    }
  });

  btnOpenMeta.addEventListener('click', () => openOrFocusMetaTab());
  btnQuickFocus.addEventListener('click', () => openOrFocusMetaTab());

  // ==========================================
  // STORAGE LISTENER & STATUS SYNC
  // ==========================================

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.status && changes.status.newValue === 'completed' && changes.status.oldValue === 'running') {
      playChimeSound();
    }

    chrome.storage.local.get(['queue', 'currentIndex', 'status', 'statusDetail', 'executionHistory'], (res) => {
      applyState(
        res.status || 'idle',
        res.currentIndex || 0,
        res.queue || [],
        res.statusDetail
      );

      if (changes.executionHistory) {
        renderHistory(res.executionHistory || []);
        updateStats(res.executionHistory || []);
      }
    });
  });

  // ==========================================
  // STATE APPLICATION & TAB WATCHER
  // ==========================================

  function parsePrompts(text, useDelimiter) {
    if (!text || !text.trim()) return [];
    if (useDelimiter) {
      return text.split(/---+\n?/).map(p => p.trim()).filter(Boolean);
    } else {
      return text.split('\n').map(p => p.trim()).filter(Boolean);
    }
  }

  function applyState(status, currentIndex, queue, detail) {
    statusBadge.className = `status-badge ${status}`;
    statusBadge.textContent = status.toUpperCase();

    const total = queue.length;
    const current = Math.min(currentIndex + 1, total);

    if (status === 'running') {
      btnStart.disabled = true;
      btnStartText.textContent = 'Berjalan...';
      btnPause.disabled = false;
      btnStop.disabled = false;
      statusSpinner.classList.add('active');

      progressStepText.textContent = `Memproses: ${current} dari ${total} prompt`;
      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      taskQueuePosition.textContent = `${current} / ${total}`;
      currentPromptPreview.textContent = queue[currentIndex] || '(Kosong)';
      statusDetailText.textContent = detail || 'Memproses antrian...';

    } else if (status === 'paused') {
      btnStart.disabled = false;
      btnStartText.textContent = 'Lanjutkan';
      btnPause.disabled = true;
      btnStop.disabled = false;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = `Dijeda: ${current} dari ${total} prompt`;
      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      taskQueuePosition.textContent = `${current} / ${total}`;
      currentPromptPreview.textContent = queue[currentIndex] || '-';
      statusDetailText.textContent = detail || 'Antrian dijeda.';

    } else if (status === 'completed') {
      btnStart.disabled = false;
      btnStartText.textContent = 'Mulai Baru';
      btnPause.disabled = true;
      btnStop.disabled = true;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = `Selesai: ${total} dari ${total} prompt`;
      progressPercent.textContent = `100%`;
      progressBarFill.style.width = `100%`;

      taskQueuePosition.textContent = `${total} / ${total}`;
      currentPromptPreview.textContent = 'Semua prompt dalam antrian selesai dikirim!';
      statusDetailText.textContent = detail || 'Selesai!';

    } else {
      // idle or error
      btnStart.disabled = false;
      btnStartText.textContent = 'Mulai Antrian';
      btnPause.disabled = true;
      btnStop.disabled = true;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = 'Menunggu antrian...';
      progressPercent.textContent = '0%';
      progressBarFill.style.width = '0%';

      taskQueuePosition.textContent = '- / -';
      currentPromptPreview.textContent = '- Belum ada antrian berjalan -';
      statusDetailText.textContent = detail || 'Siap memulai antrian.';
    }
  }

  async function checkMetaTabStatus() {
    try {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = activeTabs[0];

      if (currentTab && currentTab.url && currentTab.url.includes('meta.ai')) {
        // Cek apakah content script benar-benar hidup via HEARTBEAT_PING
        let isAlive = false;
        try {
          const res = await new Promise((resolve) => {
            chrome.tabs.sendMessage(currentTab.id, { action: 'HEARTBEAT_PING' }, (response) => {
              if (chrome.runtime.lastError || !response) {
                resolve(null);
              } else {
                resolve(response);
              }
            });
          });
          if (res && res.status === 'alive') {
            isAlive = true;
          }
        } catch (e) {
          isAlive = false;
        }

        if (isAlive) {
          tabIndicator.className = 'tab-indicator connected';
          tabIndicatorText.textContent = 'Terhubung ke Meta.ai (Tab Aktif)';
          btnQuickFocus.style.display = 'none';
          return;
        } else {
          tabIndicator.className = 'tab-indicator warning';
          tabIndicatorText.textContent = 'Tab Meta.ai perlu dimuat ulang';
          btnQuickFocus.textContent = 'Muat Ulang';
          btnQuickFocus.style.display = 'inline-block';
          btnQuickFocus.onclick = () => chrome.tabs.reload(currentTab.id);
          return;
        }
      }

      const allMetaTabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
      if (allMetaTabs.length > 0) {
        tabIndicator.className = 'tab-indicator connected';
        tabIndicatorText.textContent = `Meta.ai terbuka (${allMetaTabs.length} tab)`;
        btnQuickFocus.textContent = 'Fokus';
        btnQuickFocus.onclick = () => openOrFocusMetaTab();
        btnQuickFocus.style.display = 'inline-block';
      } else {
        tabIndicator.className = 'tab-indicator disconnected';
        tabIndicatorText.textContent = 'Tab Meta.ai belum terbuka';
        btnQuickFocus.textContent = 'Buka';
        btnQuickFocus.onclick = () => openOrFocusMetaTab();
        btnQuickFocus.style.display = 'inline-block';
      }
    } catch (e) {
      // Tab permission query
    }
  }

  async function openOrFocusMetaTab() {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length > 0) {
      const target = tabs.find(t => t.active) || tabs[0];
      await chrome.tabs.update(target.id, { active: true });
      if (target.windowId) {
        await chrome.windows.update(target.windowId, { focused: true });
      }
      return target;
    } else {
      return await chrome.tabs.create({ url: 'https://www.meta.ai/' });
    }
  }

  async function ensureMetaTabActive() {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length === 0) {
      await openOrFocusMetaTab();
      return;
    }
    const currentTab = tabs.find(t => t.active);
    if (!currentTab) {
      await openOrFocusMetaTab();
    }
  }

  async function notifyActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
      if (tabs.length === 0) return false;

      const targetTab = tabs.find(t => t.active) || tabs[0];

      return new Promise((resolve) => {
        chrome.tabs.sendMessage(targetTab.id, { action: 'CHECK_STATE' }, async (response) => {
          if (chrome.runtime.lastError || !response) {
            console.warn('[Meta AutoPrompt SidePanel] Tab tidak merespon, mencoba injeksi otomatis...');
            if (chrome.scripting) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: targetTab.id },
                  files: ['content/content.js']
                });
                await chrome.scripting.insertCSS({
                  target: { tabId: targetTab.id },
                  files: ['content/content.css']
                });
                setTimeout(() => {
                  chrome.tabs.sendMessage(targetTab.id, { action: 'CHECK_STATE' }, (res) => {
                    resolve(!!(res && res.success));
                  });
                }, 600);
                return;
              } catch (injectErr) {
                console.warn('[Meta AutoPrompt SidePanel] Gagal injeksi script:', injectErr);
              }
            }
            // Fallback reload tab jika injeksi gagal
            chrome.tabs.reload(targetTab.id);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    } catch (e) {
      return false;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
