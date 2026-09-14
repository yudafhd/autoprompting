/**
 * Meta.ai AutoPrompt - Background Service Worker
 * Menangani download file Chrome API, keyboard shortcuts, notifikasi sistem, dan watchdog tab.
 */

/**
 * Membuka atau memfokuskan tab Dashboard tunggal (Singleton).
 * Jika tab Dashboard sudah terbuka di window mana pun, tab tersebut difokuskan,
 * tab duplikat lainnya (jika ada) ditutup, dan TIDAK membuka tab baru lagi.
 */
async function openOrFocusDashboardTab() {
  const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
  const sidepanelUrl = chrome.runtime.getURL('sidepanel/sidepanel.html');

  try {
    // 1. Cek langsung tab ID tersimpan jika masih valid
    const stored = await chrome.storage.local.get(['dashboardTabId']);
    if (stored.dashboardTabId) {
      try {
        const tab = await chrome.tabs.get(stored.dashboardTabId);
        if (tab && tab.url && (tab.url.startsWith(dashboardUrl) || tab.url.startsWith(sidepanelUrl))) {
          await chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
          return tab;
        }
      } catch (e) {
        // Tab ID sudah ditutup atau tidak valid
      }
    }

    // 2. Query seluruh tab browser untuk menemukan semua tab dashboard yang ada
    const tabs = await chrome.tabs.query({});
    const dashboardTabs = tabs.filter(t => t.url && (t.url.startsWith(dashboardUrl) || t.url.startsWith(sidepanelUrl)));

    if (dashboardTabs.length > 0) {
      const primaryTab = dashboardTabs[0];
      await chrome.storage.local.set({ dashboardTabId: primaryTab.id });
      await chrome.tabs.update(primaryTab.id, { active: true });
      if (primaryTab.windowId) {
        await chrome.windows.update(primaryTab.windowId, { focused: true });
      }

      // Bersihkan tab duplikat jika ada lebih dari 1
      for (let i = 1; i < dashboardTabs.length; i++) {
        try {
          await chrome.tabs.remove(dashboardTabs[i].id);
        } catch (e) {}
      }
      return primaryTab;
    }

    // 3. Buat tab baru jika benar-benar belum ada
    const newTab = await chrome.tabs.create({ url: dashboardUrl });
    await chrome.storage.local.set({ dashboardTabId: newTab.id });
    return newTab;
  } catch (err) {
    console.error('[Meta AutoPrompt Background] Gagal membuka dashboard tab:', err);
  }
}

// Bersihkan dashboardTabId saat tab ditutup
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const stored = await chrome.storage.local.get(['dashboardTabId']);
    if (stored.dashboardTabId === tabId) {
      await chrome.storage.local.remove('dashboardTabId');
    }
  } catch (e) {}
});

// Buka Dashboard saat ikon toolbar ekstensi diklik (Singleton tab)
chrome.action.onClicked.addListener(async () => {
  await openOrFocusDashboardTab();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Meta AutoPrompt] Extension terpasang/diperbarui:', details.reason);

  // Set default settings jika belum ada
  const existing = await chrome.storage.local.get(['settings', 'status']);
  const defaultSettings = {
    delayAfterResponse: 5,
    maxConcurrent: 5,
    maxRetries: 2,
    maxTimeout: 90,
    alwaysNewChat: true,
    autoDownloadImages: true,
    useDelimiter: false,
    audioChime: true,
    systemNotifications: true
  };

  const updates = {};
  if (!existing.settings) {
    updates.settings = defaultSettings;
  } else {
    // Sinkronisasi setting baru jika belum ada
    const merged = { ...defaultSettings, ...existing.settings };
    updates.settings = merged;
  }

  if (!existing.status) {
    updates.status = 'idle';
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  // Otomatis inject script ke tab Meta.ai yang sudah terbuka agar tidak ada tab terlantar (orphaned)
  if (chrome.scripting) {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content/content.css']
          });
          console.log('[Meta AutoPrompt Background] Sukses re-inject content script ke tab:', tab.id);
        } catch (tabErr) {
          // Tab mungkin belum selesai loading atau tidak dapat diinjeksi
        }
      }
    } catch (e) {
      console.warn('[Meta AutoPrompt Background] Error auto-injecting tabs onInstalled:', e);
    }
  }
});

