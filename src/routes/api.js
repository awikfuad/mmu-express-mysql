import express from 'express';
import { loginAdmin, loginStudent, loginTeacher, loginUnified, registerTeacher, registerAdmin, getAdmins, updateAdmin, deleteAdmin, updateTeacher, deleteTeacher, getTeachers, handleRefreshToken, logout, changePassword, resetStudentPassword, loginGoogle, linkGoogle, unlinkGoogle, getGoogleAuthStatus, linkTeacherGoogle, unlinkTeacherGoogle, registerGoogle, getRegistrations, approveRegistration, rejectRegistration, deleteRegistration, getMyIdentities, linkParentAccount, unlinkParentAccount, switchToParent } from '../controllers/authController.js';
import { createPayment, getStudentHistory, gettransactions, getKwitansi } from '../controllers/paymentController.js';
import { getStudents, addStudent, editStudent, removeStudent, updateStatus, } from '../controllers/studentController.js';
import { logAttendance, getClassAttendance, getTeacherHistory, getStudentKbmHistory } from '../controllers/attendanceController.js';
import { addActivity, logActivityAttendance, getActivities, getActivityReport } from '../controllers/activityController.js';
import { buatKegiatan, getKegiatan, editKegiatan, removeKegiatan, logKegiatan, logKegiatanAttendance, logKegiatanTeacherAttendance, getKegiatanReport, getKegiatanTeacherReport, getTeacherAttendanceHistory, getStudentKegiatanHistory, getKegiatanExportReport } from '../controllers/kegiatanController.js';
import { getClassrooms, addClassroom, editClassroom, removeClassroom, getClassroomFilterOptions } from '../controllers/classroomController.js';
import { handleTransaction, getSavingsDashboard, getSavingstransactions, getSavingsKwitansi } from '../controllers/savingsController.js';
import { getMonthlyFinanceReport } from '../controllers/reportController.js';
import { getActiveAcademicYear, listAcademicYears, getFilterMasterData } from '../controllers/academicController.js'
import { getClosingPreview, closeYear, getClosingReport, getClosingHistory } from '../controllers/yearClosingController.js'
import { getMyScheduleToday, getMyScheduleWeekly, getAllWeekSchedules, assignSubstitute, claimPiket, createSchedule, updateSchedule, getSchedules, getAllTodaySchedules, getScheduleConflicts } from '../controllers/scheduleController.js';
import { getMuridKelas, getMuridKelasByNim, addMuridKelas, editMuridKelas, updateStatusMuridKelas, getMuridPerempuan } from '../controllers/muridKelasController.js';
import { previewSantriSync, commitSantriSync } from '../controllers/santriSyncController.js';
import { getAllSiswiHaid, getSiswiHaidById, addSiswiHaid, editSiswiHaid, removeSiswiHaid } from '../controllers/siswiHaidController.js';
import { getDashboardStats } from '../controllers/dashboardController.js';
import { geofenceGuard } from '../middlewares/geofenceMiddleware.js';
import { getStudentMe, getStudentMePayments, getStudentMeSavings, payFromSavings, getStudentMeKbm, getStudentMeKegiatan, getStudentMeNilaiHarian, getStudentMePerilaku, getStudentMePrestasi, getStudentMeJadwal, getStudentMeKalender, getStudentMeUjian } from '../controllers/studentPortalController.js';
import { getPaymentSettings, upsertPaymentSetting, deletePaymentSetting } from '../controllers/paymentSettingController.js';
import { getNilaiHarian, saveNilaiHarianBulk, deleteNilaiHarian, getPerilakuMurid, savePerilakuMuridBulk, updatePerilakuMurid, deletePerilakuMurid } from '../controllers/penilaianController.js';
import { getPrestasiPelanggaran, createPrestasiPelanggaran, updatePrestasiPelanggaran, deletePrestasiPelanggaran } from '../controllers/prestasiController.js';
import { getInventaris, createInventaris, updateInventaris, deleteInventaris } from '../controllers/inventarisController.js';
import { getArsipSoalan, createArsipSoalan, updateArsipSoalan, deleteArsipSoalan } from '../controllers/arsipSoalanController.js';
import { getWali, createWali, updateWali, deleteWali } from '../controllers/waliController.js';
import { getRekapAbsensi } from '../controllers/rekapAbsensiController.js';
import { getTunggakanIuran } from '../controllers/tunggakanIuranController.js';
import { getRekapLaporan } from '../controllers/rekapLaporanController.js';
import { getAnalytics } from '../controllers/analyticsController.js';
import { getIzinSakit, createIzinSakit, updateIzinSakit, deleteIzinSakit } from '../controllers/izinSakitController.js';
import { getIzinGuru, getIzinGuruDetail, createIzinGuru, updateIzinGuru, deleteIzinGuru, getAffectedSchedules, assignSubstitute as assignIzinPengganti, finishIzinGuru } from '../controllers/izinGuruController.js';
import { getKalender, createKalender, updateKalender, deleteKalender, getTahunHijriyah, getKalenderGrid } from '../controllers/kalenderController.js';
import { getPengumuman, getPublishedPengumuman, createPengumuman, updatePengumuman, publishPengumuman, deletePengumuman } from '../controllers/pengumumanController.js';
import { importTemplate, previewImport, commitImport } from '../controllers/importController.js';
import { getAccounts, createAccount, updateAccount, deleteAccount, getKasTransactions, createKasTransaction, deleteKasTransaction, getKasReport } from '../controllers/kasController.js';
import { getAllAcademicYears, createAcademicYear, updateAcademicYear, activateAcademicYear, deleteAcademicYear, getAllJenjang, createJenjang, updateJenjang, deleteJenjang, getAllRombel, createRombel, updateRombel, deleteRombel, getAllSubjects, createSubject, updateSubject, deleteSubject } from '../controllers/masterController.js';
import { getAuditLogs } from '../controllers/auditController.js';
import { getBackups, createBackup, restoreBackup, deleteBackup, getBackupConfig, downloadBackup, uploadRestore } from '../controllers/backupController.js';
import { getSekolahSettings, updateSekolahSettings } from '../controllers/sekolahController.js';
import { getSalaryTariffs, upsertSalaryTariff, deleteSalaryTariff, getSalaryTeachers, computeSalarySlip, getSalarySlips, saveSalarySlip, updateSalarySlip, deleteSalarySlip, getMySalarySlips } from '../controllers/salaryController.js';
import { getParentMe, getParentChildren, getParentChildProfile, getParentChildKbm, getParentChildKegiatan, getParentChildNilai, getParentChildPerilaku, getParentChildPrestasi, getParentChildJadwal, getParentChildPembayaran, getParentChildTabungan, payChildFromSavings, getParentChildIzinSakit, submitChildIzinSakit, submitPaymentRequest, getParentChildPaymentRequests, getPaymentRequests, approvePaymentRequest, rejectPaymentRequest, getParents, createParent, updateParent, deleteParent, addChildLink, removeChildLink, previewFamilyByKK, linkFamilyByKK } from '../controllers/parentController.js';
import { importJadwalTemplate, previewImportJadwal, commitImportJadwal } from '../controllers/importJadwalController.js';
import { loginParent } from '../controllers/authController.js';
import { getPublicDaily, resolveLembagaGoogle } from '../controllers/publicDashboardController.js';
import { exportKalenderIcs, feedKalenderIcs, getKalenderGoogleStatus, setKalenderFeedKey, setKalenderGoogleUrl, importKalenderGoogle } from '../controllers/kalenderGoogleController.js';
import { getPimpinan, createPimpinan, updatePimpinan, deletePimpinan, getPiketPimpinan, assignPiketPimpinan, removePiketPimpinan, getPresensiPimpinan, savePresensiPimpinan, getPresensiPimpinanHistory } from '../controllers/pimpinanController.js';
import { getPiketGuru, savePiketGuruSlot, deletePiketGuruRow } from '../controllers/piketGuruController.js';
import { getTeacherKbmRoster, saveTeacherKbmAttendance, getTeacherKbmHistory } from '../controllers/teacherKbmAttendanceController.js';
import { getLembagas, createLembaga, updateLembaga, removeLembaga, getPublicLembagas } from '../controllers/lembagaController.js';
import { getBankSoal, createBankSoal, updateBankSoal, deleteBankSoal, downloadBankSoalTemplate, previewImportBankSoal, commitImportBankSoal, getUjian, getUjianDetail, createUjian, updateUjian, deleteUjian, setUjianSoal, getUjianPeserta, addUjianPeserta, removeUjianPeserta, gradeUjianPeserta, startUjian, submitUjian, saveUjian } from '../controllers/ujianController.js';
import { getKelulusan, getKelulusanRoster, createKelulusan, updateKelulusan, deleteKelulusan, getAlumni, updateAlumni, deleteAlumni } from '../controllers/kelulusanController.js';
import { getNotulen, getNotulenDetail, createNotulen, updateNotulen, setNotulenStatus, deleteNotulen, savePeserta, createPembahasan, updatePembahasan, deletePembahasan, createTindakLanjut, updateTindakLanjut, deleteTindakLanjut, getTindakLanjut, createLampiran, deleteLampiran } from '../controllers/notulenController.js';
import { getModulSettings, updateModulSetting, getActiveModuls } from '../controllers/modulSettingController.js';
import { getKatalog, getBukuOptions, createKatalog, updateKatalog, deleteKatalog, getSirkulasi, createSirkulasi, updateSirkulasi, kembalikan, deleteSirkulasi, getDenda, bayarDenda, getPerpusSettings, updatePerpusSettings } from '../controllers/perpustakaanController.js';

