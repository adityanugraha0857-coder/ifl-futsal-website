# IFL Event × Fafage Academy Pontianak

Website event futsal dengan tampilan hitam-emas mengikuti logo yang diberikan. Termasuk halaman publik, jadwal dan hasil pertandingan, kalender event, profil academy, tautan Instagram, kontak panitia yang dapat diubah, dan panel admin dengan autentikasi server.

## Persyaratan
- Node.js 18 atau lebih baru
- npm
- VS Code (disarankan)

## Menjalankan di VS Code
1. Ekstrak ZIP, lalu buka folder `ifl-futsal-website` di VS Code.
2. Buka terminal pada folder proyek.
3. Install dependensi:
   ```bash
   npm install
   ```
4. Salin `.env.example` menjadi `.env`.
   - Windows CMD: `copy .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Edit `.env`. Ganti `SESSION_SECRET` dengan string acak minimal 32 karakter. Isi `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dengan akun milik Anda. Jangan gunakan password contoh atau membagikan file `.env`. Password harus minimal 12 karakter.
6. Siapkan akun admin:
   ```bash
   npm run init-admin
   ```
   Jika `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env` telah diisi, skrip akan menggunakannya. Perintah ini membuat atau memperbarui hash password akun tersebut.
7. Jalankan server:
   ```bash
   npm start
   ```
8. Buka `http://localhost:3000` untuk website dan `http://localhost:3000/admin` untuk panel admin.

Database SQLite dibuat otomatis pada folder `data/` saat server dijalankan. Data event, pertandingan, hasil, kontak dan sesi login disimpan di server, bukan hanya di browser.

## Fitur panel admin
- Login menggunakan username dan password yang diverifikasi server dengan bcrypt.
- Membuat, mengedit, dan menghapus event.
- Membuat, mengedit, dan menghapus jadwal pertandingan.
- Mengunggah logo PNG, JPG, atau WEBP untuk tim home dan away pada setiap pertandingan.
- Menampilkan lineup dan ofisial yang sudah tersimpan pada detail jadwal website; fitur impor lineup sementara disembunyikan dari panel admin.
- Mengimpor daftar peserta setiap event dari Excel, termasuk nama dan logo tim; halaman event menampilkan jumlah serta daftar logo peserta dengan navigasi khusus.
- Membuka jadwal dan seluruh hasil khusus turnamen langsung dari tombol **LIHAT JADWAL** pada kartu event.
- Membuat beberapa kategori/divisi untuk satu event, menetapkan kategori pada tiap pertandingan, dan menampilkan fixture per kategori pada halaman event tersendiri.
- Mengisi atau mengosongkan skor; skor yang diisi akan tampil pada bagian hasil.
- Mengatur fase pertandingan (grup, gugur, atau lainnya), skor, dan adu penalti.
- Menyimpan otomasi klasemen, kelolosan, dan bagan gugur untuk konfigurasi kompetisi yang sudah tersimpan; pengaturan klasemen sementara disembunyikan dari panel admin.
- Mengatur status pertandingan, babak, lapangan, dan event terkait. Nama grup tidak lagi wajib; pertandingan fase grup tanpa nama grup dihitung bersama dalam satu klasemen "Liga".
- Mengatur dua nomor WhatsApp admin, email, lokasi, dan deskripsi; tombol kontak Admin 1 dan Admin 2 ditampilkan pada halaman publik.
- Mengganti password admin.
- Batas percobaan login, hash password bcrypt, cookie sesi HttpOnly/SameSite, validasi Origin pada permintaan perubahan data, dan sesi tersimpan di SQLite.
- Database disimpan di server; API penambahan, perubahan, dan penghapusan memerlukan sesi admin yang valid.

