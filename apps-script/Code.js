/**
 * ============================================================================
 * BACKEND API — AQUASCIENCE REVIEW FPIK UNPAD × TORGAS BLUE ENERGY
 * Google Drive + Google Sheets + Gmail Automation
 * ============================================================================
 */

// 1. ISI DENGAN ID DARI LANGKAH 1 & LANGKAH 2
const PARENT_FOLDER_ID = "1TssDethDJ43FFY3ftI1y-PuYXnQQig9g";
const SPREADSHEET_ID   = "1CNlEzqUcRUNjzsEKmAlXCw-HKLpoEVvoMF2dWVHXHFg";

// 2. EMAIL PENERIMA NOTIFIKASI SISTEM (TIDAK MENGIRIM KE fpik@unpad.ac.id)
const EMAIL_TORGAS     = "torgasblueenergy@gmail.com";

const SHEET_MANUSCRIPTS = "Manuscripts";
const SHEET_ACCOUNTS    = "Accounts";

/**
 * Helper: Membuat JSON Response standar untuk Frontend
 */
function createJsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper: Mengambil atau membuat folder bulan otomatis di Google Drive
 */
function getOrCreateMonthFolder_(monthName) {
  const parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
  const folders = parentFolder.getFoldersByName(monthName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(monthName);
}

/**
 * Helper: Mengambil daftar akun dari tab Accounts (Hanya berjalan di server)
 */
function getAccountsList_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ACCOUNTS);
  const data = sheet.getDataRange().getValues();
  const accounts = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[3]) continue; // Lewati jika email kosong
    accounts.push({
      slot: Number(row[0]) || i,
      role: String(row[1]).trim().toLowerCase(), // 'admin' atau 'reviewer'
      name: String(row[2]).trim(),
      email: String(row[3]).trim(),
      pin: String(row[4]).trim(),
      specialty: String(row[5]).trim(),
      expertise: String(row[6]).trim()
    });
  }
  return accounts;
}

/**
 * Helper: Mengubah baris Google Sheets menjadi objek manuskrip
 * includeSensitive = false untuk publik (Tracker), true untuk Reviewer/Admin
 */
function mapRowToManuscript_(row, includeSensitive) {
  let journals = [];
  if (row[18]) {
    try {
      journals = JSON.parse(row[18]);
    } catch (e) {
      journals = [];
    }
  }

  const baseData = {
    id: String(row[0] || ""),
    date: String(row[1] || ""),
    monthFolder: String(row[2] || ""),
    authorName: String(row[3] || ""),
    domain: String(row[6] || ""),
    studyField: String(row[7] || ""),
    status: String(row[12] || "Dalam Antrean"),
    progressStep: Number(row[13]) || 2,
    reviewerName: String(row[14] || "Menunggu Penugasan Reviewer"),
    reviewNotes: String(row[17] || ""),
    recommendedJournals: journals
  };

  if (includeSensitive) {
    baseData.authorEmail = String(row[4] || "");
    baseData.affiliation = String(row[5] || "");
    baseData.title = String(row[8] || "");
    baseData.originalFileName = String(row[9] || "");
    baseData.originalFileId = String(row[10] || "");
    baseData.originalFileUrl = String(row[11] || "");
    baseData.revisedFileName = String(row[15] || "");
    baseData.revisedFileUrl = String(row[16] || "");
  }

  return baseData;
}