import { verifyToken } from '../middlewares/authMiddleware.js';
import { authorizeRoles, authorizeAdminOrPimpinan } from '../middlewares/roleMiddleware.js';
import { validateBody } from '../middlewares/validationMiddleware.js';
import { auditTrailMiddleware } from '../middlewares/auditTrailMiddleware.js';
import upload, { uploadExcel, uploadBackup, uploadIcs, uploadPdf } from '../config/upload.js';
import db from '../config/db.js';

const router = express.Router();
// =========================================================================
// 🔓 GERBANG UMUM (Bebas Akses / Tanpa Token)
// =========================================================================
router.get('/health', (req, res) => res.json({ status: 'online', message: 'Backend Node.js siap!' }));
router.post('/auth/login-admin', validateBody(['username', 'password']), loginAdmin);
router.post('/auth/login-student', validateBody(['nim', 'password']), loginStudent);
router.post('/auth/login-parent', validateBody(['phone', 'password']), loginParent);
router.post('/auth/login-teacher', validateBody(['username', 'password']), loginTeacher);
router.post('/auth/login', validateBody(['username', 'password']), loginUnified);
router.post('/auth/refresh-token', validateBody(['refreshToken']), handleRefreshToken);
router.post('/auth/logout', logout);
router.post('/auth/change-password', verifyToken, validateBody(['currentPassword', 'newPassword']), changePassword);
// Google Sign-In (v3.26) — login publik memakai idToken Google; tautan/putus tautan wajib login password dulu
router.post('/auth/google', validateBody(['idToken']), loginGoogle);
router.post('/auth/register-google', validateBody(['idToken']), registerGoogle);
router.post('/auth/link-google', verifyToken, authorizeRoles('admin', 'teacher', 'parent'), validateBody(['idToken']), linkGoogle);
router.delete('/auth/link-google', verifyToken, authorizeRoles('admin', 'teacher', 'parent'), unlinkGoogle);
router.get('/auth/google/status', verifyToken, authorizeRoles('admin', 'teacher', 'parent'), getGoogleAuthStatus);

// Portal Wali (v3.40) — guru/pimpinan yang juga orang tua
router.get('/auth/me/identities', verifyToken, authorizeRoles('admin', 'teacher'), getMyIdentities);
router.post('/auth/me/parent-link', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['phone']), linkParentAccount);
router.delete('/auth/me/parent-link', verifyToken, authorizeRoles('admin', 'teacher'), unlinkParentAccount);
router.post('/auth/switch-parent', verifyToken, authorizeRoles('admin', 'teacher'), switchToParent);

// Master Akademik Aktif & Ruang Kelas (Dipakai saat login atau register)
router.get('/academic-years/active', getActiveAcademicYear);
router.get('/academic-years', verifyToken, listAcademicYears);
router.get('/classrooms/filter-options', getClassroomFilterOptions);
router.get('/classrooms', getClassrooms);

// Dashboard Harian Publik (kiosk pre-login) — tanpa token
router.get('/public/daily', getPublicDaily);
// Resolve lembaga kiosk dari akun Google (v3.36) — tanpa token; menentukan lembaga utk kiosk
router.post('/public/resolve-lembaga', (req, res, next) => {
    if (!req.body || typeof req.body.idToken !== 'string' || !req.body.idToken) {
        return res.status(400).json({ success: false, message: 'idToken wajib dikirim' });
    }
    next();
}, resolveLembagaGoogle);
// Daftar master lembaga utk dropdown kiosk (tanpa token — publik, field aman saja)
router.get('/public/lembaga', getPublicLembagas);

// Bank Soal & Ujian / CBT — pelaksanaan ujian online (publik, digate kode akses + NIM peserta)
router.post('/public/ujian/start', validateBody(['ujian_id', 'kode', 'nim', 'name']), startUjian);
router.post('/public/ujian/submit', validateBody(['ujian_id', 'kode', 'nim', 'jawaban']), submitUjian);
router.post('/public/ujian/save', validateBody(['ujian_id', 'kode', 'nim', 'jawaban']), saveUjian);

// Feed langganan kalender pendidikan ke Google Calendar (.ics, gated by ?key=) — tanpa token
router.get('/kalender/feed.ics', feedKalenderIcs);


// =========================================================================
// 🔒 GERBANG TERPROTEKSI (Wajib Login via verifyToken)
// =========================================================================