Logo tim dapat ditambahkan atau diganti melalui form tambah/edit pertandingan. Setelah event dipilih, pilih peserta dari daftar tim terdaftar untuk mengisi nama dan memasang logo peserta secara otomatis; tim yang tidak terdaftar tetap bisa dimasukkan manual. Logo otomatis disesuaikan ke kotak dengan mempertahankan rasio aslinya, jadi tidak terpotong atau berubah bentuk. Pilih file pada bagian **LOGO TIM HOME** dan **LOGO TIM AWAY** untuk mengganti logo pertandingan secara manual. Format yang diterima PNG, JPG, dan WEBP, maksimal 1 MB per logo. File logo disimpan di folder `team-logos/` dalam `DATA_DIR`, jadi gunakan penyimpanan persisten pada hosting agar logo tetap tersedia setelah restart atau deploy.

### Event, kategori, dan halaman jadwal
1. Saat menambah atau mengedit event, masukkan nama kategori/divisi seperti `U-12`, `U-15`, dan `Umum` pada kolom **KATEGORI PERTANDINGAN / DIVISI** (pisahkan dengan koma atau baris baru).
2. Pada form pertandingan pilih event, kategori, dan isi jadwal, tim, serta skor seperti biasa.
3. Tampilan publik klasemen/bagan dan pengaturan klasemen di admin untuk sementara disembunyikan. Otomasi serta konfigurasi kompetisi yang sudah tersimpan tidak dihapus.

### Lineup dan ofisial pertandingan
Lineup/ofisial yang sudah tersimpan tetap dapat dilihat pada jadwal publik melalui tombol **Lineup & ofisial tim**. Form impor lineup sementara disembunyikan dari panel admin; data yang sudah tersimpan tidak dihapus.

### Impor peserta tim event
1. Masuk ke `/admin`, lalu pada panel **EVENT** buka bagian **Impor peserta tim event dari Excel**.
2. Pilih event dan unduh template peserta. Isi satu baris untuk setiap tim pada sheet `Data`.
3. Masukkan logo PNG/JPG ke kolom **Logo Tim** pada baris yang sama dengan nama tim.
4. Unggah file `.xlsx`. Impor akan mengganti seluruh daftar peserta event yang dipilih.
5. Saat membuat jadwal pertandingan, pilih event lalu pilih tim home dan away dari daftar peserta. Logo setiap tim terpasang otomatis; tim yang tidak terdaftar dapat dimasukkan secara manual.
6. Halaman event menampilkan jumlah peserta, nama, dan logo tim pada navigasi **PESERTA TIM**. Daftar peserta terbatas 200 tim per event, dengan ukuran maksimal 1 MB per logo dan total 8 MB.

### Pendaftaran tim lewat link event
1. Di `/admin`, buka pengaturan pendaftaran pada event dan buat link khusus. Salin link untuk dibagikan kepada calon peserta.
2. Peserta membuka link, mengisi nama tim, dan mengunggah logo PNG/JPG/WEBP (maksimal 1 MB). Pendaftaran menunggu persetujuan admin.
3. Admin dapat menyetujui pendaftaran untuk menambahkan tim ke daftar peserta, atau menolaknya. Pendaftaran yang ditolak langsung dihapus dan tidak ditampilkan lagi di panel.
4. Pendaftaran tim yang sudah disetujui dapat dihapus dari daftar peserta event melalui tombol **Hapus tim**. Jadwal pertandingan tetap tersimpan.
5. Gunakan tombol ekspor Excel untuk mengunduh daftar pendaftar yang masih menunggu, peserta yang disetujui, dan logo.
6. Link pendaftaran dapat dinonaktifkan atau diganti kapan saja; link lama langsung tidak berlaku. Impor peserta manual tetap tersedia dan menggantikan daftar peserta event.

## Sebelum dipublikasikan ke internet
- Wajib gunakan HTTPS dan set `NODE_ENV=production`.
- Wajib ganti `SESSION_SECRET` dari contoh dengan nilai acak yang kuat.
- Gunakan password unik; jangan commit file `.env` atau folder `data/` ke Git.
- Atur backup rutin untuk `data/ifl-events.sqlite`. Jalankan `npm run backup` untuk membuat salinan database di `data/backups/`; salin backup ke tempat lain yang aman juga.
- Gunakan hosting yang mendukung Node.js dan penyimpanan persisten. Hosting statis biasa tidak dapat menjalankan panel admin ini.
- Periksa kebijakan keamanan, backup, dan pemulihan sebelum menerima data penting.
- Untuk deployment multi-instance, gunakan session store/database terkelola yang sesuai.

