# Backend Apps Script (auto-deploy)

Folder ini berisi kode backend Google Apps Script untuk website.
Setiap ada perubahan di folder `apps-script/` yang masuk ke branch `main`,
GitHub Actions otomatis menjalankan:

1. `clasp push -f` untuk mengirim kode ke project Apps Script.
2. `clasp deploy -i <DEPLOYMENT_ID>` untuk memperbarui deployment Web App yang sudah ada.

Karena deployment yang sama diperbarui, URL Web App tetap sama, jadi
`WEB_APP_URL` di `index.html` (baris sekitar 132) tidak perlu diubah.

Deployment ID yang dipakai sekarang diambil dari URL itu:
`AKfycbzHNzbiKrz7EcXrRau_7ifQZXApXLS2QcreGctpNSCW6h3ZrBIYwPAERQzr4J2mpXOU`.
Kalau suatu saat berubah, isi repository variable `DEPLOYMENT_ID`
(Settings > Secrets and variables > Actions > Variables).

## Setup sekali saja

### 1. Aktifkan Apps Script API
Buka https://script.google.com/home/usersettings lalu nyalakan **Google Apps Script API**.

### 2. Ambil Script ID
Buka project Apps Script backend, klik **Project Settings** (ikon roda gigi),
salin **Script ID**. Kirim Script ID ini ke Claude di thread, atau isi sendiri
di `apps-script/.clasp.json` menggantikan `GANTI_DENGAN_SCRIPT_ID`.
Script ID bukan rahasia, aman dikirim di chat.

### 3. Login clasp di komputer sendiri
Butuh Node.js. Jalankan di terminal:

```
npm install -g @google/clasp@2.4.2
clasp login
```

Browser akan terbuka, login dengan akun Google pemilik Apps Script.
Setelah berhasil, terbentuk file `~/.clasprc.json`
(Windows: `C:\Users\<nama>\.clasprc.json`).

### 4. Simpan token sebagai secret GitHub
Buka repo di GitHub > **Settings > Secrets and variables > Actions > New repository secret**.

- Name: `CLASPRC_JSON`
- Secret: tempel seluruh isi file `.clasprc.json`

**Jangan pernah kirim isi file ini di chat**, karena isinya kunci akses ke akun Google.

### 5. Izinkan Actions membuat pull request
**Settings > Actions > General > Workflow permissions**: centang
**Allow GitHub Actions to create and approve pull requests**.

### 6. Tarik kode backend yang sekarang ke repo
Tab **Actions** > **Tarik kode Apps Script ke repo** > **Run workflow**.
Workflow ini membuka pull request berisi kode backend dari editor Apps Script.
Setelah PR itu di-merge, kode backend resmi tersimpan di repo dan
Claude bisa mengubahnya langsung.

## Pengaman

Deploy otomatis menolak jalan kalau folder ini belum berisi file `.gs`/`.js`,
supaya `clasp push -f` tidak menghapus kode backend yang sedang aktif.

Setelah setup, jangan mengedit kode di editor Apps Script lagi.
Perubahan di sana akan tertimpa saat deploy berikutnya dari GitHub.