// 🛡️ AUDIT TRAIL: catat semua aksi tulis (POST/PUT/DELETE) yang berhasil
// req.user sudah terisi saat res 'finish' → log dibikin oleh middleware ini.
router.use(auditTrailMiddleware);

// --- 👤 MANAJEMEN GURU / GURU PIKET — foto optional minimal
router.post('/register-teacher', verifyToken, authorizeRoles('admin'), upload.single('foto'), validateBody(['username', 'name', 'password']), registerTeacher);
router.post('/register-admin', verifyToken, authorizeRoles('admin'), upload.single('foto'), validateBody(['username', 'name', 'password']), registerAdmin);
router.get('/admins', verifyToken, authorizeRoles('admin'), getAdmins);
router.put('/admins/:id', verifyToken, authorizeRoles('admin'), upload.single('foto'), updateAdmin);
router.delete('/admins/:id', verifyToken, authorizeRoles('admin'), deleteAdmin);
router.get('/teachers', verifyToken, authorizeRoles('admin'), getTeachers);
router.put('/teachers/:id', verifyToken, authorizeRoles('admin'), upload.single('foto'), updateTeacher);
router.delete('/teachers/:id', verifyToken, authorizeRoles('admin'), deleteTeacher);
// Google Sign-In: admin menautkan/memutuskan akun Google milik guru (v3.27)
router.put('/teachers/:id/google', verifyToken, authorizeRoles('admin'), validateBody(['idToken']), linkTeacherGoogle);
router.delete('/teachers/:id/google', verifyToken, authorizeRoles('admin'), unlinkTeacherGoogle);
router.get('/schedules/my-today', verifyToken, authorizeRoles('teacher'), getMyScheduleToday);
router.get('/today', verifyToken, authorizeRoles('admin', 'teacher'), getMyScheduleToday);
router.get('/schedules/today-all', verifyToken, authorizeRoles('admin'), getAllTodaySchedules);
router.get('/my-week', verifyToken, authorizeRoles('teacher'), getMyScheduleWeekly);
router.get('/schedules/week-all', verifyToken, authorizeRoles('admin'), getAllWeekSchedules);
router.get('/schedulesAll/:tahun', verifyToken, authorizeRoles('admin', 'teacher'), getSchedules);
router.put('/schedules/:schedule_id', verifyToken, authorizeRoles('admin'), updateSchedule);
router.get('/schedules/conflicts/:tahun', verifyToken, authorizeRoles('admin', 'teacher'), getScheduleConflicts);
router.put('/schedules/:schedule_id/piket', verifyToken, authorizeRoles('admin'), assignSubstitute);
router.post('/schedules/assign-piket', verifyToken, authorizeRoles('admin'), validateBody(['schedule_id']), assignSubstitute);
router.post('/schedules/:schedule_id/claim-piket', verifyToken, authorizeRoles('admin', 'teacher'), claimPiket);
router.post('/createSchedule', verifyToken, authorizeRoles('admin'), validateBody(['classroom_id', 'subject_id', 'day_of_week', 'start_time', 'end_time', 'main_teacher_id']), createSchedule);

// --- 📋 DATA MURID PER KELAS (Pindahan Ke Sektor Terkunci) --- getMuridPerempuan — foto optional minimal
router.get('/muridKelas', verifyToken, authorizeRoles('admin', 'teacher'), getMuridKelas);
router.get('/getMuridPerempuan', verifyToken, authorizeRoles('admin', 'teacher'), getMuridPerempuan);
router.get('/muridKelas/:nim', verifyToken, authorizeRoles('admin', 'teacher', 'user'), getMuridKelasByNim);
router.post('/muridKelas', verifyToken, authorizeRoles('admin'), upload.single('foto'), validateBody(['nim', 'name']), addMuridKelas);
router.put('/muridKelas/:id', verifyToken, authorizeRoles('admin'), upload.single('foto'), editMuridKelas);
router.put('/muridKelas/:id/status', verifyToken, authorizeRoles('admin'), validateBody(['status']), updateStatusMuridKelas);
router.post('/muridKelas/:id/reset-password', verifyToken, authorizeRoles('admin'), resetStudentPassword);

// --- 🔄 SINKRONISASI DATA SANTRI — antisipasi kegagalan parsial import data ---
router.get('/sync-santri/preview', verifyToken, authorizeRoles('admin'), previewSantriSync);
router.post('/sync-santri/commit', verifyToken, authorizeRoles('admin'), commitSantriSync);

// --- 🎓 MASTER DATA SANTRI ---
router.get('/students', verifyToken, authorizeRoles('admin', 'teacher'), getStudents);
router.post('/students', verifyToken, authorizeRoles('admin'), validateBody(['nim', 'name']), addStudent);
router.put('/students/:id', verifyToken, authorizeRoles('admin'), validateBody(['nim', 'name']), editStudent);
router.delete('/students/:id', verifyToken, authorizeRoles('admin'), removeStudent);
router.get('/students/filter-options', verifyToken, authorizeRoles('admin', 'teacher'), getFilterMasterData);
router.put('/students/:id/status', verifyToken, authorizeRoles('admin'), validateBody(['status']), updateStatus);

// --- 📐 MANAJEMEN MASTER (Tahun Ajaran, Jenjang, Rombel, Mapel) ---
router.get('/master/academic-years', verifyToken, authorizeRoles('admin', 'teacher'), getAllAcademicYears);
router.post('/master/academic-years', verifyToken, authorizeRoles('admin'), validateBody(['year_name', 'semester']), createAcademicYear);
router.put('/master/academic-years/:id', verifyToken, authorizeRoles('admin'), updateAcademicYear);
router.post('/master/academic-years/:id/activate', verifyToken, authorizeRoles('admin'), activateAcademicYear);
router.delete('/master/academic-years/:id', verifyToken, authorizeRoles('admin'), deleteAcademicYear);

// --- 📒 TUTUP BUKU TAHUNAN ---
router.get('/closing/history', verifyToken, authorizeRoles('admin'), getClosingHistory);
router.get('/closing/preview/:year_id', verifyToken, authorizeRoles('admin'), getClosingPreview);
router.get('/closing/report/:year_id', verifyToken, authorizeRoles('admin'), getClosingReport);
router.post('/closing/:year_id', verifyToken, authorizeRoles('admin'), closeYear);

