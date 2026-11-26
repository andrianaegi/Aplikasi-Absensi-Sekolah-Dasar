# Absensi Kelas SD

Aplikasi web absensi siswa sekolah dasar. Guru mengisi kehadiran dari HP atau komputer, admin mengatur guru dan kelas, dan rekap bulanan bisa diunduh sebagai CSV. Bisa dipasang di layar utama HP seperti aplikasi.

## Fitur
- Login per pengguna. Peran **admin** (semua kelas, kelola pengguna dan kelas) dan **guru** (hanya kelas yang diberikan).
- Absensi harian: Hadir, Sakit, Izin, Alpa, plus keterangan. Tersimpan otomatis.
- Rekap bulanan per kelas dengan persentase kehadiran. Unduh sebagai file Excel (.xlsx) berwarna, siap cetak. Alamat CSV (`/api/rekap.csv`) tetap tersedia untuk keperluan lain.
- Data siswa: tambah, ubah, pindah kelas, hapus, dan import dari Excel (.xls atau .xlsx, juga CSV). Template resmi: `public/template-siswa.xls`, bisa diunduh dari menu Data Siswa.
- Tampilan cerah dan beranimasi (cincin kehadiran, angka berjalan, transisi). Animasi otomatis mati bila perangkat memilih "kurangi gerakan".
- Kata sandi disimpan dengan scrypt, sesi memakai cookie HttpOnly, percobaan login dibatasi.

## Kebutuhan
Node.js 22.13 atau lebih baru. Tidak ada paket tambahan (tanpa `npm install`). Database SQLite berupa satu file.

## Jalankan di komputer sendiri
```
node server.js
```
Buka http://localhost:3000. Pada kunjungan pertama, isi halaman Pengaturan awal untuk membuat akun admin. Setelah itu masuk dan tambahkan guru di menu Pengguna.

Uji otomatis: `npm test`

## Pasang agar bisa diakses dari mana saja
Aplikasi butuh server yang menjalankan Node.js dan **penyimpanan yang tidak hilang** untuk file database. Dua cara umum:

**A. Layanan hosting container (mis. Railway, Render, Fly.io)**
1. Unggah folder ini ke repositori Git, lalu hubungkan ke layanan. Layanan akan memakai `Dockerfile`.
2. Buat *volume* persisten dan pasang ke `/data`. Tanpa ini, data hilang setiap aplikasi dijalankan ulang.
3. Pastikan alamat memakai HTTPS (disediakan otomatis oleh layanan di atas).
4. Buka alamat aplikasi, selesaikan Pengaturan awal.

**B. VPS sendiri**
```
docker build -t absensi-sd .
docker run -d --name absensi -p 3000:3000 -v absensi-data:/data --restart unless-stopped absensi-sd
```
Letakkan di belakang Caddy atau Nginx untuk HTTPS (contoh Caddy: `absensi.sekolahanda.sch.id { reverse_proxy localhost:3000 }`).

## Variabel lingkungan
| Nama | Fungsi | Bawaan |
|---|---|---|
| `PORT` | Port server | 3000 |
| `DB_PATH` | Lokasi file database | `data/absensi.db` |
| `TRUST_PROXY` | `1` bila di belakang proxy HTTPS (membaca IP asli dan menandai cookie Secure) | `0` (Docker: `1`) |
| `COOKIE_SECURE` | `1` untuk memaksa cookie Secure | kosong |
| `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `SCHOOL_NAME` | Membuat admin awal otomatis, sebagai pengganti halaman Pengaturan awal | kosong |

## Cadangan data
Seluruh data ada di satu file `absensi.db` (mode WAL, jadi salin juga `absensi.db-wal` bila ada, atau hentikan aplikasi sebentar lalu salin). Salin file itu secara berkala ke tempat lain.

## Batasan saat ini
- Perubahan absensi butuh koneksi internet. Bila terputus, aplikasi mencoba menyimpan ulang saat tersambung, tetapi menutup halaman sebelum itu akan kehilangan perubahan terakhir.
- Pembatas percobaan login disimpan di memori, jadi terhapus saat server dijalankan ulang.
- Import membaca lembar pertama yang terlihat di file Excel. File .xls yang dilindungi kata sandi tidak bisa dibaca. NIS yang tersimpan sebagai angka di Excel kehilangan angka 0 di depannya; template sudah memformat kolom NIS sebagai teks.
- Belum ada lupa kata sandi lewat email. Admin mengatur ulang kata sandi guru di menu Pengguna.
- Belum ada riwayat perubahan atau log audit.

## Struktur
```
server.js        Server HTTP, rute statis, keamanan dasar
src/db.js        Skema SQLite
src/auth.js      Kata sandi, sesi, pembatas login
src/xlsx.js      Penulis file Excel untuk unduhan rekap
src/routes.js    Semua endpoint API
public/          Tampilan (HTML, CSS, JS), pembaca Excel (xls.js), template-siswa.xls, manifest, service worker
test/            Uji otomatis API
```