// Listener Shortcut Keyboard
chrome.commands.onCommand.addListener(async (command) => {
  if (command === '_execute_action') {
    await openOrFocusDashboardTab();
  } else if (command === 'toggle_pause') {
    const data = await chrome.storage.local.get(['status']);
    const current = data.status || 'idle';

    if (current === 'running') {
      await chrome.storage.local.set({
        status: 'paused',
        statusDetail: 'Antrian dijeda via pintasan keyboard (Alt+Shift+P).'
      });
      notifyActiveTab();
    } else if (current === 'paused') {
      await chrome.storage.local.set({
        status: 'running',
        statusDetail: 'Melanjutkan antrian via pintasan keyboard (Alt+Shift+P)...'
      });
      notifyActiveTab();
    }
  }
});

// Listener untuk Notifikasi Desktop saat Antrian Selesai
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.status && changes.status.newValue === 'completed' && changes.status.oldValue === 'running') {
    chrome.storage.local.get(['settings', 'queue'], (res) => {
      const allowed = res.settings?.systemNotifications !== false;
      if (allowed && chrome.notifications) {
        const total = res.queue ? res.queue.length : 0;
        chrome.notifications.create('meta_autoprompt_done', {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Meta.ai AutoPrompt Selesai! 🎉',
          message: `Semua ${total} prompt dalam antrian Anda telah selesai diproses.`,
          priority: 2
        });
      }
    });
  }
});

// Listener untuk pesan dari content script & dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OPEN_DASHBOARD') {
    openOrFocusDashboardTab().then((tab) => {
      sendResponse({ success: true, tabId: tab?.id });
    });
    return true; // Asynchronous response
  }

  if (request.action === 'DOWNLOAD_IMAGE' && request.url) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = request.url.includes('.webp') ? 'webp' : 'jpg';
    const filename = request.filename || `MetaAI_${timestamp}_${Math.floor(Math.random() * 1000)}.${ext}`;

    chrome.downloads.download({
      url: request.url,
      filename: `MetaAI_Images/${filename}`,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('[Meta AutoPrompt Background] Download gagal:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[Meta AutoPrompt Background] Download dimulai, ID:', downloadId);
        sendResponse({ success: true, downloadId });
      }
    });

    return true; // Asynchronous response
  }
});

// Watchdog Anti-Stall: Memeriksa liveness tab Meta.ai saat status 'running'
let failedPings = 0;
setInterval(async () => {
  try {
    const data = await chrome.storage.local.get(['status']);
    if (data.status !== 'running') {
      failedPings = 0;
      return;
    }

    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length === 0) return;

    const targetTab = tabs.find(t => t.active) || tabs[0];
    chrome.tabs.sendMessage(targetTab.id, { action: 'HEARTBEAT_PING' }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        failedPings++;
        console.warn(`[Meta AutoPrompt Watchdog] Tab Meta.ai tidak merespon (missed: ${failedPings}/2)`);

        // Coba re-inject script saat pertama kali ping gagal
        if (failedPings === 1 && chrome.scripting) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['content/content.js']
            });
            await chrome.scripting.insertCSS({
              target: { tabId: targetTab.id },
              files: ['content/content.css']
            });
            console.log('[Meta AutoPrompt Watchdog] Berhasil re-inject script pada missed ping 1');
            return;
          } catch (e) {}
        }

        // Jika 2 kali berturut-turut tab tetap tidak merespon, picu reload tab untuk pemulihan
        if (failedPings >= 2) {
          console.warn('[Meta AutoPrompt Watchdog] Tab tidak merespon, memicu reload tab untuk pemulihan...');
          failedPings = 0;
          chrome.tabs.reload(targetTab.id);
        }
      } else {
        failedPings = 0;
      }
    });
  } catch (e) {
    // Background query error
  }
}, 15000);

async function notifyActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.meta.ai/*' });
    if (tabs.length === 0) return;

    const targetTab = tabs.find(t => t.active) || tabs[0];
    chrome.tabs.sendMessage(targetTab.id, { action: 'CHECK_STATE' }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        console.warn('[Meta AutoPrompt Background] notifyActiveTab: content script belum respon, mencoba re-inject...');
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
              chrome.tabs.sendMessage(targetTab.id, { action: 'CHECK_STATE' }).catch(() => {});
            }, 600);
          } catch (e) {
            chrome.tabs.reload(targetTab.id);
          }
        } else {
          chrome.tabs.reload(targetTab.id);
        }
      }
    });
  } catch (e) {}
}