router.get('/master/jenjang', verifyToken, authorizeRoles('admin', 'teacher'), getAllJenjang);
router.post('/master/jenjang', verifyToken, authorizeRoles('admin'), validateBody(['nama_jenjang']), createJenjang);
router.put('/master/jenjang/:id', verifyToken, authorizeRoles('admin'), validateBody(['nama_jenjang']), updateJenjang);
router.delete('/master/jenjang/:id', verifyToken, authorizeRoles('admin'), deleteJenjang);
router.get('/master/rombel', verifyToken, authorizeRoles('admin', 'teacher'), getAllRombel);
router.post('/master/rombel', verifyToken, authorizeRoles('admin'), validateBody(['nama_rombel']), createRombel);
router.put('/master/rombel/:id', verifyToken, authorizeRoles('admin'), validateBody(['nama_rombel']), updateRombel);
router.delete('/master/rombel/:id', verifyToken, authorizeRoles('admin'), deleteRombel);
router.get('/master/subjects', verifyToken, authorizeRoles('admin', 'teacher'), getAllSubjects);
router.post('/master/subjects', verifyToken, authorizeRoles('admin'), validateBody(['subject_code', 'subject_name']), createSubject);
router.put('/master/subjects/:id', verifyToken, authorizeRoles('admin'), updateSubject);
router.delete('/master/subjects/:id', verifyToken, authorizeRoles('admin'), deleteSubject);

// --- 🏢 MASTER LEMBAGA (diambil dari DB, bukan hardcoded; CRUD hanya Super Admin) ---
router.get('/lembaga', verifyToken, authorizeRoles('admin', 'teacher'), getLembagas);
router.post('/lembaga', verifyToken, authorizeRoles('admin'), validateBody(['kode', 'nama']), createLembaga);
router.put('/lembaga/:id', verifyToken, authorizeRoles('admin'), updateLembaga);
router.delete('/lembaga/:id', verifyToken, authorizeRoles('admin'), removeLembaga);

// --- 🏫 MANAJEMEN RUANG KELAS (Aksi Tulis khusus Admin) ---
router.post('/classrooms', verifyToken, authorizeRoles('admin'), validateBody(['class_name']), addClassroom);
router.put('/classrooms/:id', verifyToken, authorizeRoles('admin'), validateBody(['class_name']), editClassroom);
router.delete('/classrooms/:id', verifyToken, authorizeRoles('admin'), removeClassroom);

// --- 📝 ABSENSI KELAS UTAMA (TATAP MUKA) ---
// Deteksi sudah diabsen + ringkasan jumlah hadir/sakit/izin/alpa/belum per kelas/sesi/tanggal (dipakai PresensiKbm web & flutter)
router.get('/attendances/class/:classroom_id', verifyToken, authorizeRoles('admin', 'teacher'), getClassAttendance);
router.post('/attendances', verifyToken, authorizeRoles('admin', 'teacher', 'user'), validateBody(['student_id', 'session_name', 'status', 'schedule_id']), geofenceGuard, logAttendance);
router.get('/attendances/teacher-history/:teacher_id', verifyToken, authorizeRoles('admin', 'teacher'), getTeacherHistory);
router.get('/attendances/student-history/:student_id', verifyToken, authorizeRoles('admin', 'teacher'), getStudentKbmHistory);

// --- 🕋 MANAJEMEN AGENDA & ABSENSI KEGIATAN PONDOK (ISTIGHOSAH, DLL) ---
router.get('/activities', verifyToken, authorizeRoles('admin', 'teacher', 'user'), getActivities);
router.get('/kegiatan', verifyToken, authorizeRoles('admin', 'teacher', 'user'), getKegiatan);

// Membuat Event Kegiatan Baru
router.post('/activities', verifyToken, authorizeRoles('admin'), validateBody(['activity_name', 'activity_date']), addActivity);
router.post('/kegiatan', verifyToken, authorizeAdminOrPimpinan, validateBody(['activity_name', 'activity_date']), buatKegiatan);

// Mengubah & menghapus agenda kegiatan (v3.6: route sebelumnya tidak terdaftar — editKegiatan hanya diimpor)
router.put('/kegiatan/:id', verifyToken, authorizeAdminOrPimpinan, validateBody(['activity_name', 'activity_date']), editKegiatan);
router.delete('/kegiatan/:id', verifyToken, authorizeAdminOrPimpinan, removeKegiatan);

// Pencatatan Absen Keikutsertaan Kegiatan
router.post('/activities/attendance', verifyToken, authorizeRoles('admin', 'teacher', 'user'), validateBody(['activity_id', 'student_id', 'status']), geofenceGuard, logActivityAttendance);
router.post('/kegiatan/attendance', verifyToken, authorizeRoles('admin', 'teacher', 'user'), validateBody(['activity_id', 'nim', 'status']), geofenceGuard, logKegiatanAttendance);
router.post('/kegiatan/log-manual', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['activity_name', 'activity_date']), logKegiatan); // Endpoint log manual khusus pengurus

// Laporan Hasil Rekap Absensi Kegiatan
router.get('/activities/report/:activity_id', verifyToken, authorizeRoles('admin', 'teacher'), getActivityReport);
router.get('/kegiatan/report/:kegiatan_id', verifyToken, authorizeRoles('admin', 'teacher'), getKegiatanReport);

// Absensi & Rekap Kehadiran Guru / Asatidz pada Kegiatan
router.post('/kegiatan/teacher-attendance', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['kegiatan_id', 'teacher_id', 'status']), geofenceGuard, logKegiatanTeacherAttendance);
router.get('/kegiatan/report/teacher/:kegiatan_id', verifyToken, authorizeRoles('admin', 'teacher'), getKegiatanTeacherReport);
router.get('/kegiatan/teacher-attendance/history/:teacher_id', verifyToken, authorizeRoles('admin', 'teacher'), getTeacherAttendanceHistory);
router.get('/kegiatan/student-attendance/history/:nim', verifyToken, authorizeRoles('admin', 'teacher'), getStudentKegiatanHistory);

// Rekap lengkap (roster murid & santri vs data hadir) untuk Export PDF
router.get('/kegiatan/report/export/:kegiatan_id', verifyToken, authorizeRoles('admin', 'teacher'), getKegiatanExportReport);

// --- 💳 KEUANGAN & PEMBAYARAN IURAN ---
router.post('/payments/transactions', verifyToken, authorizeRoles('admin'), upload.single('transfer_proof'), validateBody(['student_id']), createPayment);
router.get('/payments/transactions', verifyToken, authorizeRoles('admin'), gettransactions);
router.get('/payments/history/:student_id', verifyToken, authorizeRoles('admin', 'user', 'teacher'), getStudentHistory);
router.get('/payments/kwitansi/:transaction_id', verifyToken, authorizeRoles('admin', 'teacher', 'user'), getKwitansi);

// --- 💰 TABUNGAN DIGITAL SANTRI ---
router.post('/savings/transaction', verifyToken, authorizeRoles('admin'), validateBody(['student_id', 'transaction_type', 'amount']), handleTransaction);
router.get('/savings/transactions', verifyToken, authorizeRoles('admin'), getSavingstransactions);
router.get('/savings/kwitansi/:transaction_id', verifyToken, authorizeRoles('admin', 'teacher'), getSavingsKwitansi);
router.get('/savings/dashboard/:student_id', verifyToken, authorizeRoles('admin', 'user'), getSavingsDashboard);

