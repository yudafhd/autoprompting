/**
 * Meta.ai AutoPrompt - Dashboard Controller
 * Singleton Tab Controller with Real-Time Dual Sync to Floating HUD.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // ==========================================
  // 0. SINGLETON TAB ENFORCEMENT
  // ==========================================
  if (chrome.tabs && chrome.tabs.getCurrent) {
    chrome.tabs.getCurrent((currentTab) => {
      if (currentTab) {
        const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
        const sidepanelUrl = chrome.runtime.getURL('sidepanel/sidepanel.html');

        chrome.tabs.query({}, (tabs) => {
          const existing = tabs.find(t => 
            t.id !== currentTab.id && 
            t.url && 
            (t.url.startsWith(dashboardUrl) || t.url.startsWith(sidepanelUrl))
          );
          if (existing) {
            console.log('[Meta AutoPrompt Dashboard] Tab lain sudah terbuka. Memfokuskan tab yang sudah ada...');
            chrome.tabs.update(existing.id, { active: true });
            if (existing.windowId) chrome.windows.update(existing.windowId, { focused: true });
            window.close();
          } else {
            chrome.storage.local.set({ dashboardTabId: currentTab.id });
          }
        });
      }
    });
  }

  // ==========================================
  // 1. DOM ELEMENT REFERENCES
  // ==========================================

  // Navigation Tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = {
    queue: document.getElementById('tabContentQueue'),
    matrix: document.getElementById('tabContentMatrix'),
    history: document.getElementById('tabContentHistory'),
    settings: document.getElementById('tabContentSettings')
  };
  const tabCountBadge = document.getElementById('tabCountBadge');
  const historyCountBadge = document.getElementById('historyCountBadge');

  // Header & Indicators
  const statusBadge = document.getElementById('statusBadge');
  const tabIndicator = document.getElementById('tabIndicator');
  const tabIndicatorText = document.getElementById('tabIndicatorText');
  const btnQuickFocus = document.getElementById('btnQuickFocus');

  // Live Console Elements (Unified with Floating HUD)
  const progressStepText = document.getElementById('progressStepText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const taskQueuePosition = document.getElementById('taskQueuePosition');
  const currentPromptPreview = document.getElementById('currentPromptPreview');
  const statusSpinner = document.getElementById('statusSpinner');
  const statusDetailText = document.getElementById('statusDetailText');

  // Action Buttons
  const btnStart = document.getElementById('btnStart');
  const btnStartText = document.getElementById('btnStartText');
  const btnStartIcon = document.getElementById('btnStartIcon');
  const btnStop = document.getElementById('btnStop');
  const btnOpenMeta = document.getElementById('btnOpenMeta');

  // Tab 1: Queue Manager
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

  // Tab 2: Matrix Generator
  const matrixTemplateInput = document.getElementById('matrixTemplateInput');
  const btnGenerateMatrix = document.getElementById('btnGenerateMatrix');
  const btnMatrixSample = document.getElementById('btnMatrixSample');
  const matrixPreviewSection = document.getElementById('matrixPreviewSection');
  const matrixPreviewCount = document.getElementById('matrixPreviewCount');
  const matrixResultList = document.getElementById('matrixResultList');
  const btnApplyMatrixToQueue = document.getElementById('btnApplyMatrixToQueue');
  let currentGeneratedMatrixPrompts = [];

  // Tab 3: History & Gallery
  const historyTotalBadge = document.getElementById('historyTotalBadge');
  const historyListContainer = document.getElementById('historyListContainer');
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const historyFilterPills = document.querySelectorAll('.history-filter-pills .pill-btn');
  let activeHistoryFilter = 'all';

  // Tab 4: Settings & Analytics
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

  // ==========================================
  // 2. INITIAL DATA LOAD & RESTORE
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

  if (store.draftText && promptInput) {
    promptInput.value = store.draftText;
  } else if (store.queue && store.queue.length > 0 && promptInput) {
    promptInput.value = store.queue.join('\n');
  }

  if (store.settings) {
    const s = store.settings;
    if (autoDownloadImages) autoDownloadImages.checked = s.autoDownloadImages !== false;
    if (alwaysNewChat) alwaysNewChat.checked = s.alwaysNewChat !== false;
    if (maxConcurrent) maxConcurrent.value = s.maxConcurrent || 5;
    if (maxRetries) maxRetries.value = s.maxRetries !== undefined ? s.maxRetries : 2;
    if (delayAfterResponse) delayAfterResponse.value = s.delayAfterResponse || 5;
    if (maxTimeout) maxTimeout.value = s.maxTimeout || 90;
    if (audioChimeToggle) audioChimeToggle.checked = s.audioChime !== false;
    if (systemNotificationsToggle) systemNotificationsToggle.checked = s.systemNotifications !== false;
    if (delimiterToggle) delimiterToggle.checked = s.useDelimiter === true;
  }

  // Render initial views
  applyState(store);
  renderVisualQueue(store.queue || parsePrompts(promptInput.value, delimiterToggle.checked), store.currentIndex || 0);
  renderHistory(store.executionHistory || []);
  renderStats(store.stats || {});
  checkMetaTabLiveness();

  // ==========================================
  // 3. TAB NAVIGATION (Antrian, Matrix, Riwayat, Pengaturan)
  // ==========================================

  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      Object.values(tabPanes).forEach(p => p?.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (tabPanes[target]) {
        tabPanes[target].classList.add('active');
      }
    });
  });

  // View switch in Tab 1 (Teks vs Visual)
  btnViewText?.addEventListener('click', () => {
    btnViewText.classList.add('active');
    btnViewVisual.classList.remove('active');
    viewModeText.classList.add('active');
    viewModeVisual.classList.remove('active');
  });

  btnViewVisual?.addEventListener('click', () => {
    btnViewVisual.classList.add('active');
    btnViewText.classList.remove('active');
    viewModeVisual.classList.add('active');
    viewModeText.classList.remove('active');
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    chrome.storage.local.get(['currentIndex'], (res) => {
      renderVisualQueue(prompts, res.currentIndex || 0);
    });
  });

  // Auto-save draft input on change
  promptInput?.addEventListener('input', () => {
    const text = promptInput.value;
    chrome.storage.local.set({ draftText: text });
    const prompts = parsePrompts(text, delimiterToggle.checked);
    tabCountBadge.textContent = prompts.length;

    // Update start button state if idle
    chrome.storage.local.get(['status', 'queue'], (res) => {
      if ((res.status || 'idle') === 'idle') {
        const total = (res.queue && res.queue.length > 0) ? res.queue.length : prompts.length;
        btnStart.disabled = total === 0;
      }
    });
  });

  delimiterToggle?.addEventListener('change', () => {
    saveSettings();
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    tabCountBadge.textContent = prompts.length;
    chrome.storage.local.get(['currentIndex'], (res) => {
      renderVisualQueue(prompts, res.currentIndex || 0);
    });
  });

  // Sample prompt loader
  btnLoadSample?.addEventListener('click', () => {
    const samples = [
      "buatkan gambar kucing 3d oren gemoy dengan syal hijau",
      "buatkan gambar pemandangan kafe estetik bernuansa senja di Kyoto",
      "buatkan gambar robot astronot masa depan sedang melukis bintang di luar angkasa",
      "jelaskan secara ringkas 3 tips prompting AI gambar terbaik untuk pemula"
    ];
    promptInput.value = samples.join('\n');
    promptInput.dispatchEvent(new Event('input'));
  });

  // Clear text
  btnClearInput?.addEventListener('click', () => {
    if (confirm('Bersihkan seluruh teks prompt antrian?')) {
      promptInput.value = '';
      promptInput.dispatchEvent(new Event('input'));
    }
  });

  // Import / Export
  btnExportQueue?.addEventListener('click', () => {
    const text = promptInput.value.trim();
    if (!text) return alert('Tidak ada prompt untuk diekspor.');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MetaAutoPrompt_Queue_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnImportQueue?.addEventListener('click', () => fileImporter?.click());
  fileImporter?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            promptInput.value = parsed.join('\n');
          } else {
            promptInput.value = content;
          }
        } catch {
          promptInput.value = content;
        }
        promptInput.dispatchEvent(new Event('input'));
      }
    };
    reader.readAsText(file);
    fileImporter.value = '';
  });

  // ==========================================
  // 4. TAB 2: MATRIX GENERATOR LOGIC
  // ==========================================

  btnMatrixSample?.addEventListener('click', () => {
    matrixTemplateInput.value = "buatkan gambar [kucing, kelinci, panda] gaya [3D render, cat air] sedang [minum kopi, membaca buku] di [kafe senja, perpustakaan tua]";
  });

  btnGenerateMatrix?.addEventListener('click', () => {
    const template = matrixTemplateInput.value.trim();
    if (!template) return alert('Masukkan template dengan format [opsi 1, opsi 2] terlebih dahulu.');

    const combinations = expandMatrixTemplate(template);
    if (combinations.length === 0) return alert('Tidak ada token kurung siku [] yang ditemukan.');

    currentGeneratedMatrixPrompts = combinations;
    matrixPreviewSection.style.display = 'block';
    matrixPreviewCount.textContent = `${combinations.length} variasi dihasilkan`;

    matrixResultList.innerHTML = combinations.map((p, i) => `
      <div class="matrix-result-item">${i + 1}. ${escapeHtml(p)}</div>
    `).join('');
  });

  btnApplyMatrixToQueue?.addEventListener('click', () => {
    if (currentGeneratedMatrixPrompts.length === 0) return;
    const existing = promptInput.value.trim();
    const joined = currentGeneratedMatrixPrompts.join('\n');
    promptInput.value = existing ? `${existing}\n${joined}` : joined;
    promptInput.dispatchEvent(new Event('input'));
    alert(`Berhasil menambahkan ${currentGeneratedMatrixPrompts.length} prompt ke antrian!`);
    navTabs[0].click();
  });

  function expandMatrixTemplate(template) {
    const regex = /\[(.*?)\]/g;
    const matches = [...template.matchAll(regex)];
    if (matches.length === 0) return [];

    let optionsArray = matches.map(m => m[1].split(',').map(s => s.trim()).filter(Boolean));

    function cartesian(arrays) {
      return arrays.reduce((acc, curr) => acc.flatMap(c => curr.map(n => [...c, n])), [[]]);
    }

    const combos = cartesian(optionsArray);
    return combos.map(combo => {
      let result = template;
      combo.forEach(val => {
        result = result.replace(/\[(.*?)\]/, val);
      });
      return result;
    });
  }

  // ==========================================
  // 5. TAB 3: RIWAYAT & GALERI
  // ==========================================

  function renderHistory(list) {
    historyTotalBadge.textContent = `${list.length} item`;
    historyCountBadge.textContent = list.length;

    let filtered = list;
    if (activeHistoryFilter === 'images') {
      filtered = list.filter(item => item.imageUrl);
    } else if (activeHistoryFilter === 'success') {
      filtered = list.filter(item => item.status === 'success');
    } else if (activeHistoryFilter === 'failed') {
      filtered = list.filter(item => item.status === 'failed');
    }

    if (filtered.length === 0) {
      historyListContainer.innerHTML = '<div class="empty-state">Tidak ada riwayat untuk filter ini.</div>';
      return;
    }

    historyListContainer.innerHTML = filtered.slice().reverse().map(item => {
      const isSuccess = item.status === 'success';
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '-';
      const imgHtml = item.imageUrl 
        ? `<img class="history-thumb" src="${escapeHtml(item.imageUrl)}" alt="Preview" title="Klik untuk unduh ulang" data-download-url="${escapeHtml(item.imageUrl)}">`
        : `<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:10px;">Teks</div>`;

      return `
        <div class="history-card-item">
          ${imgHtml}
          <div class="history-info-wrap">
            <div class="history-prompt-text">${escapeHtml(item.prompt || '-')}</div>
            <div class="history-meta-row">
              <span class="history-status-tag ${isSuccess ? 'success' : 'failed'}">${isSuccess ? 'BERHASIL' : 'GAGAL'}</span>
              <span>🕒 ${timeStr}</span>
              ${item.duration ? `<span>⏱ ${item.duration}s</span>` : ''}
              ${item.imageUrl ? '<span style="color:#60a5fa;">🖼 Gambar Tersimpan</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Click on thumbnail to redownload
    historyListContainer.querySelectorAll('.history-thumb[data-download-url]').forEach(el => {
      el.addEventListener('click', () => {
        const url = el.getAttribute('data-download-url');
        if (url) {
          chrome.runtime.sendMessage({ action: 'DOWNLOAD_IMAGE', url });
        }
      });
    });
  }

  historyFilterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      historyFilterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeHistoryFilter = pill.dataset.filter || 'all';
      chrome.storage.local.get(['executionHistory'], (res) => {
        renderHistory(res.executionHistory || []);
      });
    });
  });

  btnClearHistory?.addEventListener('click', async () => {
    if (confirm('Hapus seluruh riwayat eksekusi prompt?')) {
      await chrome.storage.local.set({ executionHistory: [] });
      renderHistory([]);
    }
  });

  btnExportJSON?.addEventListener('click', async () => {
    const { executionHistory } = await chrome.storage.local.get('executionHistory');
    if (!executionHistory || executionHistory.length === 0) return alert('Riwayat kosong.');
    const blob = new Blob([JSON.stringify(executionHistory, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MetaAutoPrompt_History_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnExportCSV?.addEventListener('click', async () => {
    const { executionHistory } = await chrome.storage.local.get('executionHistory');
    if (!executionHistory || executionHistory.length === 0) return alert('Riwayat kosong.');
    const header = ['Prompt', 'Status', 'Timestamp', 'DurationSeconds', 'ImageUrl'];
    const rows = executionHistory.map(item => [
      `"${(item.prompt || '').replace(/"/g, '""')}"`,
      item.status || '',
      item.timestamp || '',
      item.duration || '',
      `"${(item.imageUrl || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MetaAutoPrompt_History_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ==========================================
  // 6. TAB 4: STATS & SETTINGS LOGIC
  // ==========================================

  function renderStats(st) {
    if (statTotalProcessed) statTotalProcessed.textContent = st.totalProcessed || 0;
    if (statTotalImages) statTotalImages.textContent = st.totalImages || 0;
    if (statSuccessRate) statSuccessRate.textContent = `${st.successRate || 100}%`;
    if (statAvgDuration) statAvgDuration.textContent = `${st.avgDuration || 0} dtk`;
  }

  function saveSettings() {
    const settings = {
      autoDownloadImages: autoDownloadImages?.checked !== false,
      alwaysNewChat: alwaysNewChat?.checked !== false,
      delayAfterResponse: parseInt(delayAfterResponse?.value, 10) || 5,
      maxConcurrent: parseInt(maxConcurrent?.value, 10) || 5,
      maxRetries: parseInt(maxRetries?.value, 10) || 2,
      maxTimeout: parseInt(maxTimeout?.value, 10) || 90,
      audioChime: audioChimeToggle?.checked !== false,
      systemNotifications: systemNotificationsToggle?.checked !== false,
      useDelimiter: delimiterToggle?.checked === true
    };
    chrome.storage.local.set({ settings });
  }

  [autoDownloadImages, alwaysNewChat, delayAfterResponse, maxConcurrent, maxRetries, maxTimeout, audioChimeToggle, systemNotificationsToggle]
    .forEach(el => el?.addEventListener('change', saveSettings));

  // ==========================================
  // 7. QUEUE CONTROL BUTTONS (100% Matching Floating HUD)
  // ==========================================

  btnStart.addEventListener('click', async () => {
    const storeData = await chrome.storage.local.get(['status', 'queue', 'currentIndex']);
    const curStatus = storeData.status || 'idle';

    if (curStatus === 'running') {
      // Jeda aksi jika sedang berjalan (Identik dengan tombol Jeda Floating HUD)
      await chrome.storage.local.set({
        status: 'paused',
        statusDetail: 'Antrian dijeda dari Dashboard Tab.'
      });
      notifyActiveTab();
      return;
    }

    if (curStatus === 'paused') {
      // Lanjutkan jika sedang dijeda (Identik dengan Lanjutkan Floating HUD)
      await chrome.storage.local.set({
        status: 'running',
        statusDetail: 'Melanjutkan antrian dari Dashboard Tab...'
      });
      await ensureMetaTabActive();
      notifyActiveTab();
      return;
    }

    // Status is 'idle' or 'completed' -> Mulai antrian
    let prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    if (prompts.length === 0 && storeData.queue && storeData.queue.length > 0) {
      prompts = storeData.queue;
    }

    if (prompts.length === 0) {
      alert('Silakan masukkan minimal 1 prompt sebelum memulai antrian.');
      navTabs[0].click();
      promptInput?.focus();
      return;
    }

    saveSettings();

    await chrome.storage.local.set({
      queue: prompts,
      currentIndex: 0,
      status: 'running',
      statusDetail: 'Memulai antrian dari Dashboard Tab...'
    });

    await ensureMetaTabActive();
    notifyActiveTab();
  });

  btnStop.addEventListener('click', async () => {
    if (confirm('Hentikan seluruh antrian prompt yang sedang berjalan?')) {
      await chrome.storage.local.set({
        status: 'idle',
        statusDetail: 'Antrian dihentikan oleh pengguna dari Dashboard Tab.',
        currentIndex: 0
      });
      notifyActiveTab();
    }
  });

  btnOpenMeta.addEventListener('click', () => openOrFocusMetaTab());
  btnQuickFocus.addEventListener('click', () => openOrFocusMetaTab());

  // ==========================================
  // 8. STORAGE REAL-TIME LISTENER & SYNCHRONIZATION
  // ==========================================

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    chrome.storage.local.get([
      'queue',
      'currentIndex',
      'status',
      'statusDetail',
      'executionHistory',
      'stats'
    ], (data) => {
      applyState(data);
      if (changes.executionHistory) {
        renderHistory(data.executionHistory || []);
      }
      if (changes.stats) {
        renderStats(data.stats || {});
      }
      if (changes.queue || changes.currentIndex) {
        renderVisualQueue(data.queue || [], data.currentIndex || 0);
      }
    });
  });

  // ==========================================
  // 9. STATE RENDERER (100% Sync with Floating HUD)
  // ==========================================

  function applyState(state) {
    const status = state.status || 'idle';
    const queue = state.queue || [];
    const currentIndex = state.currentIndex || 0;
    const detail = state.statusDetail || '';

    // Status Badge & Classes (Matching Floating HUD)
    statusBadge.className = `status-badge ${status}`;
    statusBadge.textContent = status.toUpperCase();

    const total = queue.length;
    const current = Math.min(currentIndex + 1, total);

    // Synchronize Counter Badges
    tabCountBadge.textContent = total;

    if (status === 'running') {
      // Action Button -> Jeda
      btnStart.disabled = false;
      btnStart.className = 'btn btn-warning btn-action-main';
      btnStartText.textContent = 'Jeda';
      btnStartIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

      btnStop.disabled = false;
      statusSpinner.classList.add('active');

      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressStepText.textContent = `Prompt ${current} dari ${total}`;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      taskQueuePosition.textContent = `${current} / ${total}`;
      currentPromptPreview.textContent = queue[currentIndex] || '-';
      statusDetailText.textContent = detail || 'Memproses antrian...';

    } else if (status === 'paused') {
      // Action Button -> Lanjutkan
      btnStart.disabled = false;
      btnStart.className = 'btn btn-primary btn-action-main';
      btnStartText.textContent = 'Lanjutkan';
      btnStartIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';

      btnStop.disabled = false;
      statusSpinner.classList.remove('active');

      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressStepText.textContent = `Dijeda: ${current} dari ${total}`;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      taskQueuePosition.textContent = `${current} / ${total}`;
      currentPromptPreview.textContent = queue[currentIndex] || '-';
      statusDetailText.textContent = detail || 'Antrian dijeda.';

    } else if (status === 'completed') {
      // Action Button -> Mulai Baru
      btnStart.disabled = total === 0 && parsePrompts(promptInput.value, delimiterToggle.checked).length === 0;
      btnStart.className = 'btn btn-primary btn-action-main';
      btnStartText.textContent = 'Mulai Baru';
      btnStartIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';

      btnStop.disabled = true;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = `Selesai (${total} prompt)`;
      progressPercent.textContent = `100%`;
      progressBarFill.style.width = `100%`;

      taskQueuePosition.textContent = `${total} / ${total}`;
      currentPromptPreview.textContent = 'Semua antrian tuntas!';
      statusDetailText.textContent = detail || 'Selesai!';

    } else {
      // Idle
      const promptsInBox = parsePrompts(promptInput.value, delimiterToggle.checked).length;
      btnStart.disabled = total === 0 && promptsInBox === 0;
      btnStart.className = 'btn btn-primary btn-action-main';
      btnStartText.textContent = 'Mulai Antrian';
      btnStartIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';

      btnStop.disabled = true;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = 'Menunggu antrian...';
      progressPercent.textContent = '0%';
      progressBarFill.style.width = '0%';

      taskQueuePosition.textContent = '- / -';
      currentPromptPreview.textContent = total > 0 ? `${total} prompt siap dijalankan` : '- Tidak ada antrian -';
      statusDetailText.textContent = detail || 'Siap memulai antrian.';
    }
  }

  // ==========================================
  // 10. VISUAL QUEUE CARD RENDERER
  // ==========================================

  function renderVisualQueue(prompts, currentIndex) {
    if (!visualQueueList) return;
    if (!prompts || prompts.length === 0) {
      visualQueueList.innerHTML = '<div class="empty-state">Belum ada prompt dalam antrian.</div>';
      return;
    }

    visualQueueList.innerHTML = prompts.map((p, idx) => {
      const isCurrent = idx === currentIndex;
      const isDone = idx < currentIndex;
      const statusIcon = isDone ? '✓' : (isCurrent ? '▶' : `${idx + 1}`);

      return `
        <div class="visual-queue-item ${isCurrent ? 'current' : ''}">
          <span class="visual-item-num">${statusIcon}</span>
          <span class="visual-item-text" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
          <div class="visual-item-actions">
            <button class="text-btn text-danger btn-del-item" data-index="${idx}" title="Hapus prompt ini">×</button>
          </div>
        </div>
      `;
    }).join('');

    visualQueueList.querySelectorAll('.btn-del-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        let list = parsePrompts(promptInput.value, delimiterToggle.checked);
        list.splice(idx, 1);
        promptInput.value = list.join(delimiterToggle.checked ? '\n---\n' : '\n');
        promptInput.dispatchEvent(new Event('input'));
        const curIdx = (await chrome.storage.local.get('currentIndex')).currentIndex || 0;
        renderVisualQueue(list, curIdx);
      });
    });
  }

  // ==========================================
  // 11. TAB CONNECTION & WATCHDOG
  // ==========================================

  async function checkMetaTabLiveness() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
      if (tabs.length === 0) {
        tabIndicator.className = 'tab-indicator disconnected';
        tabIndicatorText.textContent = 'Tab Meta.ai belum terbuka';
        btnQuickFocus.textContent = 'Buka Meta.ai';
        return;
      }

      const activeTab = tabs.find(t => t.active) || tabs[0];
      chrome.tabs.sendMessage(activeTab.id, { action: 'HEARTBEAT_PING' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          tabIndicator.className = 'tab-indicator connected';
          tabIndicatorText.textContent = 'Meta.ai Terbuka (Standby)';
          btnQuickFocus.textContent = 'Fokus';
        } else {
          tabIndicator.className = 'tab-indicator connected';
          tabIndicatorText.textContent = 'Meta.ai Terhubung (Aktif)';
          btnQuickFocus.textContent = 'Fokus';
        }
      });
    } catch {
      tabIndicator.className = 'tab-indicator disconnected';
      tabIndicatorText.textContent = 'Tab Meta.ai belum terbuka';
    }
  }

  // Liveness interval check
  setInterval(checkMetaTabLiveness, 5000);

  async function openOrFocusMetaTab() {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length > 0) {
      const target = tabs.find(t => t.active) || tabs[0];
      chrome.tabs.update(target.id, { active: true });
      if (target.windowId) chrome.windows.update(target.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: 'https://www.meta.ai/' });
    }
  }

  async function ensureMetaTabActive() {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length > 0) {
      const target = tabs.find(t => t.active) || tabs[0];
      chrome.tabs.update(target.id, { active: true });
      if (target.windowId) chrome.windows.update(target.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: 'https://www.meta.ai/' });
    }
  }

  async function notifyActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
      if (tabs.length === 0) return;
      const target = tabs.find(t => t.active) || tabs[0];
      chrome.tabs.sendMessage(target.id, { action: 'CHECK_STATE' }).catch(() => {});
    } catch {}
  }

  // ==========================================
  // 12. UTILITY HELPERS
  // ==========================================

  function parsePrompts(rawText, useDelimiter) {
    if (!rawText) return [];
    if (useDelimiter) {
      return rawText
        .split(/(?:^|\n)---(?:\n|$)/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    } else {
      return rawText
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }
});
