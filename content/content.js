/**
 * Meta.ai AutoPrompt - Content Script
 * Otomasi pengiriman prompt, menunggu respons, new chat, dan perulangan antrian.
 */

(() => {
  // Bersihkan controller lama jika ada sebelum membuat instance baru
  if (window.__META_AUTOPROMPT_CONTROLLER__) {
    try {
      window.__META_AUTOPROMPT_CONTROLLER__.destroy();
    } catch (e) {}
  }

  console.log('[Meta AutoPrompt] Content script aktif di:', window.location.href);

  let isDestroyed = false;
  let isLoopActive = false;
  let isMinimized = false;
  let activeObserver = null;
  let initTimeoutId = null;

  function destroy() {
    isDestroyed = true;
    isLoopActive = false;
    if (activeObserver) {
      try { activeObserver.disconnect(); } catch (e) {}
      activeObserver = null;
    }
    if (initTimeoutId) {
      clearTimeout(initTimeoutId);
      initTimeoutId = null;
    }
    const oldHud = document.getElementById('map-floating-hud');
    if (oldHud) oldHud.remove();
  }

  window.__META_AUTOPROMPT_CONTROLLER__ = { destroy };

  // ==========================================
  // EXTENSION CONTEXT & SAFE STORAGE HELPERS
  // ==========================================

  function isContextValid() {
    if (isDestroyed) return false;
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function handleContextInvalidated() {
    if (isDestroyed) return;
    console.warn('[Meta AutoPrompt] Extension context invalidated. Menghentikan script & HUD.');
    isDestroyed = true;
    isLoopActive = false;
    if (activeObserver) {
      try { activeObserver.disconnect(); } catch (e) {}
      activeObserver = null;
    }

    // Update Floating HUD agar user tahu ekstensi telah di-reload
    const badge = document.getElementById('mapHudBadge');
    if (badge) {
      badge.className = 'map-hud-badge map-badge-disconnected';
      badge.textContent = 'DISCONNECTED';
    }
    const detail = document.getElementById('mapHudDetail');
    if (detail) {
      detail.innerHTML = 'Ekstensi di-reload. Silakan muat ulang tab untuk menyambung.';
    }
    const spinner = document.getElementById('mapHudSpinner');
    if (spinner) spinner.style.display = 'none';
    const actions = document.getElementById('mapHudActions');
    if (actions) {
      actions.innerHTML = '<button id="mapBtnReloadPage" class="map-btn map-btn-primary" style="background:#3b82f6;width:100%;color:#fff;padding:6px;border-radius:6px;border:none;cursor:pointer;font-weight:600;">Muat Ulang Halaman</button>';
      const btn = document.getElementById('mapBtnReloadPage');
      if (btn) btn.onclick = () => window.location.reload();
    }
  }

  async function safeStorageGet(keys) {
    if (!isContextValid()) {
      handleContextInvalidated();
      return null;
    }
    try {
      return await chrome.storage.local.get(keys);
    } catch (e) {
      handleContextInvalidated();
      return null;
    }
  }

  async function safeStorageSet(items) {
    if (!isContextValid()) {
      handleContextInvalidated();
      return false;
    }
    try {
      await chrome.storage.local.set(items);
      return true;
    } catch (e) {
      handleContextInvalidated();
      return false;
    }
  }

  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      handleContextInvalidated();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return;
        if (callback) callback(response);
      });
    } catch (e) {
      handleContextInvalidated();
    }
  }

  // Inisialisasi Floating HUD & State Watcher
  initFloatingHUD();
  listenStateChanges();

  // Periksa apakah ada antrian yang harus dilanjutkan saat halaman dibuka/reload
  initTimeoutId = setTimeout(checkAndExecuteState, 1500);

  // ==========================================
  // STATE MACHINE & CONTROLLER
  // ==========================================

  async function checkAndExecuteState() {
    if (!isContextValid()) return;
    const data = await safeStorageGet(['queue', 'currentIndex', 'status', 'settings']);
    if (!data) return;
    updateHUD(data);

    if (data.status === 'running' && !isLoopActive) {
      runQueueLoop();
    }
  }

  function listenStateChanges() {
    if (!isContextValid()) return;

    // Dengarkan perubahan pada chrome.storage.local
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isContextValid()) return;
        if (area !== 'local') return;

        safeStorageGet(['queue', 'currentIndex', 'status', 'statusDetail', 'settings']).then((data) => {
          if (!data || !isContextValid()) return;
          updateHUD(data);

          if (changes.status) {
            const newStatus = changes.status.newValue;
            if (newStatus === 'running' && !isLoopActive) {
              runQueueLoop();
            } else if (newStatus !== 'running') {
              isLoopActive = false;
            }
          }
        }).catch(() => {});
      });
    } catch (e) {
      handleContextInvalidated();
    }

    // Dengarkan pesan langsung dari popup, sidepanel, atau background
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!isContextValid()) return false;
        if (request.action === 'CHECK_STATE') {
          checkAndExecuteState();
          sendResponse({ success: true });
          return true;
        }
        if (request.action === 'HEARTBEAT_PING') {
          sendResponse({ status: 'alive', isLoopActive, timestamp: Date.now() });
          return true;
        }
      });
    } catch (e) {
      handleContextInvalidated();
    }
  }

  async function updateStatus(status, detail, extra = {}) {
    if (!isContextValid()) return;
    const updates = { statusDetail: detail, ...extra };
    if (status) updates.status = status;
    await safeStorageSet(updates);
    const data = await safeStorageGet(['queue', 'currentIndex', 'status', 'statusDetail', 'settings']);
    if (data) updateHUD(data);
  }

  async function shouldContinue() {
    if (!isContextValid()) return false;
    const data = await safeStorageGet(['status']);
    if (!data) return false;
    return data.status === 'running';
  }

  // ==========================================
  // CORE AUTOMATION LOOP
  // ==========================================

  async function runQueueLoop() {
    if (isLoopActive || !isContextValid()) return;
    isLoopActive = true;

    try {
      while (isContextValid()) {
        const state = await safeStorageGet(['queue', 'currentIndex', 'status', 'settings']);
        if (!state || state.status !== 'running') {
          console.log('[Meta AutoPrompt] Loop berhenti: status bukan running');
          break;
        }

        const queue = state.queue || [];
        const index = state.currentIndex || 0;
        const settings = state.settings || {
          delayAfterResponse: 5,
          maxTimeout: 90,
          alwaysNewChat: true
        };

        // Cek apakah antrian sudah selesai
        if (index >= queue.length) {
          await updateStatus('completed', 'Semua prompt dalam antrian selesai diproses!');
          console.log('[Meta AutoPrompt] Antrian selesai!');
          break;
        }

        const currentPrompt = queue[index];
        console.log(`[Meta AutoPrompt] Memulai Prompt [${index + 1}/${queue.length}]:`, currentPrompt);

        // 0. Cek batas proses concurrent yang sedang berjalan di Meta.ai (default: 5)
        const maxConcurrent = settings.maxConcurrent !== undefined ? settings.maxConcurrent : 5;
        let activeLoaders = getActiveLoadingProcessesCount();

        if (activeLoaders >= maxConcurrent) {
          console.log(`[Meta AutoPrompt] ${activeLoaders} proses sedang berjalan (batas: ${maxConcurrent}). Menunggu hingga slot tersedia...`);

          while (activeLoaders >= maxConcurrent) {
            if (!await shouldContinue()) break;
            await updateStatus(
              'running',
              `[${index + 1}/${queue.length}] Menunggu: ${activeLoaders} proses masih berjalan (batas: ${maxConcurrent})...`
            );
            await sleep(2500);
            activeLoaders = getActiveLoadingProcessesCount();
          }

          if (!await shouldContinue()) break;
          console.log(`[Meta AutoPrompt] Slot tersedia (${activeLoaders}/${maxConcurrent}). Melanjutkan eksekusi prompt.`);
        }

        // Auto-Retry Loop & History Tracker
        const maxRetries = settings.maxRetries !== undefined ? settings.maxRetries : 2;
        let attempt = 0;
        let promptSuccess = false;
        let promptError = null;
        let promptStartTime = Date.now();
        let downloadResult = null;

        while (attempt <= maxRetries && !promptSuccess) {
          if (!await shouldContinue()) break;

          if (attempt > 0) {
            const backoffDelay = attempt * 4;
            console.warn(`[Meta AutoPrompt] Percobaan ke-${attempt} gagal, mencoba lagi dalam ${backoffDelay} detik...`);
            await updateStatus('running', `[${index + 1}/${queue.length}] Percobaan ulang ke-${attempt}/${maxRetries} (jeda ${backoffDelay}s)...`);
            await sleep(backoffDelay * 1000);

            // Buka New Chat sebelum retry jika opsi New Chat aktif
            if (settings.alwaysNewChat !== false) {
              await triggerNewChat();
              await sleep(1500);
            }
          }

          attempt++;
          promptStartTime = Date.now();
          promptError = null;

          try {
            // Tandai gambar pra-ada agar tidak terunduh ulang
            markExistingImages();

            // 1. Cari elemen input box
            await updateStatus('running', `[${index + 1}/${queue.length}] Menemukan input box di Meta.ai...`);
            const inputEl = await waitForInputElement(20000);

            if (!inputEl) {
              throw new Error('Tidak dapat menemukan kotak input teks di Meta.ai');
            }

            if (!await shouldContinue()) break;

            // 2. Ketik / Masukkan prompt ke input box
            await updateStatus('running', `[${index + 1}/${queue.length}] Mengisi prompt ke kotak input...`);
            await sleep(600);
            await fillPrompt(inputEl, currentPrompt);
            await sleep(600);

            if (!await shouldContinue()) break;

            // 3. Kirim Prompt
            await updateStatus('running', `[${index + 1}/${queue.length}] Mengirimkan prompt...`);
            const submitted = await submitPrompt(inputEl);
            if (!submitted) {
              throw new Error('Gagal memicu tombol kirim prompt');
            }

            await sleep(1500);
            if (!await shouldContinue()) break;

            // 4. Tunggu respons Meta AI selesai di-generate
            await updateStatus('running', `[${index + 1}/${queue.length}] Menunggu respons Meta.ai selesai...`);
            const generationSuccess = await waitForResponseCompletion(settings.maxTimeout || 90);
            console.log('[Meta AutoPrompt] Respons selesai, status sukses:', generationSuccess);

            // Cek apakah ada error pada tampilan Meta.ai
            const metaError = detectMetaAiError();
            if (metaError) {
              throw new Error(metaError);
            }

            if (!generationSuccess) {
              throw new Error('Timeout menunggu jawaban Meta.ai');
            }

            if (!await shouldContinue()) break;

            // 4b. Download gambar jika ada gambar yang sudah selesai dan fitur diaktifkan
            if (settings.autoDownloadImages !== false) {
              await updateStatus('running', `[${index + 1}/${queue.length}] Memeriksa & mengunduh gambar hasil generate...`);
              await sleep(300); // Beri waktu rendering DOM singkat
              downloadResult = await downloadCompletedImages();
              if (downloadResult && downloadResult.count > 0) {
                await updateStatus('running', `[${index + 1}/${queue.length}] Berhasil mengunduh ${downloadResult.count} gambar!`);
                await sleep(400);
              }
            }

            promptSuccess = true;
          } catch (execErr) {
            promptError = execErr.message || String(execErr);
            console.warn(`[Meta AutoPrompt] Prompt [${index + 1}] gagal pada percobaan ${attempt}:`, promptError);
          }
        }

        // Catat eksekusi ke Execution History
        const durationSec = ((Date.now() - promptStartTime) / 1000).toFixed(1);
        await recordExecutionHistory({
          prompt: currentPrompt,
          status: promptSuccess ? 'success' : 'failed',
          durationSec: durationSec,
          error: promptSuccess ? null : promptError,
          imageUrl: downloadResult?.url || null,
          filename: downloadResult?.filename || null
        });

        if (!await shouldContinue()) break;

        // 5. Jeda setelah respons selesai sesuai konfigurasi pengguna
        const delaySec = Math.max(1, settings.delayAfterResponse || 5);
        for (let s = delaySec; s > 0; s--) {
          if (!await shouldContinue()) break;
          await updateStatus('running', `[${index + 1}/${queue.length}] Jeda ${s} detik sebelum chat berikutnya...`);
          await sleep(1000);
        }

        if (!await shouldContinue()) break;

        // 6. Siapkan indeks berikutnya
        const nextIndex = index + 1;
        await safeStorageSet({ currentIndex: nextIndex });

        if (nextIndex >= queue.length) {
          await updateStatus('completed', `Selesai! ${queue.length} prompt berhasil diproses.`);
          break;
        }

        // Cek kembali proses aktif sebelum New Chat dan prompt selanjutnya
        activeLoaders = getActiveLoadingProcessesCount();
        if (activeLoaders >= maxConcurrent) {
          console.log(`[Meta AutoPrompt] Menunggu slot sebelum New Chat (${activeLoaders} proses berjalan)...`);
          while (activeLoaders >= maxConcurrent) {
            if (!await shouldContinue()) break;
            await updateStatus(
              'running',
              `Menunggu slot chat baru: ${activeLoaders} proses masih berjalan (batas: ${maxConcurrent})...`
            );
            await sleep(2500);
            activeLoaders = getActiveLoadingProcessesCount();
          }
          if (!await shouldContinue()) break;
        }

        // 7. Buka New Chat jika opsi aktif
        if (settings.alwaysNewChat !== false) {
          await updateStatus('running', `Membuka "New Chat" untuk prompt ${nextIndex + 1}...`);
          const resetSuccess = await triggerNewChat();
          
          if (!resetSuccess) {
            // Jika tombol New Chat tidak terdeteksi via DOM, gunakan navigasi URL
            console.log('[Meta AutoPrompt] Menggunakan fallback navigasi ke https://www.meta.ai/');
            window.location.href = 'https://www.meta.ai/';
            return; // Halaman akan reload dan script akan otomatis lanjut dari storage
          }

          // Tunggu sebentar setelah klik New Chat
          await sleep(2000);
          markExistingImages();
        }
      }
    } catch (err) {
      console.error('[Meta AutoPrompt] Error pada loop:', err);
      if (isContextValid()) {
        await updateStatus('paused', `Terjadi kendala: ${err.message || err}`);
      }
    } finally {
      isLoopActive = false;
    }
  }

  // ==========================================
  // DOM INTERACTION HELPERS (Meta.ai Optimized)
  // ==========================================

  /**
   * Menemukan elemen input pada Meta.ai (Lexical editor, ContentEditable, atau Textarea)
   */
  async function waitForInputElement(timeoutMs = 15000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!isLoopActive || !isContextValid()) return null;

      // Prioritas 1: Exact Meta.ai Lexical composer input
      const lexicalExact = document.querySelector(
        'div[data-testid="composer-input"][contenteditable="true"], [data-lexical-editor="true"][data-testid="composer-input"]'
      );
      if (lexicalExact && isVisible(lexicalExact)) {
        return lexicalExact;
      }

      // Prioritas 2: Contenteditable / Lexical editor umum
      const contentEditable = document.querySelector(
        'div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
      );
      if (contentEditable && isVisible(contentEditable)) {
        return contentEditable;
      }

      // Prioritas 3: Textarea
      const textarea = document.querySelector('textarea[data-testid="composer-input"], textarea');
      if (textarea && isVisible(textarea)) {
        return textarea;
      }

      await sleep(400);
    }

    return null;
  }

  /**
   * Mengisi teks prompt dengan kompatibilitas penuh React & Lexical editor Meta.ai
   */
  async function fillPrompt(el, text) {
    el.focus();
    await sleep(150);

    const isContentEditable = el.getAttribute('contenteditable') === 'true' || 
                              el.getAttribute('role') === 'textbox' ||
                              el.dataset.lexicalEditor === 'true' ||
                              el.getAttribute('data-testid') === 'composer-input';

    if (isContentEditable) {
      // 1. Tempatkan cursor / seleksi di dalam editor
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      // 2. Coba kosongkan konten yang ada
      try {
        document.execCommand('delete', false, null);
      } catch (e) {
        el.textContent = '';
      }
      await sleep(50);

      // 3. Teknik 1: ClipboardEvent Paste (Sangat efektif untuk Lexical/React)
      let pasteSuccess = false;
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const pasteEv = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        pasteSuccess = el.dispatchEvent(pasteEv);
      } catch (e) {
        pasteSuccess = false;
      }

      await sleep(100);

      // 4. Teknik 2: execCommand insertText (Jika belum terisi)
      if (!el.textContent.trim()) {
        try {
          document.execCommand('insertText', false, text);
        } catch (e) {}
      }

      await sleep(100);

      // 5. Teknik 3: InputEvent sintetis jika masih belum ada teks
      if (!el.textContent.trim()) {
        const pTag = el.querySelector('p') || el;
        pTag.textContent = text;

        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

    } else {
      // Textarea biasa
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Tunggu React state memproses perubahan dan mengaktifkan tombol kirim
    await waitForSendButtonEnabled(1500);
  }

  /**
   * Menunggu tombol Send aktif (disabled dihilangkan oleh Meta.ai)
   */
  async function waitForSendButtonEnabled(maxWaitMs = 1500) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (!isLoopActive) return false;
      const btn = findSendButton();
      if (btn && !btn.disabled) {
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  /**
   * Mengirimkan prompt (klik tombol submit atau Enter)
   */
  async function submitPrompt(inputEl) {
    // 1. Cari tombol kirim Meta.ai
    let sendBtn = findSendButton(inputEl);

    if (sendBtn && !sendBtn.disabled) {
      console.log('[Meta AutoPrompt] Mengklik tombol Send:', sendBtn);
      sendBtn.click();
      return true;
    }

    // Jika tombol masih disabled, coba trigger event keyboard pada editor
    inputEl.focus();
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    await sleep(200);

    sendBtn = findSendButton(inputEl);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return true;
    }

    // 2. Simulasi penekanan tombol Enter pada input box
    console.log('[Meta AutoPrompt] Menekan tombol Enter pada editor...');
    inputEl.focus();

    const enterDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    const enterUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    inputEl.dispatchEvent(enterDown);
    inputEl.dispatchEvent(enterUp);

    return true;
  }

  /**
   * Mencari tombol pengiriman berdasarkan data-testid dan aria-label Meta.ai
   */
  function findSendButton(inputEl) {
    // 1. Exact data-testid dari Meta.ai
    const exactTestId = document.querySelector('button[data-testid="composer-send-button"]');
    if (exactTestId && isVisible(exactTestId)) {
      return exactTestId;
    }

    // 2. Aria-label Kirim / Send
    const ariaSend = document.querySelector(
      'button[aria-label="Kirim"], button[aria-label="Send"], button[aria-label*="Send" i], button[aria-label*="Kirim" i]'
    );
    if (ariaSend && isVisible(ariaSend)) {
      return ariaSend;
    }

    // 3. Cari tombol di sekitar container input
    if (inputEl) {
      let parent = inputEl.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++) {
        const btn = parent.querySelector('button[data-testid="composer-send-button"], button[aria-label="Kirim"], button[aria-label="Send"]');
        if (btn && isVisible(btn)) return btn;
        parent = parent.parentElement;
      }
    }

    // 4. Heuristik container composer: cari tombol aksi submit / ikon panah atas (↑)
    const composer = inputEl?.closest('form') || inputEl?.closest('[data-testid*="composer"]') || document.querySelector('form, [data-testid*="composer"]');
    if (composer) {
      const candidateButtons = Array.from(composer.querySelectorAll('button')).filter(isVisible);
      for (const btn of candidateButtons) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        // Kecualikan tombol lampirkan / mikrofon / voice / think
        if (aria.includes('lampir') || aria.includes('attach') || aria.includes('mikrofon') || aria.includes('voice') || aria.includes('pikir') || aria.includes('think')) {
          continue;
        }
        // Cek apakah tombol submit, memiliki SVG, atau data-testid composer
        if (btn.type === 'submit' || btn.querySelector('svg') || btn.getAttribute('data-testid')?.includes('send')) {
          return btn;
        }
      }
      if (candidateButtons.length > 0) {
        return candidateButtons[candidateButtons.length - 1];
      }
    }

    return null;
  }

  /**
   * Menunggu Meta AI menyelesaikan generasi respons
   */
  async function waitForResponseCompletion(maxTimeoutSec = 90) {
    const startTime = Date.now();
    const timeoutMs = maxTimeoutSec * 1000;

    let sawGenerating = false;
    let lastActivityTime = Date.now();
    let newImageDetectedTime = null;

    // Pantau perubahan DOM KHUSUS di area obrolan main (bukan document.body agar tidak terganggu update HUD)
    const targetEl = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const observer = new MutationObserver((mutations) => {
      // Abaikan mutasi jika berasal dari Floating HUD
      for (const m of mutations) {
        if (m.target?.closest?.('#map-floating-hud')) continue;
        lastActivityTime = Date.now();
        break;
      }
    });
    activeObserver = observer;

    observer.observe(targetEl, {
      childList: true,
      subtree: true,
      characterData: true
    });

    try {
      while (Date.now() - startTime < timeoutMs) {
        if (!isContextValid() || !await shouldContinue()) return false;

        const isGenerating = isAiGenerating();
        if (isGenerating) {
          sawGenerating = true;
          lastActivityTime = Date.now();
        }

        // 1. DETEKSI CEPAT RESPON GAMBAR:
        // Jika tombol unduh atau gambar baru sudah muncul di DOM dan AI tidak lagi generating
        const hasPendingDownloads = findPendingDownloadButtons().length > 0;
        const hasNewImage = hasPendingDownloads || checkForNewGeneratedImage();

        if (hasNewImage && !isGenerating) {
          if (newImageDetectedTime === null) {
            newImageDetectedTime = Date.now();
          } else if (Date.now() - newImageDetectedTime >= 1200) {
            console.log('[Meta AutoPrompt] Selesai: Gambar hasil generate terdeteksi siap diunduh!');
            return true;
          }
        } else {
          newImageDetectedTime = null;
        }

        const idleDuration = Date.now() - lastActivityTime;

        // 2. DETEKSI TEKS/CHAT NORMAL:
        // Jika sempat ada generasi teks, lalu stop button hilang & DOM stabil selama 1.8 detik
        if (sawGenerating && !isGenerating && idleDuration > 1800) {
          console.log('[Meta AutoPrompt] Selesai: Generasi respons Meta.ai telah rampung.');
          return true;
        }

        // 3. Fallback: Jika tidak terdeteksi stop button (misal selesai sangat cepat),
        // namun idle sudah > 2.5 detik setelah minimal 4 detik berjalan
        if (!sawGenerating && (Date.now() - startTime > 4000) && idleDuration > 2500 && !isGenerating) {
          return true;
        }

        await sleep(500);
      }
    } finally {
      observer.disconnect();
      if (activeObserver === observer) activeObserver = null;
    }

    console.warn('[Meta AutoPrompt] Timeout menunggu respons selesai, melanjutkan ke langkah berikutnya.');
    return true;
  }

  /**
   * Mendeteksi apakah Meta AI sedang dalam proses menghasilkan respons.
   * Menggunakan stop button composer dan data-streaming-state dari pesan asisten.
   */
  function isAiGenerating() {
    // 1. Selector tombol stop aktif di composer
    const stopSelectors = [
      'button[data-testid="composer-stop-button"]',
      'button[aria-label="Hentikan"]',
      'button[aria-label="Stop"]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Hentikan generasi" i]'
    ];

    for (const sel of stopSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.isConnected && isVisible(btn)) {
        return true;
      }
    }

    // 2. Simbol kotak stop di dalam composer
    const composer = document.querySelector('[data-testid="composer-send-button"]')?.closest('div') ||
                     document.querySelector('main footer, footer');
    if (composer) {
      const stopBox = composer.querySelector('rect, [d*="M6 6h12v12H6"]');
      if (stopBox && isVisible(stopBox)) {
        return true;
      }
    }

    // 3. Status streaming resmi dari data-testid="assistant-message"
    const assistantMessages = document.querySelectorAll('[data-testid="assistant-message"]');
    if (assistantMessages.length > 0) {
      const latestMsg = assistantMessages[assistantMessages.length - 1];
      const streamingState = latestMsg.getAttribute('data-streaming-state');
      const streamingComplete = latestMsg.getAttribute('data-streaming-complete');

      if (streamingComplete === 'false') return true;
      if (streamingState && streamingState !== 'DONE') return true;
    }

    return false;
  }

  /**
   * Menghitung berapa banyak proses loading aktif yang sedang berjalan di Meta.ai.
   */
  function getActiveLoadingProcessesCount() {
    let count = 0;
    const assistantMessages = document.querySelectorAll('[data-testid="assistant-message"]');
    for (const msg of assistantMessages) {
      if (msg.getAttribute('data-streaming-complete') === 'false' ||
          (msg.getAttribute('data-streaming-state') && msg.getAttribute('data-streaming-state') !== 'DONE')) {
        count++;
      }
    }
    if (count === 0 && isAiGenerating()) {
      count = 1;
    }
    return count;
  }

  /**
   * Memicu pembuatan New Chat di Meta.ai
   */
  async function triggerNewChat() {
    // 1. Exact data-testid dari Meta.ai (seperti pada HTML: data-testid="new-chat-button")
    const exactNewChat = document.querySelector('[data-testid="new-chat-button"]');
    if (exactNewChat && isVisible(exactNewChat)) {
      console.log('[Meta AutoPrompt] Menekan tombol [data-testid="new-chat-button"]:', exactNewChat);
      exactNewChat.click();
      await sleep(1500);
      return true;
    }

    // 2. Selector link Beranda / Obrolan baru
    const selectors = [
      'a[href="/"][data-slot="sidebar-menu-button"]',
      'a[href="/"]',
      'button[aria-label*="New chat" i]',
      'button[aria-label*="Obrolan baru" i]',
      'a[aria-label*="New chat" i]',
      '[role="button"][aria-label*="New chat" i]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        console.log('[Meta AutoPrompt] Menekan tombol New Chat:', el);
        el.click();
        await sleep(1500);
        return true;
      }
    }

    // 3. Cari tombol berdasarkan teks konten ("Obrolan baru" atau "New chat")
    const allClickables = document.querySelectorAll('button, a, div[role="button"]');
    for (const el of allClickables) {
      const text = (el.textContent || '').trim().toLowerCase();
      if ((text.includes('obrolan baru') || text.includes('new chat')) && isVisible(el)) {
        console.log('[Meta AutoPrompt] Menekan elemen New Chat teks:', el);
        el.click();
        await sleep(1500);
        return true;
      }
    }

    return false;
  }

  /**
   * Menandai elemen gambar yang sudah ada sebelumnya di DOM agar tidak diunduh ulang
   */
  function markExistingImages() {
    const existing = document.querySelectorAll(
      'button[aria-label="Unduh"], button[aria-label="Download"], button[aria-label*="Unduh" i], button[aria-label*="Download" i], img[data-testid="ur-image-tile"], .group\\/media-item, [class*="group/media-item"], main img, [role="main"] img'
    );
    for (const el of existing) {
      el.setAttribute('data-map-preexisting', 'true');
    }
  }

  /**
   * Mendeteksi apakah ada elemen gambar baru hasil generate yang selesai dirender di main
   */
  function checkForNewGeneratedImage() {
    const images = document.querySelectorAll(
      'img[data-testid="ur-image-tile"], .group\\/media-item img, [class*="group/media-item"] img, main img, [role="main"] img'
    );
    for (const img of images) {
      if (img.getAttribute('data-map-preexisting')) continue;
      if (img.getAttribute('data-map-downloaded')) continue;

      if (img.src && (img.src.startsWith('http') || img.src.startsWith('blob:'))) {
        const isMediaItem = img.getAttribute('data-testid') === 'ur-image-tile' ||
                            img.closest('.group\\/media-item, [class*="group/media-item"]');
        if (isMediaItem) return true;

        const rect = img.getBoundingClientRect();
        if ((rect.width >= 100 && rect.height >= 100) || (img.complete && img.naturalWidth >= 100)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Menemukan dan mengunduh gambar yang telah selesai di-generate oleh Meta AI secara instan
   */
  async function downloadCompletedImages() {
    console.log('[Meta AutoPrompt] Mencari gambar hasil generate yang siap diunduh...');

    let downloadedCount = 0;
    let lastUrl = null;
    let lastFilename = null;

    // Cari semua gambar baru di area obrolan
    const candidateImages = Array.from(document.querySelectorAll(
      'img[data-testid="ur-image-tile"], .group\\/media-item img, [class*="group/media-item"] img, main img, [role="main"] img'
    )).filter(img => {
      if (img.getAttribute('data-map-downloaded')) return false;
      if (img.getAttribute('data-map-preexisting')) return false;
      if (!img.src || (!img.src.startsWith('http') && !img.src.startsWith('blob:'))) return false;

      const isMediaItem = img.getAttribute('data-testid') === 'ur-image-tile' ||
                          img.closest('.group\\/media-item, [class*="group/media-item"]');
      if (isMediaItem) return true;

      const rect = img.getBoundingClientRect();
      return (rect.width >= 100 && rect.height >= 100) || (img.complete && img.naturalWidth >= 100);
    });

    for (const img of candidateImages) {
      try {
        img.setAttribute('data-map-downloaded', 'true');
        const container = img.closest('.group\\/media-item, [class*="group/media-item"]') || img.parentElement;
        if (container) container.setAttribute('data-map-downloaded', 'true');

        // Bersihkan nama file dari atribut alt
        let cleanName = (img.alt || 'MetaAI_Image')
          .replace(/^(gallery\/|images\/)/i, '')
          .replace(/\.(webp|png|jpe?g)$/i, '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 40);
        if (!cleanName) cleanName = 'MetaAI_Image';
        const filename = `${cleanName}_${Date.now() % 100000}.webp`;

        lastUrl = img.src;
        lastFilename = filename;

        // Tandai tombol unduh resmi agar tidak diproses ganda
        const dlBtn = container?.querySelector('button[aria-label*="Unduh" i], button[aria-label*="Download" i]');
        if (dlBtn) {
          dlBtn.setAttribute('data-map-downloaded', 'true');
        }

        // Langsung unduh via Background Service Worker (Chrome Downloads API)
        console.log('[Meta AutoPrompt] Memulai unduhan gambar instan via Background:', img.src);
        safeSendMessage({
          action: 'DOWNLOAD_IMAGE',
          url: img.src,
          filename: filename
        }, (res) => {
          if (!res || !res.success) {
            triggerAnchorDownload(img.src, filename);
          }
        });

        downloadedCount++;
        await sleep(300);
      } catch (err) {
        console.warn('[Meta AutoPrompt] Error saat memproses unduhan gambar:', err);
      }
    }

    console.log(`[Meta AutoPrompt] Selesai proses download: ${downloadedCount} gambar diproses.`);
    return {
      count: downloadedCount,
      url: lastUrl,
      filename: lastFilename
    };
  }

  /**
   * Mendeteksi adanya pesan error atau banner kendala pada obrolan Meta AI
   */
  function detectMetaAiError() {
    const errorSelectors = [
      '[role="alert"]',
      'div[data-slot="toast"][data-type="error"]',
      'div[data-testid="error-message"]',
      '.text-danger'
    ];

    for (const sel of errorSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const text = (el.textContent || '').trim();
        if (text.length > 3) return text;
      }
    }

    // Cek tombol coba lagi / try again
    const retryBtn = document.querySelector('button[aria-label="Coba lagi"], button[aria-label="Try again"], button[aria-label*="Coba lagi" i]');
    if (retryBtn && isVisible(retryBtn)) {
      return 'Meta.ai meminta untuk mencoba lagi (muncul tombol "Coba lagi").';
    }

    // Cek teks error umum di paragraf obrolan terbaru
    const paragraphs = document.querySelectorAll('main p, main [role="article"] p');
    for (const p of paragraphs) {
      const text = (p.textContent || '').toLowerCase();
      if (
        text.includes('something went wrong') ||
        text.includes('terjadi kesalahan') ||
        text.includes('unable to generate') ||
        text.includes('gagal menghasilkan gambar') ||
        text.includes('please try again later')
      ) {
        return p.textContent.trim();
      }
    }

    return null;
  }

  /**
   * Mencatat hasil eksekusi prompt ke riwayat lokal persisten
   */
  async function recordExecutionHistory(entry) {
    if (!isContextValid()) return;
    try {
      const data = await safeStorageGet(['executionHistory']);
      if (!data) return;
      const history = data.executionHistory || [];
      const newEntry = {
        id: 'hist_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        ...entry
      };
      history.push(newEntry);
      if (history.length > 150) history.shift();
      await safeStorageSet({ executionHistory: history });
    } catch (e) {
      console.warn('[Meta AutoPrompt] Gagal mencatat riwayat eksekusi:', e);
    }
  }

  /**
   * Menemukan semua tombol unduh gambar yang belum diproses
   */
  function findPendingDownloadButtons() {
    const results = [];

    // 1. Selector aria-label Unduh / Download / Simpan
    const buttons = document.querySelectorAll(
      'button[aria-label*="Unduh" i], button[aria-label*="Download" i], button[aria-label*="Simpan" i], button[aria-label*="Save" i]'
    );

    for (const b of buttons) {
      if (!b.disabled &&
          !b.getAttribute('data-map-downloaded') &&
          !b.getAttribute('data-map-preexisting') &&
          b.getAttribute('aria-busy') !== 'true' &&
          b.isConnected) {
        results.push(b);
      }
    }

    if (results.length > 0) return results;

    // 2. Fallback: Cari tombol di dalam media-item dengan ikon SVG unduh (arrow down/tray)
    const mediaButtons = document.querySelectorAll(
      '.group\\/media-item button, [class*="group/media-item"] button, main [role="article"] button, main button'
    );

    for (const b of mediaButtons) {
      if (b.disabled ||
          b.getAttribute('data-map-downloaded') ||
          b.getAttribute('data-map-preexisting') ||
          b.getAttribute('aria-busy') === 'true' ||
          !b.isConnected) {
        continue;
      }

      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      // Kecualikan tombol composer atau non-unduh
      if (aria.includes('tambah') || aria.includes('plus') || aria.includes('remix') || aria.includes('kirim') || aria.includes('send') || aria.includes('voice') || aria.includes('pikir')) {
        continue;
      }

      const svg = b.querySelector('svg');
      if (svg) {
        const svgContent = svg.innerHTML || svg.outerHTML || '';
        if (svgContent.includes('15.006') || svgContent.includes('14.8') || svgContent.includes('11.12') || svgContent.includes('M6') || aria.includes('download') || aria.includes('unduh')) {
          results.push(b);
        }
      }
    }

    return results;
  }

  /**
   * Trigger unduhan via elemen <a> sembunyi jika diperlukan
   */
  function triggerAnchorDownload(url, filename) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'meta_ai_image.webp';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
    } catch (e) {
      console.warn('[Meta AutoPrompt] Anchor download fallback failed:', e);
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (!isLoopActive || isDestroyed || Date.now() - startTime >= ms) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  // ==========================================
  // FLOATING HUD OVERLAY
  // ==========================================

  function initFloatingHUD() {
    if (document.getElementById('map-floating-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'map-floating-hud';
    hud.innerHTML = `
      <div class="map-hud-header">
        <div class="map-hud-title-wrap">
          <div class="map-hud-icon">A</div>
          <span class="map-hud-title">AutoPrompting</span>
          <span id="mapHudBadge" class="map-hud-badge map-badge-idle">IDLE</span>
        </div>
        <div class="map-hud-header-btns">
          <button id="mapHudOpenTabBtn" class="map-icon-btn" title="Buka Dashboard Tab">↗</button>
          <button id="mapHudMinBtn" class="map-icon-btn" title="Minimalkan / Perluas">_</button>
        </div>
      </div>
      <div class="map-hud-body">
        <div class="map-progress-line">
          <span id="mapHudProgressText">Menunggu antrian...</span>
          <span id="mapHudPercent">0%</span>
        </div>
        <div class="map-hud-track">
          <div id="mapHudBar" class="map-hud-fill" style="width: 0%;"></div>
        </div>
        <div id="mapHudSnippet" class="map-prompt-snippet">- Tidak ada prompt aktif -</div>
        <div class="map-status-row">
          <div class="map-hud-spinner" id="mapHudSpinner" style="display: none;"></div>
          <span id="mapHudDetail">Siap memulai antrian</span>
        </div>
        <div class="map-hud-actions" id="mapHudActions">
          <button id="mapBtnPause" class="map-btn map-btn-primary">Mulai Antrian</button>
          <button id="mapBtnStop" class="map-btn map-btn-danger" disabled>Hentikan</button>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    // Event listeners tombol HUD
    const openTabBtn = hud.querySelector('#mapHudOpenTabBtn');
    openTabBtn?.addEventListener('click', () => {
      if (isContextValid()) {
        chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      }
    });

    const minBtn = hud.querySelector('#mapHudMinBtn');
    minBtn.addEventListener('click', () => {
      isMinimized = !isMinimized;
      hud.classList.toggle('map-minimized', isMinimized);
      minBtn.textContent = isMinimized ? '□' : '_';
    });

    const btnPause = hud.querySelector('#mapBtnPause');
    btnPause?.addEventListener('click', async () => {
      const data = await safeStorageGet(['status', 'queue', 'currentIndex']);
      if (!data) return;
      const curStatus = data.status || 'idle';
      const queue = data.queue || [];

      if (curStatus === 'running') {
        isLoopActive = false;
        await safeStorageSet({ status: 'paused', statusDetail: 'Antrian dijeda dari overlay layar.' });
        updateHUD({ ...data, status: 'paused', statusDetail: 'Antrian dijeda dari overlay layar.' });
      } else if (curStatus === 'paused') {
        await safeStorageSet({ status: 'running', statusDetail: 'Melanjutkan antrian...' });
        updateHUD({ ...data, status: 'running', statusDetail: 'Melanjutkan antrian...' });
        runQueueLoop();
      } else if (curStatus === 'idle' || curStatus === 'completed') {
        if (queue.length > 0) {
          await safeStorageSet({ status: 'running', currentIndex: 0, statusDetail: 'Memulai antrian...' });
          updateHUD({ ...data, status: 'running', currentIndex: 0, statusDetail: 'Memulai antrian...' });
          runQueueLoop();
        }
      }
    });

    const btnStop = hud.querySelector('#mapBtnStop');
    btnStop?.addEventListener('click', async () => {
      isLoopActive = false;
      await safeStorageSet({ status: 'idle', currentIndex: 0, statusDetail: 'Antrian dihentikan oleh pengguna.' });
      const data = await safeStorageGet(['queue', 'settings']);
      updateHUD({ ...(data || {}), status: 'idle', currentIndex: 0, statusDetail: 'Antrian dihentikan oleh pengguna.' });
    });
  }

  function updateHUD(data) {
    const hud = document.getElementById('map-floating-hud');
    if (!hud) return;

    const badge = document.getElementById('mapHudBadge');
    const progressText = document.getElementById('mapHudProgressText');
    const percentText = document.getElementById('mapHudPercent');
    const bar = document.getElementById('mapHudBar');
    const snippet = document.getElementById('mapHudSnippet');
    const detail = document.getElementById('mapHudDetail');
    const spinner = document.getElementById('mapHudSpinner');
    const btnPause = document.getElementById('mapBtnPause');
    const btnStop = document.getElementById('mapBtnStop');

    const status = data.status || 'idle';
    const queue = data.queue || [];
    const index = data.currentIndex || 0;
    const total = queue.length;
    const current = Math.min(index + 1, total);

    badge.className = `map-hud-badge map-badge-${status}`;
    badge.textContent = status.toUpperCase();

    if (status === 'running') {
      const percent = total > 0 ? Math.round((index / total) * 100) : 0;
      progressText.textContent = `Prompt ${current} dari ${total}`;
      percentText.textContent = `${percent}%`;
      bar.style.width = `${percent}%`;
      snippet.textContent = queue[index] || '-';
      detail.textContent = data.statusDetail || 'Memproses...';
      spinner.style.display = 'inline-block';
      if (btnPause) {
        btnPause.textContent = 'Jeda';
        btnPause.disabled = false;
        btnPause.className = 'map-btn map-btn-warning';
      }
      if (btnStop) {
        btnStop.textContent = 'Hentikan';
        btnStop.disabled = false;
        btnStop.className = 'map-btn map-btn-danger';
      }

    } else if (status === 'paused') {
      const percent = total > 0 ? Math.round((index / total) * 100) : 0;
      progressText.textContent = `Dijeda: ${current} dari ${total}`;
      percentText.textContent = `${percent}%`;
      bar.style.width = `${percent}%`;
      snippet.textContent = queue[index] || '-';
      detail.textContent = data.statusDetail || 'Antrian dijeda.';
      spinner.style.display = 'none';
      if (btnPause) {
        btnPause.textContent = 'Lanjutkan';
        btnPause.disabled = false;
        btnPause.className = 'map-btn map-btn-primary';
      }
      if (btnStop) {
        btnStop.textContent = 'Hentikan';
        btnStop.disabled = false;
        btnStop.className = 'map-btn map-btn-danger';
      }

    } else if (status === 'completed') {
      progressText.textContent = `Selesai (${total} prompt)`;
      percentText.textContent = '100%';
      bar.style.width = '100%';
      snippet.textContent = 'Semua antrian tuntas!';
      detail.textContent = data.statusDetail || 'Selesai!';
      spinner.style.display = 'none';
      if (btnPause) {
        btnPause.textContent = 'Mulai Baru';
        btnPause.disabled = queue.length === 0;
        btnPause.className = 'map-btn map-btn-primary';
      }
      if (btnStop) {
        btnStop.textContent = 'Hentikan';
        btnStop.disabled = true;
        btnStop.className = 'map-btn map-btn-danger';
      }

    } else {
      // idle
      progressText.textContent = 'Menunggu antrian...';
      percentText.textContent = '0%';
      bar.style.width = '0%';
      snippet.textContent = total > 0 ? `${total} prompt siap dijalankan` : '- Tidak ada antrian -';
      detail.textContent = data.statusDetail || 'Siap memulai antrian.';
      spinner.style.display = 'none';
      if (btnPause) {
        btnPause.textContent = 'Mulai Antrian';
        btnPause.disabled = total === 0;
        btnPause.className = 'map-btn map-btn-primary';
      }
      if (btnStop) {
        btnStop.textContent = 'Hentikan';
        btnStop.disabled = true;
        btnStop.className = 'map-btn map-btn-danger';
      }
    }
  }
})();