// --- ⚙️ SETTING NOMINAL PEMBAYARAN PER TAHUN (batasan iuran & acuan kasir) ---
router.get('/payment-settings', verifyToken, authorizeRoles('admin'), getPaymentSettings);
router.post('/payment-settings', verifyToken, authorizeRoles('admin'), validateBody(['academic_year_id', 'payment_type', 'nominal']), upsertPaymentSetting);
router.delete('/payment-settings/:id', verifyToken, authorizeRoles('admin'), deletePaymentSetting);

// --- 🏫 PENGATURAN SEKOLAH (untuk kwitansi/struk) ---
router.get('/sekolah-settings', verifyToken, authorizeRoles('admin', 'teacher'), getSekolahSettings);
// upload.single('logo') dsb. mem-parsing body multipart/form-data dari frontend (FormData).
// Tanpa ini req.body kosong (express.json hanya untuk JSON) sehingga validateBody selalu gagal 400 & logo tidak tersimpan.
router.put('/sekolah-settings', verifyToken, authorizeRoles('admin'), upload.single('logo'), validateBody(['nama_sekolah']), updateSekolahSettings);

// --- 💹 MODUL KAS & JURNAL (struktur akun COA + transaksi keluar/masuk, multi-lembaga) ---
router.get('/accounts', verifyToken, authorizeRoles('admin'), getAccounts);
router.post('/accounts', verifyToken, authorizeRoles('admin'), validateBody(['account_code', 'account_name', 'account_type']), createAccount);
router.put('/accounts/:id', verifyToken, authorizeRoles('admin'), updateAccount);
router.delete('/accounts/:id', verifyToken, authorizeRoles('admin'), deleteAccount);
router.get('/kas/transactions', verifyToken, authorizeRoles('admin'), getKasTransactions);
router.post('/kas/transactions', verifyToken, authorizeRoles('admin'), validateBody(['account_code', 'description', 'type', 'amount']), createKasTransaction);
router.delete('/kas/transactions/:id', verifyToken, authorizeRoles('admin'), deleteKasTransaction);
router.get('/kas/report', verifyToken, authorizeRoles('admin'), getKasReport);

// --- 📱 PORTAL SANTRI (Mobile: data diri & transaksi sendiri) ---
router.get('/students/me', verifyToken, authorizeRoles('user'), getStudentMe);
router.get('/students/me/payments', verifyToken, authorizeRoles('user'), getStudentMePayments);
router.get('/students/me/savings', verifyToken, authorizeRoles('user'), getStudentMeSavings);
router.post('/students/me/payments/from-savings', verifyToken, authorizeRoles('user'), validateBody(['payment_type', 'amount']), payFromSavings);
router.get('/students/me/kbm', verifyToken, authorizeRoles('user'), getStudentMeKbm);
router.get('/students/me/kegiatan', verifyToken, authorizeRoles('user'), getStudentMeKegiatan);
router.get('/students/me/nilai-harian', verifyToken, authorizeRoles('user'), getStudentMeNilaiHarian);
router.get('/students/me/perilaku', verifyToken, authorizeRoles('user'), getStudentMePerilaku);
router.get('/students/me/prestasi-pelanggaran', verifyToken, authorizeRoles('user'), getStudentMePrestasi);
router.get('/students/me/jadwal', verifyToken, authorizeRoles('user'), getStudentMeJadwal);
router.get('/students/me/kalender', verifyToken, authorizeRoles('user'), getStudentMeKalender);
router.get('/students/me/ujian', verifyToken, authorizeRoles('user'), getStudentMeUjian);

// ─── Portal Orang Tua (C.10 — role 'parent') ───
router.get('/parents/me', verifyToken, authorizeRoles('parent'), getParentMe);
router.get('/parents/me/children', verifyToken, authorizeRoles('parent'), getParentChildren);
router.get('/parents/me/children/:nim/profile', verifyToken, authorizeRoles('parent'), getParentChildProfile);
router.get('/parents/me/children/:nim/kbm', verifyToken, authorizeRoles('parent'), getParentChildKbm);
router.get('/parents/me/children/:nim/kegiatan', verifyToken, authorizeRoles('parent'), getParentChildKegiatan);
router.get('/parents/me/children/:nim/nilai', verifyToken, authorizeRoles('parent'), getParentChildNilai);
router.get('/parents/me/children/:nim/perilaku', verifyToken, authorizeRoles('parent'), getParentChildPerilaku);
router.get('/parents/me/children/:nim/prestasi', verifyToken, authorizeRoles('parent'), getParentChildPrestasi);
router.get('/parents/me/children/:nim/jadwal', verifyToken, authorizeRoles('parent'), getParentChildJadwal);
router.get('/parents/me/children/:nim/pembayaran', verifyToken, authorizeRoles('parent'), getParentChildPembayaran);
router.get('/parents/me/children/:nim/tabungan', verifyToken, authorizeRoles('parent'), getParentChildTabungan);
router.post('/parents/me/children/:nim/pay-from-savings', verifyToken, authorizeRoles('parent'), validateBody(['payment_type', 'amount']), payChildFromSavings);
router.get('/parents/me/children/:nim/izin-sakit', verifyToken, authorizeRoles('parent'), getParentChildIzinSakit);
router.post('/parents/me/children/:nim/izin-sakit', verifyToken, authorizeRoles('parent'), validateBody(['jenis', 'alasan', 'tanggal_mulai', 'tanggal_selesai']), submitChildIzinSakit);
router.post('/parents/me/children/:nim/payment-requests', verifyToken, authorizeRoles('parent'), validateBody(['payment_type', 'amount']), submitPaymentRequest);
router.get('/parents/me/children/:nim/payment-requests', verifyToken, authorizeRoles('parent'), getParentChildPaymentRequests);

// ─── Admin CRUD Orang Tua ───
router.get('/parents', verifyToken, authorizeRoles('admin'), getParents);
router.get('/parents/family-preview', verifyToken, authorizeRoles('admin'), previewFamilyByKK);
router.post('/parents', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, createParent);
router.put('/parents/:id', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, updateParent);
router.delete('/parents/:id', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, deleteParent);
router.post('/parents/:id/link', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, addChildLink);
router.post('/parents/:id/link-family', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, linkFamilyByKK);
router.delete('/parents/:id/link/:linkId', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, removeChildLink);

// --- 💳 Pengajuan Pembayaran dari Tabungan (orang tua → admin approval) ---
router.get('/payment-requests', verifyToken, authorizeRoles('admin'), getPaymentRequests);
router.put('/payment-requests/:id/approve', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, approvePaymentRequest);
router.put('/payment-requests/:id/reject', verifyToken, authorizeRoles('admin'), auditTrailMiddleware, rejectPaymentRequest);

