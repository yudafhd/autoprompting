/**
 * Meta.ai AutoPrompt - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const promptInput = document.getElementById('promptInput');
  const promptCountBadge = document.getElementById('promptCountBadge');
  const delimiterToggle = document.getElementById('delimiterToggle');
  const btnLoadSample = document.getElementById('btnLoadSample');
  const btnClearInput = document.getElementById('btnClearInput');

  const statusBadge = document.getElementById('statusBadge');
  const progressStepText = document.getElementById('progressStepText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const currentPromptPreview = document.getElementById('currentPromptPreview');
  const statusDetailText = document.getElementById('statusDetailText');
  const statusSpinner = document.getElementById('statusSpinner');

  const delayAfterResponse = document.getElementById('delayAfterResponse');
  const maxConcurrent = document.getElementById('maxConcurrent');
  const maxTimeout = document.getElementById('maxTimeout');
  const alwaysNewChat = document.getElementById('alwaysNewChat');
  const autoDownloadImages = document.getElementById('autoDownloadImages');

  const btnStart = document.getElementById('btnStart');
  const btnStartText = document.getElementById('btnStartText');
  const btnPause = document.getElementById('btnPause');
  const btnStop = document.getElementById('btnStop');
  const btnOpenMeta = document.getElementById('btnOpenMeta');

  // Load Initial State from chrome.storage.local
  const data = await chrome.storage.local.get([
    'queue',
    'currentIndex',
    'status',
    'statusDetail',
    'settings',
    'draftText'
  ]);

  if (data.draftText !== undefined) {
    promptInput.value = data.draftText;
  }

  if (data.settings) {
    if (data.settings.delayAfterResponse !== undefined) {
      delayAfterResponse.value = data.settings.delayAfterResponse;
    }
    if (data.settings.maxConcurrent !== undefined) {
      maxConcurrent.value = data.settings.maxConcurrent;
    }
    if (data.settings.maxTimeout !== undefined) {
      maxTimeout.value = data.settings.maxTimeout;
    }
    if (data.settings.alwaysNewChat !== undefined) {
      alwaysNewChat.checked = data.settings.alwaysNewChat;
    }
    if (data.settings.autoDownloadImages !== undefined) {
      autoDownloadImages.checked = data.settings.autoDownloadImages;
    }
    if (data.settings.useDelimiter !== undefined) {
      delimiterToggle.checked = data.settings.useDelimiter;
    }
  }

  updatePromptCount();
  applyState(data.status || 'idle', data.currentIndex || 0, data.queue || [], data.statusDetail);

  // Auto-save draft and settings
  promptInput.addEventListener('input', () => {
    updatePromptCount();
    chrome.storage.local.set({ draftText: promptInput.value });
  });

  delimiterToggle.addEventListener('change', () => {
    updatePromptCount();
    saveSettings();
  });

  delayAfterResponse.addEventListener('change', saveSettings);
  maxConcurrent.addEventListener('change', saveSettings);
  maxTimeout.addEventListener('change', saveSettings);
  alwaysNewChat.addEventListener('change', saveSettings);
  autoDownloadImages.addEventListener('change', saveSettings);

  // Sample Prompts
  btnLoadSample.addEventListener('click', () => {
    const samples = [
      "Jelaskan konsep dasar Quantum Computing dalam 3 poin sederhana.",
      "Tuliskan 5 ide bisnis kreatif dengan modal di bawah 5 juta rupiah.",
      "Buat analogi mudah dipahami tentang cara kerja kecerdasan buatan (AI)."
    ];
    promptInput.value = samples.join('\n');
    updatePromptCount();
    chrome.storage.local.set({ draftText: promptInput.value });
  });

  // Clear Input
  btnClearInput.addEventListener('click', () => {
    if (confirm('Bersihkan semua teks prompt?')) {
      promptInput.value = '';
      updatePromptCount();
      chrome.storage.local.set({ draftText: '' });
    }
  });

  // Start / Resume Button
  btnStart.addEventListener('click', async () => {
    const currentStatus = (await chrome.storage.local.get('status')).status || 'idle';

    if (currentStatus === 'paused') {
      // Resume
      await chrome.storage.local.set({
        status: 'running',
        statusDetail: 'Melanjutkan antrian...'
      });
      notifyActiveTab();
      return;
    }

    // New Start
    const queue = parsePrompts(promptInput.value, delimiterToggle.checked);
    if (queue.length === 0) {
      alert('Silakan masukkan minimal 1 prompt ke dalam kotak antrian!');
      promptInput.focus();
      return;
    }

    saveSettings();

    await chrome.storage.local.set({
      queue: queue,
      currentIndex: 0,
      status: 'running',
      statusDetail: 'Mempersiapkan pengiriman...',
      lastUpdated: Date.now()
    });

    // Ensure Meta.ai tab is open / active
    await ensureMetaTabActive();
    notifyActiveTab();
  });

  // Pause Button
  btnPause.addEventListener('click', async () => {
    await chrome.storage.local.set({
      status: 'paused',
      statusDetail: 'Antrian dijeda oleh pengguna.'
    });
    notifyActiveTab();
  });

  // Stop Button
  btnStop.addEventListener('click', async () => {
    await chrome.storage.local.set({
      status: 'idle',
      currentIndex: 0,
      statusDetail: 'Antrian dihentikan.'
    });
    notifyActiveTab();
  });

  // Open Meta.ai tab
  btnOpenMeta.addEventListener('click', async () => {
    await openOrFocusMetaTab();
  });

  // Real-time Storage Observer (syncs UI if content script updates progress)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    chrome.storage.local.get(['status', 'currentIndex', 'queue', 'statusDetail'], (res) => {
      applyState(res.status || 'idle', res.currentIndex || 0, res.queue || [], res.statusDetail);
    });
  });

  // Helpers
  function parsePrompts(text, useDelimiter) {
    if (!text || !text.trim()) return [];

    if (useDelimiter) {
      return text
        .split(/---+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    } else {
      return text
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
    }
  }

  function updatePromptCount() {
    const prompts = parsePrompts(promptInput.value, delimiterToggle.checked);
    promptCountBadge.textContent = `${prompts.length} prompt`;
  }

  function saveSettings() {
    const settings = {
      delayAfterResponse: Math.max(1, parseInt(delayAfterResponse.value, 10) || 5),
      maxConcurrent: Math.max(1, parseInt(maxConcurrent.value, 10) || 5),
      maxTimeout: Math.max(10, parseInt(maxTimeout.value, 10) || 90),
      alwaysNewChat: alwaysNewChat.checked,
      autoDownloadImages: autoDownloadImages.checked,
      useDelimiter: delimiterToggle.checked
    };
    chrome.storage.local.set({ settings });
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

      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressStepText.textContent = `Memproses: Prompt ${current} dari ${total}`;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

      const promptText = queue[currentIndex] || '-';
      currentPromptPreview.textContent = promptText;
      statusDetailText.textContent = detail || 'Sedang memproses...';

    } else if (status === 'paused') {
      btnStart.disabled = false;
      btnStartText.textContent = 'Lanjutkan';
      btnPause.disabled = true;
      btnStop.disabled = false;
      statusSpinner.classList.remove('active');

      const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
      progressStepText.textContent = `Dijeda: Prompt ${current} dari ${total}`;
      progressPercent.textContent = `${percent}%`;
      progressBarFill.style.width = `${percent}%`;

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

      currentPromptPreview.textContent = 'Semua prompt dalam antrian selesai dikirim!';
      statusDetailText.textContent = detail || 'Selesai!';

    } else {
      // idle or error
      btnStart.disabled = false;
      btnStartText.textContent = 'Mulai Antrian';
      btnPause.disabled = true;
      btnStop.disabled = true;
      statusSpinner.classList.remove('active');

      progressStepText.textContent = 'Menunggu instruksi...';
      progressPercent.textContent = '0%';
      progressBarFill.style.width = '0%';

      currentPromptPreview.textContent = '- Tidak ada prompt berjalan -';
      statusDetailText.textContent = detail || 'Siap memulai antrian.';
    }
  }

  async function openOrFocusMetaTab() {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) {
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return tabs[0];
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
            console.warn('[Meta AutoPrompt Popup] Tab tidak merespon, mencoba injeksi otomatis...');
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
                console.warn('[Meta AutoPrompt Popup] Gagal injeksi script:', injectErr);
              }
            }
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
});