## Catatan kontak
Nomor WhatsApp admin dapat diatur terpisah. Login ke `/admin`, pilih **Kontak & Profil**, isi nomor Admin 1 dan/atau Admin 2 dengan kode negara, misalnya `62812...` (tanpa tanda + atau spasi). Tombol untuk nomor yang kosong tidak ditampilkan. Tautan Instagram IFL Event dan Fafage Academy sudah terpasang.

## Struktur
```text
ifl-futsal-website/
├── server.js
├── package.json
├── .env.example
├── scripts/
│   ├── create-admin.js
│   └── backup-db.js
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── styles.css
│   ├── app.js
│   ├── admin.js
│   └── assets/
│       ├── ifl-event-logo.jpeg
│       └── fafage-academy-logo.jpeg
└── data/                 # dibuat otomatis, jangan commit
```

## Penting tentang keamanan dan data
- Jangan publikasikan versi HTML yang menyimpan password admin di JavaScript; gunakan server ini untuk panel admin.
- Gunakan hosting Node.js dengan HTTPS dan disk persisten. Jika hosting menghapus file lokal saat deploy, pindahkan SQLite ke volume persisten atau database terkelola.
- Jangan unggah `.env`, `data/`, atau backup database ke repositori publik.
- Backup di folder yang sama bukan perlindungan jika server/hosting hilang; unduh/salin backup secara rutin ke lokasi terpisah.

## Troubleshooting
- Jika `better-sqlite3` gagal terpasang, gunakan Node.js versi LTS terbaru yang didukung sistem operasi dan jalankan ulang `npm install`.
- Jika port 3000 dipakai aplikasi lain, ubah `PORT` pada `.env`.
- Jika tidak bisa login, jalankan `npm run init-admin` setelah memastikan kredensial pada `.env` benar.
- Jika data tidak muncul, periksa terminal server dan pastikan membuka website melalui `http://localhost:3000`, bukan dengan membuka file HTML langsung.


## Deploy ke Render (dengan SQLite persisten)

1. Unggah isi folder proyek ini ke root repositori GitHub (jangan unggah `.env`, `data/`, atau `node_modules/`).
2. Buat **Web Service** dari repositori tersebut di Render. Build command: `npm install`; Start command: `npm start`.
3. Tambahkan persistent disk dengan mount path `/var/data` (layanan web dan disk persisten Render berbayar).
4. Atur environment variables: `NODE_ENV=production`, `DATA_DIR=/var/data`, `SESSION_SECRET` (acak minimal 32 karakter), `ADMIN_USERNAME`, dan `ADMIN_PASSWORD` (unik, minimal 12 karakter).
5. Deploy, lalu buka URL publik yang disediakan Render. Website utama ada di `/` dan panel admin di `/admin`.

Aplikasi sudah mendukung `DATA_DIR` agar file SQLite dan sesi dapat disimpan di persistent disk. Jangan gunakan hosting statis saja karena aplikasi memerlukan server Node.js.

### Deploy Render gratis (tanpa disk persisten)

File `render.yaml` menyediakan konfigurasi Render gratis. Buat Blueprint dari repositori ini di Render dan isi `ADMIN_USERNAME` serta `ADMIN_PASSWORD` sebagai environment variable rahasia di Render (username bebas; password minimal 12 karakter). `SESSION_SECRET` dibuat otomatis oleh Render.

Setelah deploy selesai, gunakan URL layanan Render:
- Website: `https://<nama-layanan>.onrender.com/`
- Admin yang berfungsi: `https://<nama-layanan>.onrender.com/admin`

GitHub Pages hanya menyediakan versi statis; form admin di sana bukan login aktif. Paket Render gratis juga tidak menyediakan persistent disk untuk konfigurasi ini. Database SQLite dan sesi dapat hilang saat instance tidur, restart, atau deploy ulang. Jangan gunakan untuk data penting; untuk data yang harus bertahan, pindah ke paket/hosting dengan disk persisten atau database terkelola.