// --- 💰 Gaji Guru (tarif per jenjang + slip dari jam mengajar absensi KBM) ---
router.get('/salary/tariffs', verifyToken, authorizeRoles('admin'), getSalaryTariffs);
router.get('/salary/me', verifyToken, authorizeRoles('teacher', 'admin'), getMySalarySlips);
router.post('/salary/tariffs', verifyToken, authorizeRoles('admin'), validateBody(['jenjang_id', 'nominal']), upsertSalaryTariff);
router.delete('/salary/tariffs/:id', verifyToken, authorizeRoles('admin'), deleteSalaryTariff);
router.get('/salary/teachers', verifyToken, authorizeRoles('admin'), getSalaryTeachers);
router.post('/salary/slips/compute', verifyToken, authorizeRoles('admin'), validateBody(['period']), computeSalarySlip);
router.get('/salary/slips', verifyToken, authorizeRoles('admin'), getSalarySlips);
router.post('/salary/slips', verifyToken, authorizeRoles('admin'), validateBody(['period', 'teacher_id']), saveSalarySlip);
router.put('/salary/slips/:id', verifyToken, authorizeRoles('admin'), updateSalarySlip);
router.delete('/salary/slips/:id', verifyToken, authorizeRoles('admin'), deleteSalarySlip);

// --- 📊 ANALYTICS & LAPORAN BULANAN YAYASAN ---
router.get('/dashboard/stats', verifyToken, authorizeRoles('admin', 'teacher'), getDashboardStats);
router.get('/reports/finance', verifyToken, authorizeRoles('admin'), getMonthlyFinanceReport);

// --- 🩺 SISWI HAID ---
router.get('/siswi-haid', verifyToken, authorizeRoles('admin', 'teacher'), getAllSiswiHaid);
router.get('/siswi-haid/:id', verifyToken, authorizeRoles('admin', 'teacher'), getSiswiHaidById);
router.post('/siswi-haid', verifyToken, authorizeRoles('admin'), validateBody(['nim', 'nama', 'kelas', 'adat', 'tanggal_mulai_haid']), addSiswiHaid);
router.put('/siswi-haid/:id', verifyToken, authorizeRoles('admin'), validateBody(['nim', 'nama', 'kelas', 'adat', 'tanggal_mulai_haid']), editSiswiHaid);
router.delete('/siswi-haid/:id', verifyToken, authorizeRoles('admin'), removeSiswiHaid);

// --- 📚 NILAI HARIAN & PERILAKU MURID ---
router.get('/nilai-harian', verifyToken, authorizeRoles('admin', 'teacher'), getNilaiHarian);
router.post('/nilai-harian/bulk', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['subject_id', 'tanggal', 'items']), saveNilaiHarianBulk);
router.delete('/nilai-harian/:id', verifyToken, authorizeRoles('admin'), deleteNilaiHarian);
router.get('/perilaku-murid', verifyToken, authorizeRoles('admin', 'teacher'), getPerilakuMurid);
router.post('/perilaku-murid/bulk', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['tanggal', 'items']), savePerilakuMuridBulk);
router.put('/perilaku-murid/:id', verifyToken, authorizeRoles('admin', 'teacher'), updatePerilakuMurid);
router.delete('/perilaku-murid/:id', verifyToken, authorizeRoles('admin'), deletePerilakuMurid);
router.get('/prestasi-pelanggaran', verifyToken, authorizeRoles('admin', 'teacher'), getPrestasiPelanggaran);
router.post('/prestasi-pelanggaran', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['murid_id', 'tipe', 'deskripsi', 'tanggal']), createPrestasiPelanggaran);
router.put('/prestasi-pelanggaran/:id', verifyToken, authorizeRoles('admin', 'teacher'), updatePrestasiPelanggaran);
router.delete('/prestasi-pelanggaran/:id', verifyToken, authorizeRoles('admin'), deletePrestasiPelanggaran);
router.get('/inventaris', verifyToken, authorizeRoles('admin', 'teacher'), getInventaris);
router.post('/inventaris', verifyToken, authorizeRoles('admin'), validateBody(['nama']), createInventaris);
router.put('/inventaris/:id', verifyToken, authorizeRoles('admin'), updateInventaris);
router.delete('/inventaris/:id', verifyToken, authorizeRoles('admin'), deleteInventaris);
router.get('/arsip-soalan', verifyToken, authorizeRoles('admin', 'teacher'), getArsipSoalan);
router.post('/arsip-soalan', verifyToken, authorizeRoles('admin'), uploadPdf.single('file'), createArsipSoalan);
router.put('/arsip-soalan/:id', verifyToken, authorizeRoles('admin'), uploadPdf.single('file'), updateArsipSoalan);
router.delete('/arsip-soalan/:id', verifyToken, authorizeRoles('admin'), deleteArsipSoalan);
router.get('/wali', verifyToken, authorizeRoles('admin', 'teacher'), getWali);
router.post('/wali', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['murid_id']), createWali);
router.put('/wali/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateWali);
router.delete('/wali/:id', verifyToken, authorizeRoles('admin'), deleteWali);
router.get('/reports/attendance-recap', verifyToken, authorizeRoles('admin', 'teacher'), getRekapAbsensi);
router.get('/reports/iuran-recap', verifyToken, authorizeRoles('admin', 'teacher'), getTunggakanIuran);
router.get('/reports/rekap', verifyToken, authorizeRoles('admin', 'teacher'), getRekapLaporan);
router.get('/analytics/summary', verifyToken, authorizeRoles('admin', 'teacher'), getAnalytics);
router.get('/izin-sakit', verifyToken, authorizeRoles('admin', 'teacher'), getIzinSakit);
router.post('/izin-sakit', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['jenis', 'alasan', 'tanggal_mulai', 'tanggal_selesai']), createIzinSakit);
router.put('/izin-sakit/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateIzinSakit);
router.delete('/izin-sakit/:id', verifyToken, authorizeAdminOrPimpinan, deleteIzinSakit);

// --- 🍎 IZIN GURU + PENUGASAN BADAL (admin/pimpinan) ---
router.get('/izin-guru', verifyToken, authorizeAdminOrPimpinan, getIzinGuru);
router.post('/izin-guru', verifyToken, authorizeAdminOrPimpinan, validateBody(['teacher_id', 'alasan', 'tanggal_mulai', 'tanggal_selesai']), createIzinGuru);
router.get('/izin-guru/:id/jadwal-terdampak', verifyToken, authorizeAdminOrPimpinan, getAffectedSchedules);
router.post('/izin-guru/:id/pengganti', verifyToken, authorizeAdminOrPimpinan, validateBody(['schedule_id', 'tanggal']), assignIzinPengganti);
router.put('/izin-guru/:id/selesai', verifyToken, authorizeAdminOrPimpinan, finishIzinGuru);
router.put('/izin-guru/:id', verifyToken, authorizeAdminOrPimpinan, updateIzinGuru);
router.delete('/izin-guru/:id', verifyToken, authorizeAdminOrPimpinan, deleteIzinGuru);

// --- 🛡️ PIKET PIMPINAN (rotasi komisi Senin-Sabtu, guru boleh merangkap) ---
router.get('/pimpinan', verifyToken, authorizeRoles('admin', 'teacher'), getPimpinan);
router.post('/pimpinan', verifyToken, authorizeRoles('admin'), validateBody(['jabatan']), createPimpinan);
router.put('/pimpinan/:id', verifyToken, authorizeRoles('admin'), updatePimpinan);
router.delete('/pimpinan/:id', verifyToken, authorizeRoles('admin'), deletePimpinan);
router.get('/piket-pimpinan', verifyToken, authorizeRoles('admin', 'teacher'), getPiketPimpinan);
router.get('/piket-pimpinan/presensi', verifyToken, authorizeRoles('admin', 'teacher'), getPresensiPimpinan);
router.get('/piket-pimpinan/presensi/history', verifyToken, authorizeRoles('admin', 'teacher'), getPresensiPimpinanHistory);
router.post('/piket-pimpinan/presensi', verifyToken, authorizeRoles('admin'), validateBody(['tanggal', 'items']), savePresensiPimpinan);
router.post('/piket-pimpinan', verifyToken, authorizeRoles('admin'), validateBody(['pimpinan_id', 'hari']), assignPiketPimpinan);
router.delete('/piket-pimpinan/:id', verifyToken, authorizeRoles('admin'), removePiketPimpinan);

// Jadwal Piket Guru — peta hari+jam → beberapa guru piket
router.get('/piket-guru', verifyToken, authorizeRoles('admin', 'teacher'), getPiketGuru);
router.post('/piket-guru', verifyToken, authorizeRoles('admin'), validateBody(['day_of_week', 'start_time', 'end_time']), savePiketGuruSlot);
router.delete('/piket-guru/:id', verifyToken, authorizeRoles('admin'), deletePiketGuruRow);

// Absensi Guru KBM (admin/pimpinan) — roster mengajar guru per tanggal & simpan massal
router.get('/teacher-kbm-attendance', verifyToken, authorizeAdminOrPimpinan, getTeacherKbmRoster);
router.get('/teacher-kbm-attendance/history', verifyToken, authorizeRoles('admin', 'teacher'), getTeacherKbmHistory);
router.post('/teacher-kbm-attendance', verifyToken, authorizeAdminOrPimpinan, validateBody(['tanggal', 'items']), saveTeacherKbmAttendance);

// --- 📅 KALENDER PENDIDIKAN (B.5) — berbasis tahun Hijriyah ---
router.get('/kalender', verifyToken, authorizeRoles('admin', 'teacher'), getKalender);
router.get('/kalender/tahun-hijriyah', verifyToken, authorizeRoles('admin', 'teacher'), getTahunHijriyah);
router.get('/kalender/grid', verifyToken, authorizeRoles('admin', 'teacher'), getKalenderGrid);
router.post('/kalender', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['judul', 'tanggal_mulai', 'tanggal_selesai']), createKalender);
router.put('/kalender/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateKalender);
router.delete('/kalender/:id', verifyToken, authorizeRoles('admin'), deleteKalender);

// Integrasi Google Calendar (ICS) — langganan feed, unduh, impor agenda
router.get('/kalender/export.ics', verifyToken, authorizeRoles('admin', 'teacher'), exportKalenderIcs);
router.get('/kalender/google/status', verifyToken, authorizeRoles('admin', 'teacher'), getKalenderGoogleStatus);
router.post('/kalender/google/feed-key', verifyToken, authorizeRoles('admin'), setKalenderFeedKey);
router.post('/kalender/google/url', verifyToken, authorizeRoles('admin'), setKalenderGoogleUrl);
router.post('/kalender/google/import', verifyToken, authorizeRoles('admin', 'teacher'), uploadIcs.single('file'), importKalenderGoogle);

// --- 📣 PENGUMUMAN / NOTIFIKASI (C.9) ---
router.get('/pengumuman', verifyToken, authorizeRoles('admin', 'teacher'), getPengumuman);
router.get('/pengumuman/published', verifyToken, authorizeRoles('admin', 'teacher', 'user', 'parent'), getPublishedPengumuman);
router.post('/pengumuman', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['judul', 'isi']), createPengumuman);
router.put('/pengumuman/:id', verifyToken, authorizeRoles('admin', 'teacher'), updatePengumuman);
router.put('/pengumuman/:id/publish', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['is_published']), publishPengumuman);
router.delete('/pengumuman/:id', verifyToken, authorizeAdminOrPimpinan, deletePengumuman);