/**
 * ============================================================================
 * ENDPOINT GET: Mengambil Data Antrean Publik untuk Halaman Beranda & Tracker
 * (Data sensitif seperti judul naskah, email penulis, & link PDF tidak dikirim)
 * ============================================================================
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_MANUSCRIPTS);
    const data = sheet.getDataRange().getValues();
    const publicList = [];

    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      publicList.push(mapRowToManuscript_(data[i], false));
    }

    return createJsonResponse_({
      success: true,
      manuscripts: publicList
    });
  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: "Gagal memuat data antrean: " + err.toString()
    });
  }
}

/**
 * ============================================================================
 * ENDPOINT POST: Menangani Submit Manuskrip, Login, Mulai Review, & Kirim Hasil
 * ============================================================================
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    // ------------------------------------------------------------------------
    // AKSI 1: PENULIS MENGUNGGAH MANUSKRIP BARU (PUBLIK)
    // ------------------------------------------------------------------------
    if (action === "submit") {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_MANUSCRIPTS);
      const existingData = sheet.getDataRange().getValues();

      // Buat kode pelacakan berurutan (AQM-2026-1101, 1102, dst.)
      const totalExisting = Math.max(0, existingData.length - 1);
      const nextNum = 1101 + totalExisting;
      const yearStr = new Date().getFullYear();
      const trackingId = `AQM-${yearStr}-${nextNum}`;

      // Hitung posisi antrean aktif saat ini
      let activeQueueCount = 0;
      for (let i = 1; i < existingData.length; i++) {
        if (existingData[i][0] && String(existingData[i][12]) !== "Selesai") {
          activeQueueCount++;
        }
      }
      const queueNumber = activeQueueCount + 1;

      // Simpan file PDF asli ke folder bulan aktif di Google Drive
      const monthFolderName = payload.monthFolder || "November 2026";
      const targetFolder = getOrCreateMonthFolder_(monthFolderName);
      const decodedBytes = Utilities.base64Decode(payload.fileBase64);
      const cleanFileName = `[${trackingId}]_ASLI_${payload.originalFileName}`;
      const pdfBlob = Utilities.newBlob(decodedBytes, "application/pdf", cleanFileName);
      const savedFile = targetFolder.createFile(pdfBlob);

      // Izinkan unduh via link khusus yang hanya diberikan kepada reviewer terautentikasi
      savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const fileId = savedFile.getId();
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

      const dateStr = payload.date || Utilities.formatDate(new Date(), "Asia/Jakarta", "dd MMM yyyy");
      const affiliation = payload.affiliation || "Peneliti Independen";

      // Simpan baris baru ke tab Manuscripts
      sheet.appendRow([
        trackingId,                         // A: ID_Tracking
        dateStr,                            // B: Tanggal_Submit
        monthFolderName,                    // C: Bulan_Folder
        payload.authorName,                 // D: Nama_Penulis
        payload.authorEmail,                // E: Email_Penulis
        affiliation,                        // F: Afiliasi
        payload.domain,                     // G: Jurusan
        payload.studyField,                 // H: Bidang_Kajian
        payload.title,                      // I: Judul_Naskah
        payload.originalFileName,           // J: Nama_File_Asli
        fileId,                             // K: File_ID_Asli
        downloadUrl,                        // L: Link_PDF_Asli
        "Dalam Antrean",                    // M: Status
        2,                                  // N: Progress_Step
        "Menunggu Penugasan Reviewer",      // O: Nama_Reviewer
        "",                                 // P: Nama_File_Revisi
        "",                                 // Q: Link_PDF_Revisi
        "",                                 // R: Catatan_Reviewer
        "[]"                                // S: Rekomendasi_Jurnal_JSON
      ]);

      // 1) KIRIM EMAIL TANDA TERIMA KE PENULIS
      const authorSubject = `[AQUASCIENCE REVIEW] Tanda Terima Manuskrip — Kode Pelacakan: ${trackingId}`;
      const authorBody =
        `Yth. ${payload.authorName},\n\n` +
        `Terima kasih telah mengajukan manuskrip ilmiah Anda ke layanan AQUASCIENCE REVIEW FPIK UNPAD.\n\n` +
        `Detail Pengajuan Anda:\n` +
        `- Kode Pelacakan : ${trackingId}\n` +
        `- Urutan Antrean : #${queueNumber}\n` +
        `- Jurusan / Kajian: ${payload.domain} — ${payload.studyField}\n` +
        `- Judul Manuskrip : ${payload.title}\n` +
        `- Nama File PDF   : ${payload.originalFileName}\n\n` +
        `Anda dapat memantau progres penelaahan secara berkala melalui menu Tracker di website dengan menggunakan kode pelacakan di atas.\n\n` +
        `Salam hormat,\n` +
        `Tim AQUASCIENCE REVIEW FPIK UNPAD\n` +
        `Powered by Torgas Blue Energy`;

      MailApp.sendEmail({
        to: payload.authorEmail,
        subject: authorSubject,
        body: authorBody
      });

      // 2) KIRIM EMAIL NOTIFIKASI NASKAH BARU KE:
      //    - Torgas Blue Energy (torgasblueenergy@gmail.com)
      //    - Admin Besar (Role = admin)
      //    - Pakar Bidang Kajian Terkait (Bidang_Kajian cocok dengan payload.studyField)
      const allAccounts = getAccountsList_();
      const recipientSet = {};
      recipientSet[EMAIL_TORGAS.toLowerCase()] = EMAIL_TORGAS;

      allAccounts.forEach((acc) => {
        const isSuperAdmin = acc.role === "admin";
        const isMatchingExpert =
          acc.role === "reviewer" &&
          acc.specialty.toLowerCase() === String(payload.domain).toLowerCase() &&
          acc.expertise.toLowerCase() === String(payload.studyField).toLowerCase();

        if (isSuperAdmin || isMatchingExpert) {
          recipientSet[acc.email.toLowerCase()] = acc.email;
        }
      });

      const internalRecipients = Object.values(recipientSet).join(",");
      if (internalRecipients) {
        const internalSubject = `[NASKAH BARU] ${trackingId} | ${payload.domain} — ${payload.studyField}`;
        const internalBody =
          `Halo Tim Reviewer & Admin AQUASCIENCE REVIEW,\n\n` +
          `Terdapat pengajuan manuskrip baru yang masuk ke sistem antrean:\n\n` +
          `- Kode Pelacakan : ${trackingId} (Antrean #${queueNumber})\n` +
          `- Jurusan         : ${payload.domain}\n` +
          `- Bidang Kajian   : ${payload.studyField}\n` +
          `- Nama Penulis    : ${payload.authorName} (${affiliation})\n` +
          `- Judul Manuskrip : ${payload.title}\n` +
          `- Folder Arsip    : ${monthFolderName}\n\n` +
          `Silakan login ke Portal Reviewer pada website AQUASCIENCE REVIEW untuk mengunduh dokumen PDF dan melakukan penelaahan.\n\n` +
          `Sistem Otomatis AQUASCIENCE REVIEW FPIK UNPAD`;

        MailApp.sendEmail({
          to: internalRecipients,
          subject: internalSubject,
          body: internalBody
        });
      }

      return createJsonResponse_({
        success: true,
        queueNumber: queueNumber,
        manuscript: {
          id: trackingId,
          date: dateStr,
          monthFolder: monthFolderName,
          authorName: payload.authorName,
          authorEmail: payload.authorEmail,
          affiliation: affiliation,
          domain: payload.domain,
          studyField: payload.studyField,
          title: payload.title,
          originalFileName: payload.originalFileName,
          status: "Dalam Antrean",
          progressStep: 2,
          reviewerName: "Menunggu Penugasan Reviewer",
          revisedFileName: "",
          reviewNotes: "",
          recommendedJournals: []
        }
      });
    }

    // ------------------------------------------------------------------------
    // AKSI 2: LOGIN ADMIN BESAR / REVIEWER BIDANG (VALIDASI SERVER-SIDE)
    // ------------------------------------------------------------------------
    if (action === "login") {
      const inputEmail = String(payload.email || "").trim().toLowerCase();
      const inputPin = String(payload.pin || "").trim();

      const accounts = getAccountsList_();
      const matched = accounts.find(
        (acc) => acc.email.toLowerCase() === inputEmail && acc.pin === inputPin
      );

      if (!matched) {
        return createJsonResponse_({
          success: false,
          message: "Akses ditolak. Email atau PIN tidak terdaftar dalam daftar akun resmi."
        });
      }

      // Ambil daftar manuskrip lengkap sesuai hak akses akun
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_MANUSCRIPTS);
      const data = sheet.getDataRange().getValues();
      const allowedManuscripts = [];

      for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        const m = mapRowToManuscript_(data[i], true);

        if (matched.role === "admin") {
          allowedManuscripts.push(m);
        } else if (
          m.domain.toLowerCase() === matched.specialty.toLowerCase() &&
          m.studyField.toLowerCase() === matched.expertise.toLowerCase()
        ) {
          allowedManuscripts.push(m);
        }
      }

      // Hapus PIN sebelum mengirim objek profil ke browser
      const safeProfile = {
        slot: matched.slot,
        role: matched.role,
        roleLabel: matched.role === "admin" ? "Admin Besar" : "Reviewer Bidang",
        name: matched.name,
        email: matched.email,
        specialty: matched.specialty,
        expertise: matched.expertise
      };

      return createJsonResponse_({
        success: true,
        reviewer: safeProfile,
        manuscripts: allowedManuscripts
      });
    }

    // ------------------------------------------------------------------------
    // AKSI 3: TANDAI NASKAH SEDANG DIREVIEW (PROGRESS STEP 3)
    // ------------------------------------------------------------------------
    if (action === "startReview") {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_MANUSCRIPTS);
      const data = sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          const currentStatus = String(data[i][12]);
          if (currentStatus === "Dalam Antrean") {
            const rowNum = i + 1;
            sheet.getRange(rowNum, 13).setValue("Sedang Direview");
            sheet.getRange(rowNum, 14).setValue(3);
            sheet.getRange(rowNum, 15).setValue(payload.reviewerName);
          }
          break;
        }
      }

      return createJsonResponse_({ success: true });
    }

    // ------------------------------------------------------------------------
    // AKSI 4: REVIEWER MENGIRIM HASIL KOREKSI & REKOMENDASI JURNAL
    // - Skema 1: Kirim ke PENULIS berisi file PDF hasil revisi + daftar jurnal
    // - Skema 2: Kirim ke ADMIN BESAR & TORGAS berupa notifikasi laporan saja
    // ------------------------------------------------------------------------
    if (action === "completeReview") {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_MANUSCRIPTS);
      const data = sheet.getDataRange().getValues();

      let targetRowNum = -1;
      let rowData = null;

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.id)) {
          targetRowNum = i + 1;
          rowData = data[i];
          break;
        }
      }

      if (targetRowNum === -1) {
        return createJsonResponse_({
          success: false,
          message: "Kode manuskrip tidak ditemukan di database."
        });
      }

      const trackingId = String(rowData[0]);
      const monthFolderName = String(rowData[2] || "November 2026");
      const authorName = String(rowData[3]);
      const authorEmail = String(rowData[4]);
      const domain = String(rowData[6]);
      const studyField = String(rowData[7]);
      const manuscriptTitle = String(rowData[8]);
      const reviewerName = String(payload.reviewerName || "Tim Reviewer FPIK Unpad");
      const reviewNotes = String(payload.reviewNotes || "Naskah telah dikoreksi sesuai kaidah penulisan ilmiah. Silakan periksa catatan langsung pada file PDF terlampir.");
      const journals = Array.isArray(payload.recommendedJournals) ? payload.recommendedJournals : [];

      // Simpan file PDF hasil revisi ke folder bulan di Google Drive
      let revisedBlob = null;
      let revisedFileName = payload.revisedFileName || `REVISED_${trackingId}.pdf`;
      let revisedDownloadUrl = "";

      if (payload.revisedFileBase64) {
        const targetFolder = getOrCreateMonthFolder_(monthFolderName);
        const decodedBytes = Utilities.base64Decode(payload.revisedFileBase64);
        const driveRevisedName = `[${trackingId}]_REVISI_${revisedFileName}`;
        revisedBlob = Utilities.newBlob(decodedBytes, "application/pdf", driveRevisedName);
        const savedRevised = targetFolder.createFile(revisedBlob);
        savedRevised.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        revisedDownloadUrl = `https://drive.google.com/uc?export=download&id=${savedRevised.getId()}`;
        revisedFileName = driveRevisedName;
      }

      // Perbarui baris di Google Sheets
      sheet.getRange(targetRowNum, 13).setValue("Selesai");
      sheet.getRange(targetRowNum, 14).setValue(4);
      sheet.getRange(targetRowNum, 15).setValue(reviewerName);
      sheet.getRange(targetRowNum, 16).setValue(revisedFileName);
      sheet.getRange(targetRowNum, 17).setValue(revisedDownloadUrl);
      sheet.getRange(targetRowNum, 18).setValue(reviewNotes);
      sheet.getRange(targetRowNum, 19).setValue(JSON.stringify(journals));

      // Format daftar rekomendasi jurnal untuk isi email
      let journalTextList = "";
      if (journals.length === 0) {
        journalTextList = "- (Tidak ada daftar jurnal tambahan yang dicantumkan)\n";
      } else {
        journals.forEach((j, idx) => {
          journalTextList +=
            `${idx + 1}. ${j.name} (${j.index})\n` +
            `   Website : ${j.url}\n` +
            `   Catatan : ${j.reason || "-"}\n\n`;
        });
      }

      // ----------------------------------------------------------------------
      // SKEMA 1: EMAIL KE PENULIS (FILE PDF HASIL REVISI + REKOMENDASI JURNAL)
      // ----------------------------------------------------------------------
      const authorSubject = `[HASIL REVIEW] ${trackingId} — Koreksi Manuskrip & Rekomendasi Jurnal`;
      const authorBody =
        `Yth. ${authorName},\n\n` +
        `Proses penelaahan manuskrip Anda pada AQUASCIENCE REVIEW FPIK UNPAD telah selesai dilakukan.\n\n` +
        `Detail Manuskrip:\n` +
        `- Kode Pelacakan : ${trackingId}\n` +
        `- Bidang Kajian   : ${domain} — ${studyField}\n` +
        `- Judul Manuskrip : ${manuscriptTitle}\n` +
        `- Reviewer        : ${reviewerName}\n\n` +
        `CATATAN RINGKAS REVIEWER:\n` +
        `${reviewNotes}\n\n` +
        `DAFTAR REKOMENDASI JURNAL TUJUAN:\n` +
        `${journalTextList}` +
        `File PDF manuskrip yang telah dikoreksi terlampir langsung pada email ini. Silakan perbaiki naskah sesuai masukan reviewer dan ajukan ke salah satu jurnal rekomendasi di atas.\n\n` +
        `Salam hormat,\n` +
        `Tim AQUASCIENCE REVIEW FPIK UNPAD\n` +
        `Powered by Torgas Blue Energy`;

      const mailOptions = {
        to: authorEmail,
        subject: authorSubject,
        body: authorBody
      };
      if (revisedBlob) {
        mailOptions.attachments = [revisedBlob];
      }
      MailApp.sendEmail(mailOptions);

      // ----------------------------------------------------------------------
      // SKEMA 2: EMAIL KE ADMIN BESAR & TORGAS BLUE ENERGY (NOTIFIKASI SAJA)
      // ----------------------------------------------------------------------
      const allAccounts = getAccountsList_();
      const reportRecipientSet = {};
      reportRecipientSet[EMAIL_TORGAS.toLowerCase()] = EMAIL_TORGAS;

      allAccounts.forEach((acc) => {
        if (acc.role === "admin") {
          reportRecipientSet[acc.email.toLowerCase()] = acc.email;
        }
      });

      const reportRecipients = Object.values(reportRecipientSet).join(",");
      if (reportRecipients) {
        const journalSummaryOnly = journals.length > 0
          ? journals.map((j, i) => `${i + 1}. ${j.name} (${j.index}) - ${j.url}`).join("\n")
          : "- Tidak ada rekomendasi jurnal dicantumkan";

        const reportSubject = `[SELESAI REVIEW] ${trackingId} Telah Dikirim Kembali ke Penulis`;
        const reportBody =
          `Yth. Ketua Tim Reviewer,\n\n` +
          `Diinformasikan bahwa manuskrip berikut telah selesai direview dan hasil koreksinya sudah dikirimkan kembali ke email penulis:\n\n` +
          `- Kode Pelacakan : ${trackingId}\n` +
          `- Nama Penulis    : ${authorName} (${authorEmail})\n` +
          `- Bidang Kajian   : ${domain} — ${studyField}\n` +
          `- Judul Manuskrip : ${manuscriptTitle}\n` +
          `- Ditelaah Oleh   : ${reviewerName}\n\n` +
          `Daftar Jurnal yang Direkomendasikan kepada Penulis:\n` +
          `${journalSummaryOnly}\n\n` +
          `Notifikasi Otomatis Sistem AQUASCIENCE REVIEW FPIK UNPAD`;

        MailApp.sendEmail({
          to: reportRecipients,
          subject: reportSubject,
          body: reportBody
        });
      }

      return createJsonResponse_({
        success: true,
        revisedFileName: revisedFileName,
        revisedFileUrl: revisedDownloadUrl
      });
    }

    return createJsonResponse_({
      success: false,
      message: "Aksi tidak dikenali oleh server."
    });

  } catch (err) {
    return createJsonResponse_({
      success: false,
      message: "Terjadi kesalahan pada server: " + err.toString()
    });
  } finally {
    lock.releaseLock();
  }
}