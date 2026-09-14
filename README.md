# AutoPrompting 🚀

Ekstensi browser modern berbasis **Chrome Manifest V3** untuk mengotomasi alur pengiriman antrian prompt ke [Meta.ai](https://www.meta.ai/), menunggu respons selesai secara instan, membuat sesi **New Chat**, mengunduh gambar hasil generate langsung ke disk, dan mengulangi antrian sampai tuntas.

---

## ✨ Fitur Unggulan

- **Dashboard Tab Mandiri (Singleton Window)**: Membuka dashboard penuh di tab browser baru. Jika tab sudah terbuka, ekstensi otomatis memfokuskan tab yang ada dan mencegah duplikasi tab.
- **In-Page Floating Mini HUD**: Widget mini elegan di pojok kanan bawah halaman `meta.ai` dengan sinkronisasi 100% real-time dengan Dashboard tab (Progress bar, status badge, tombol Jeda/Stop/Lanjut).
- **Pengunduhan Gambar Instan & Otomatis**: Mendeteksi gambar hasil AI begitu selesai (~1,2 detik), membaca URL resolusi penuh langsung dari CDN Meta, dan mengunduh via Background Service Worker (`chrome.downloads`) ke folder `Downloads/MetaAI_Images/`.
- **Matrix Prompt Generator**: Buat kombinasi prompt massal otomatis menggunakan placeholders seperti `{style}`, `{subject}`, `{lighting}`.
- **Riwayat Eksekusi Lengkap**: Mencatat status prompt, durasi pengerjaan, thumbnail gambar, dan pesan error ke penyimpanan lokal.
- **Smart Completion Detector**: Memantau atribut streaming resmi Meta.ai (`data-streaming-state="DONE"`) dan composer stop button untuk memastikan generasi respons rampung tanpa jeda palsu.
- **Otomatis "New Chat"**: Membersihkan sesi atau membuka obrolan baru untuk setiap prompt agar konteks antar prompt tidak bercampur.
- **State Persistence via `chrome.storage.local`**: Jika halaman Meta.ai me-reload atau berganti URL, ekstensi tidak akan lupa indeks prompt terakhir dan akan otomatis melanjutkan proses.
- **Shortcut Keyboard Cepat**:
  - `Alt+Shift+M` : Buka/Fokus Dashboard AutoPrompting
  - `Alt+Shift+P` : Jeda / Lanjutkan proses antrian

---

## 🛠️ Cara Instalasi di Browser (Chrome, Edge, Brave, Opera)

1. **Buka menu ekstensi browser**:
   - Di Google Chrome: ketik `chrome://extensions/` di address bar.
   - Di Microsoft Edge: ketik `edge://extensions/` di address bar.
   - Di Brave: ketik `brave://extensions/` di address bar.

2. **Aktifkan Mode Pengembang (Developer Mode)**:
   - Geser toggle **"Developer mode"** di pojok kanan atas menjadi **ON**.

3. **Muat Ekstensi (Load Unpacked)**:
   - Klik tombol **"Load unpacked"** (atau *Muat yang belum dibongkar*).
   - Pilih folder proyek ini:
     ```
     /Users/yuda/Documents/Projects/meta-autoprompt
     ```

4. **Selesai!** Ikon **AutoPrompting** akan muncul di bilah toolbar browser Anda. Sematkan (pin) ekstensi agar mudah diakses.

---

## 📖 Cara Menggunakan

1. Buka [https://www.meta.ai/](https://www.meta.ai/) dan pastikan Anda sudah login ke akun Meta Anda.
2. Klik ikon ekstensi **AutoPrompting** di toolbar browser atau tekan `Alt+Shift+M`.
3. Masukkan daftar prompt Anda ke dalam kotak teks antrian atau gunakan tab **Matrix** untuk menghasilkan puluhan variasi prompt.
4. Klik tombol **"Mulai Antrian"**.
5. Ekstensi akan otomatis:
   - Berpindah ke tab Meta.ai.
   - Mengisi prompt ke input composer.
   - Mengirimkan pesan.
   - Mendeteksi gambar yang dihasilkan dan mengunduhnya seketika.
   - Menekan tombol **New Chat**.
   - Melanjutkan ke prompt berikutnya hingga seluruh daftar selesai.

---

## 📂 Struktur File

```
autoprompting/
├── manifest.json         # Konfigurasi Manifest V3
├── icons/                # Ikon ekstensi modern (16x16, 48x48, 128x128, SVG)
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg
├── dashboard/            # Antarmuka Dashboard Tab Utama
│   ├── dashboard.html    # Layout konsol tab terpadu
│   ├── dashboard.css     # Dark mode modern glassmorphism
│   └── dashboard.js      # Controller antrian, matrix generator, & state sync
├── background/           # Background Service Worker
│   └── background.js     # Tab controller (singleton), watchdog, & image downloader
├── content/              # Content script di halaman meta.ai
│   ├── content.js        # Engine otomasi DOM, observer, image downloader & HUD
│   └── content.css       # Style Floating HUD overlay
├── popup/                # Tampilan alternatif popup ekstensi
└── README.md
```

---

## 💡 Tips Penggunaan

- **Prompt Berisi Paragraf / Baris Baru**: Centang opsi **Gunakan pemisah `---`**, lalu pisahkan setiap prompt dengan tanda `---`.
- **Menjeda / Menghentikan**: Anda dapat menekan tombol **Jeda** atau **Hentikan** kapan saja, baik dari popup ekstensi maupun dari widget Floating HUD di layar.
- **Overlay Mengganggu?**: Anda dapat mengklik tombol `_` pada widget HUD di pojok kanan bawah untuk meminimalkannya menjadi kapsul kecil.