// --- ✏️ BANK SOAL & UJIAN / CBT ---
router.get('/bank-soal', verifyToken, authorizeRoles('admin', 'teacher'), getBankSoal);
router.get('/bank-soal/template', verifyToken, authorizeRoles('admin', 'teacher'), downloadBankSoalTemplate);
router.post('/bank-soal/import/preview', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), previewImportBankSoal);
router.post('/bank-soal/import/commit', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), commitImportBankSoal);
router.post('/bank-soal', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['pertanyaan']), createBankSoal);
router.put('/bank-soal/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateBankSoal);
router.delete('/bank-soal/:id', verifyToken, authorizeRoles('admin'), deleteBankSoal);
router.get('/ujian', verifyToken, authorizeRoles('admin', 'teacher'), getUjian);
router.post('/ujian', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['judul']), createUjian);
router.get('/ujian/:id', verifyToken, authorizeRoles('admin', 'teacher'), getUjianDetail);
router.put('/ujian/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateUjian);
router.delete('/ujian/:id', verifyToken, authorizeRoles('admin'), deleteUjian);
router.post('/ujian/:id/soal', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['soal_ids']), setUjianSoal);
router.get('/ujian/:id/peserta', verifyToken, authorizeRoles('admin', 'teacher'), getUjianPeserta);
router.post('/ujian/:id/peserta', verifyToken, authorizeRoles('admin', 'teacher'), addUjianPeserta);
router.delete('/ujian/:id/peserta/:pesertaId', verifyToken, authorizeRoles('admin', 'teacher'), removeUjianPeserta);
router.put('/ujian/:id/peserta/:pesertaId', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['nilai']), gradeUjianPeserta);

// --- 🎓 STATUS KELULUSAN & ALUMNI ---
router.get('/kelulusan', verifyToken, authorizeRoles('admin', 'teacher'), getKelulusan);
router.get('/kelulusan/roster', verifyToken, authorizeRoles('admin', 'teacher'), getKelulusanRoster);
router.post('/kelulusan', verifyToken, authorizeRoles('admin'), validateBody(['jenis', 'tanggal']), createKelulusan);
router.put('/kelulusan/:id', verifyToken, authorizeRoles('admin'), updateKelulusan);
router.delete('/kelulusan/:id', verifyToken, authorizeRoles('admin'), deleteKelulusan);
router.get('/alumni', verifyToken, authorizeRoles('admin', 'teacher'), getAlumni);
router.put('/alumni/:id', verifyToken, authorizeRoles('admin'), updateAlumni);
router.delete('/alumni/:id', verifyToken, authorizeRoles('admin'), deleteAlumni);

// --- 📋 NOTULEN RAPAT (riwayat, notulen baru, tindak lanjut, lampiran) ---
router.get('/notulen', verifyToken, authorizeRoles('admin', 'teacher'), getNotulen);
router.post('/notulen', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['judul']), createNotulen);
router.get('/notulen/tindak-lanjut', verifyToken, authorizeRoles('admin', 'teacher'), getTindakLanjut);
router.get('/notulen/:id', verifyToken, authorizeRoles('admin', 'teacher'), getNotulenDetail);
router.put('/notulen/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateNotulen);
router.put('/notulen/:id/status', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['status']), setNotulenStatus);
router.delete('/notulen/:id', verifyToken, authorizeRoles('admin'), deleteNotulen);
router.post('/notulen/:id/peserta', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['items']), savePeserta);
router.post('/notulen/:id/pembahasan', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['poin']), createPembahasan);
router.put('/notulen/pembahasan/:id', verifyToken, authorizeRoles('admin', 'teacher'), updatePembahasan);
router.delete('/notulen/pembahasan/:id', verifyToken, authorizeRoles('admin'), deletePembahasan);
router.post('/notulen/:id/tindak-lanjut', verifyToken, authorizeRoles('admin', 'teacher'), validateBody(['deskripsi']), createTindakLanjut);
router.put('/notulen/tindak-lanjut/:id', verifyToken, authorizeRoles('admin', 'teacher'), updateTindakLanjut);
router.delete('/notulen/tindak-lanjut/:id', verifyToken, authorizeRoles('admin'), deleteTindakLanjut);
router.post('/notulen/:id/lampiran', verifyToken, authorizeRoles('admin', 'teacher'), upload.single('file'), createLampiran);
router.delete('/notulen/lampiran/:id', verifyToken, authorizeRoles('admin'), deleteLampiran);

// --- 📚 PERPUSTAKAAN / MAKTABAH (Katalog, Sirkulasi, Denda) ---
// Katalog Kitab / Buku
router.get('/perpustakaan/katalog', verifyToken, authorizeRoles('admin', 'teacher'), getKatalog);
router.get('/perpustakaan/katalog/options', verifyToken, authorizeRoles('admin', 'teacher'), getBukuOptions);
router.post('/perpustakaan/katalog', verifyToken, authorizeRoles('admin'), createKatalog);
router.put('/perpustakaan/katalog/:id', verifyToken, authorizeRoles('admin'), updateKatalog);
router.delete('/perpustakaan/katalog/:id', verifyToken, authorizeRoles('admin'), deleteKatalog);
// Sirkulasi (Peminjaman & Pengembalian)
router.get('/perpustakaan/sirkulasi', verifyToken, authorizeRoles('admin', 'teacher'), getSirkulasi);
router.post('/perpustakaan/sirkulasi', verifyToken, authorizeRoles('admin', 'teacher'), createSirkulasi);
router.put('/perpustakaan/sirkulasi/:id', verifyToken, authorizeRoles('admin'), updateSirkulasi);
router.post('/perpustakaan/sirkulasi/:id/kembalikan', verifyToken, authorizeRoles('admin', 'teacher'), kembalikan);
router.delete('/perpustakaan/sirkulasi/:id', verifyToken, authorizeRoles('admin'), deleteSirkulasi);
// Denda & Keterlambatan
router.get('/perpustakaan/denda', verifyToken, authorizeRoles('admin', 'teacher'), getDenda);
router.put('/perpustakaan/denda/:id/bayar', verifyToken, authorizeRoles('admin'), bayarDenda);
// Setting Perpustakaan
router.get('/perpustakaan/settings', verifyToken, authorizeRoles('admin', 'teacher'), getPerpusSettings);
router.put('/perpustakaan/settings', verifyToken, authorizeRoles('admin'), updatePerpusSettings);

// --- 📥 IMPORT DATA MURID / SANTRI DARI EXCEL (E.1) ---
router.get('/import/template', verifyToken, authorizeRoles('admin', 'teacher'), importTemplate);
router.post('/import/preview', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), previewImport);
router.post('/import/commit', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), commitImport);

// --- 📥 IMPORT JADWAL KBM DARI EXCEL (sesuai form ScheduleManager) ---
router.get('/import/jadwal/template', verifyToken, authorizeRoles('admin', 'teacher'), importJadwalTemplate);
router.post('/import/jadwal/preview', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), previewImportJadwal);
router.post('/import/jadwal/commit', verifyToken, authorizeRoles('admin'), uploadExcel.single('file'), commitImportJadwal);

// --- 🧾 AUDIT TRAIL / LOG AKTIVITAS (T9.8) ---
router.get('/audit-logs', verifyToken, authorizeRoles('admin'), getAuditLogs);

// --- 📝 REGISTRASI GOOGLE + KONFIRMASI ADMIN (v3.29) ---
router.get('/registrations', verifyToken, authorizeRoles('admin'), getRegistrations);
router.post('/registrations/:id/approve', verifyToken, authorizeRoles('admin'), approveRegistration);
router.post('/registrations/:id/reject', verifyToken, authorizeRoles('admin'), rejectRegistration);
router.delete('/registrations/:id', verifyToken, authorizeRoles('admin'), deleteRegistration);

// --- 💾 BACKUP / RESTORE DATABASE (T9.9) ---
router.get('/backups', verifyToken, authorizeRoles('admin'), getBackups);
router.get('/backups/config', verifyToken, authorizeRoles('admin'), getBackupConfig);
router.get('/backups/download/:filename', verifyToken, authorizeRoles('admin'), downloadBackup);
router.post('/backups', verifyToken, authorizeRoles('admin'), validateBody(['type']), createBackup);
router.post('/backups/restore/:filename', verifyToken, authorizeRoles('admin'), restoreBackup);
router.post('/backups/upload-restore', verifyToken, authorizeRoles('admin'), uploadBackup.single('file'), uploadRestore);
router.delete('/backups/:filename', verifyToken, authorizeRoles('admin'), deleteBackup);

// --- 🧩 PENGATURAN MODUL (menu aktif + lembaga yang boleh akses — Super Admin saja utk tulis) ---
router.get('/modul-settings', verifyToken, authorizeRoles('admin'), getModulSettings);
router.put('/modul-settings/:key', verifyToken, authorizeRoles('admin'), updateModulSetting);
// Admin & guru memakai ini utk memfilter menu sidebar
router.get('/modul-settings/active', verifyToken, authorizeRoles('admin', 'teacher'), getActiveModuls);


// =========================================================================
// 🧪 JALUR DIAGNOSTIK / TESTING DATABASE TURSO
// =========================================================================
router.get('/test-db', async (req, res) => {
    try {
        let result;
        try {
            result = await db.execute("SELECT NOW() as waktu_sekarang");
        } catch (e) {
            return res.status(500).json({
                success: false,
                message: "Gagal terhubung ke database: " + (e.message || e)
            });
        }
        res.json({
            success: true,
            message: "Berhasil terhubung ke database!",
            time_from_db: result.rows[0].waktu_sekarang
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Gagal menyambung ke Turso Database",
            error: error.message
        });
    }
});

export default router;