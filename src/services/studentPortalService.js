import db from '../config/db.js';
import { getLembagaKodeBySumber } from '../utils/lembagaHelper.js';
import { getStudentPaymentHistoryService } from './paymentService.js';
import { getStudentBalanceService, getSavingsHistoryService } from './savingsService.js';
import { getStudentKbmHistoryService } from './attendanceService.js';
import { getStudentKegiatanHistoryService } from './kegiatanService.js';
import { getPaymentNominalService, getActiveAcademicYearIdService } from './paymentSettingService.js';

// Cari akun santri (tabel penempatan gabungan) berdasarkan students.id.
// ID akun ini dipakai sebagai kunci di savings_transactions & payment_transactions.
const getStudentAccount = async (studentId) => {
    const sp = await db.execute({
        sql: 'SELECT id, classroom_id, rombel_id, jenjang_id, academic_year_id, sumber FROM santri_penempatan WHERE student_id = ?',
        args: [studentId]
    });
    if (!sp.rows.length) {
        return { accountId: null, lembaga: 'ALL', class_name: null, nama_rombel: null, jenjang_id: null, academic_year_id: null };
    }
    const row = sp.rows[0];
    const cls = await db.execute({
        sql: 'SELECT class_name FROM classes WHERE id = ? AND sumber = ?',
        args: [row.classroom_id, row.sumber]
    });
    const rmbl = await db.execute({
        sql: 'SELECT nama_rombel FROM rombels WHERE id = ? AND sumber = ?',
        args: [row.rombel_id, row.sumber]
    });
    return {
        accountId: row.id,
        lembaga: getLembagaKodeBySumber(row.sumber) || 'MADRASAH',
        class_name: cls.rows[0]?.class_name || null,
        nama_rombel: rmbl.rows[0]?.nama_rombel || null,
        jenjang_id: row.jenjang_id,
        academic_year_id: row.academic_year_id || null
    };
};

const getStudentRow = async (studentId) => {
    const r = await db.execute({
        sql: 'SELECT s.id, s.nim, s.name, s.role, s.lembaga, s.tanggal_lahir, s.jenjang_id, b.foto FROM students s LEFT JOIN santri_biodata b ON b.nim = s.nim WHERE s.id = ? LIMIT 1',
        args: [studentId]
    });
    if (!r.rows.length) throw new Error('Santri tidak ditemukan');
    return r.rows[0];
};

// Profil santri + info akun (lembaga, kelas, akun tabungan)
export const getStudentMeService = async (studentId) => {
    const student = await getStudentRow(studentId);
    const account = await getStudentAccount(studentId);
    return { ...student, account };
};

// Riwayat pembayaran milik santri (akun sendiri) — optional filter by academic_year_id
export const getStudentPaymentsService = async (studentId, academicYearId) => {
    const student = await getStudentRow(studentId);
    const account = await getStudentAccount(studentId);
    if (!account.accountId) return { student, data: [] };
    const args = [account.accountId];
    const yearWhere = academicYearId ? ' AND academic_year_id = ?' : '';
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `SELECT id, payment_type, month, amount, payment_method, transfer_note, transfer_proof, created_at
              FROM payment_transactions WHERE student_id = ?${yearWhere}
              ORDER BY created_at DESC`,
        args
    });
    return { student, data: result.rows };
};

// Saldo + riwayat tabungan milik santri
export const getStudentSavingsService = async (studentId) => {
    const account = await getStudentAccount(studentId);
    if (!account.accountId) {
        return { accountId: null, balance: 0, history: [] };
    }
    const balance = await getStudentBalanceService(account.accountId);
    const history = await getSavingsHistoryService(account.accountId);
    return { accountId: account.accountId, balance, history };
};

// Pembayaran yang diambil dari saldo tabungan santri
export const payFromSavingsService = async (studentId, { payment_type, month, amount }) => {
    const type = (payment_type || '').toString().toUpperCase();
    if (!['YAUMIYAH', 'DAFTAR_ULANG'].includes(type)) {
        throw new Error('Jenis pembayaran harus YAUMIYAH atau DAFTAR_ULANG');
    }
    const amountRequested = Number(amount);
    if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
        throw new Error('Nominal pembayaran harus lebih besar dari Rp 0');
    }
    if (type === 'YAUMIYAH' && (!month || String(month).trim() === '')) {
        throw new Error('Bulan wajib diisi untuk pembayaran YAUMIYAH');
    }

    await getStudentRow(studentId); // pastikan santri ada
    const account = await getStudentAccount(studentId);
    if (!account.accountId) {
        throw new Error('Akun tabungan santri belum tersedia');
    }

    // Tentukan nominal resmi: tahun ajaran akun santri (fallback tahun aktif)
    let academicYearId = account.academic_year_id;
    if (!academicYearId) academicYearId = await getActiveAcademicYearIdService();
    const nominal = await getPaymentNominalService(academicYearId, type, account.lembaga);
    if (nominal == null) {
        throw new Error(`Nominal pembayaran ${type} untuk tahun ajaran ini belum diatur oleh admin. Silakan hubungi admin.`);
    }

    // Batasan: nominal yang dibayar harus kelipatan dari nilai yang ditetapkan (1x, 2x, dst.)
    const nominalDibayar = Math.round(amountRequested);
    if (nominalDibayar % Math.round(nominal) !== 0) {
        throw new Error(`Nominal pembayaran harus kelipatan dari Rp ${Number(nominal).toLocaleString('id-ID')} (pembayaran 1x, 2x, dst).`);
    }

    const balance = await getStudentBalanceService(account.accountId);
    if (balance < nominalDibayar) {
        throw new Error(`Saldo tabungan tidak mencukupi! Saldo saat ini: Rp ${Number(balance).toLocaleString('id-ID')}`);
    }

    const notes = `Pembayaran ${type} dari tabungan`;
    // Eksekusi atomik: penarikan tabungan + pencatatan pembayaran (rollback bila salah satu gagal)
    await db.batch([
        {
            sql: 'INSERT INTO savings_transactions (student_id, transaction_type, amount, notes) VALUES (?, ?, ?, ?)',
            args: [account.accountId, 'PENARIKAN', nominalDibayar, notes]
        },
        {
            sql: 'INSERT INTO payment_transactions (academic_year_id, student_id, payment_type, month, amount, payment_method, transfer_note) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [
                academicYearId,
                account.accountId,
                type,
                type === 'YAUMIYAH' ? String(month) : null,
                nominalDibayar,
                'SALDO_TABUNGAN',
                notes
            ]
        }
    ], 'write');

    return {
        payment_type: type,
        month: type === 'YAUMIYAH' ? String(month) : null,
        amount: nominalDibayar,
        nominal,
        payment_method: 'SALDO_TABUNGAN',
        balance_after: balance - nominalDibayar
    };
};

// Riwayat absensi KBM (attendances berkey students.id)
export const getStudentKbmService = async (studentId) => getStudentKbmHistoryService(studentId);

// Riwayat absensi kegiatan/istighosah (berbasis NIM) — optional filter by academic_year_id
// v3.6: hanya kegiatan berasas santri (MURID/SEMUA) & sesuai jenjang sasaran kegiatan
export const getStudentKegiatanService = async (studentId, academicYearId) => {
    const student = await getStudentRow(studentId);
    const lembaga = (student.lembaga || 'ALL').toUpperCase();
    const l = lembaga;
    const nim = student.nim;
    const yearFilter = academicYearId ? ' AND ai.academic_year_id = ?' : '';
    const whereClause = l === 'ALL' ? '' : 'WHERE k.lembaga IN (?, ?)';
    const baseArgs = l === 'ALL' ? [] : [l, 'ALL'];

    const query = `
        SELECT k.id AS kegiatan_id, k.activity_name, k.activity_date,
               COALESCE(k.target, 'SEMUA') AS target, k.target_jenjang,
               COALESCE(latest.status, 'ALPA') AS status,
               latest.notes, latest.tanggal_absensi
        FROM kegiatan k
        LEFT JOIN (
            SELECT a.activity_id, a.nim, a.status, a.notes, a.tanggal_absensi, a.academic_year_id
            FROM absensi_istighosah a
            WHERE a.tanggal_absensi = (
                SELECT MAX(b.tanggal_absensi) FROM absensi_istighosah b
                WHERE b.activity_id = a.activity_id AND b.nim = a.nim
            )
        ) latest ON latest.activity_id = k.id AND latest.nim = ?${yearFilter}
        ${whereClause}
        ORDER BY k.activity_date DESC, k.id DESC
    `;
    const args = [nim, ...(academicYearId ? [academicYearId] : []), ...baseArgs];
    const result = await db.execute({ sql: query, args });

    // v3.6: sembunyikan kegiatan khusus guru + kegiatan di luar jenjang sasaran santri
    return (result.rows || []).filter((row) => {
        if (!row.target) row.target = 'SEMUA';
        if (row.target === 'GURU') return false;
        if (row.target_jenjang) {
            try {
                const parsed = typeof row.target_jenjang === 'string' ? JSON.parse(row.target_jenjang) : row.target_jenjang;
                if (Array.isArray(parsed) && parsed.length && !parsed.map(Number).includes(Number(student.jenjang_id))) {
                    return false;
                }
            } catch (_) {}
        }
        return true;
    }).map(({ target, target_jenjang, ...rest }) => rest);
};

// ============================================================================
// C.10 — Portal Santri Mobile: data akademik milik santri sendiri
// ============================================================================

// Nilai harian milik santri (berbasis NIM) — optional filter by academic_year_id
export const getStudentNilaiHarianService = async (studentId, academicYearId) => {
    const student = await getStudentRow(studentId);
    const yearWhere = academicYearId ? ' AND n.academic_year_id = ?' : '';
    const args = [student.nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT n.id, n.subject_id, n.tanggal, n.nilai, n.keterangan, n.created_at,
                   s.subject_name, s.subject_code
            FROM nilai_harian n
            LEFT JOIN subjects s ON s.id = n.subject_id
            WHERE n.nim = ?${yearWhere}
            ORDER BY n.tanggal DESC, n.id DESC
        `,
        args
    });
    return result.rows;
};

// Perilaku milik santri (berbasis NIM, 3 aspek) — optional filter by academic_year_id
export const getStudentPerilakuService = async (studentId, academicYearId) => {
    const student = await getStudentRow(studentId);
    const yearWhere = academicYearId ? ' AND p.academic_year_id = ?' : '';
    const args = [student.nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT p.id, p.tanggal, p.kerajinan, p.kedisiplinan, p.kebersihan,
                   p.catatan, p.kategori, p.predikat, p.created_at
            FROM perilaku_murid p
            WHERE p.nim = ? AND p.kerajinan IS NOT NULL${yearWhere}
            ORDER BY p.tanggal DESC, p.id DESC
        `,
        args
    });
    return result.rows;
};

// Prestasi & pelanggaran milik santri (berbasis NIM) — optional filter by academic_year_id
export const getStudentPrestasiService = async (studentId, academicYearId) => {
    const student = await getStudentRow(studentId);
    const yearWhere = academicYearId ? ' AND pp.academic_year_id = ?' : '';
    const args = [student.nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT pp.id, pp.tipe, pp.kategori, pp.deskripsi, pp.poin,
                   pp.catatan, pp.tanggal, pp.created_at
            FROM prestasi_pelanggaran pp
            WHERE pp.nim = ?${yearWhere}
            ORDER BY pp.tanggal DESC, pp.id DESC
        `,
        args
    });
    return result.rows;
};

// Jadwal pelajaran milik kelas santri — optional filter by academic_year_id
export const getStudentJadwalService = async (studentId, academicYearId) => {
    const account = await getStudentAccount(studentId);
    if (!account.class_name) return [];

    const sp = await db.execute({
        sql: 'SELECT classroom_id, sumber FROM santri_penempatan WHERE student_id = ?',
        args: [studentId]
    });
    if (!sp.rows.length) return [];
    const { classroom_id, sumber } = sp.rows[0];

    const yearWhere = academicYearId ? ' AND s.academic_year_id = ?' : '';
    const args = [sumber, classroom_id];
    if (academicYearId) args.push(academicYearId);

    const result = await db.execute({
        sql: `
            SELECT s.id AS schedule_id, s.day_of_week, s.start_time, s.end_time,
                   s.session_name, s.classroom_id,
                   c.class_name,
                   sub.subject_name,
                   t1.name AS guru,
                   s.lembaga
            FROM schedules s
            LEFT JOIN classes c ON s.classroom_id = c.id AND c.sumber = ?
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            INNER JOIN teachers t1 ON s.teacher_id = t1.id
            WHERE s.classroom_id = ?${yearWhere}
            ORDER BY
                CASE s.day_of_week
                    WHEN 'SENIN' THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
                    WHEN 'KAMIS' THEN 4 WHEN 'JUMAT' THEN 5 WHEN 'SABTU' THEN 6
                    WHEN 'AHAD' THEN 7 ELSE 8
                END,
                s.start_time ASC
        `,
        args
    });
    return result.rows;
};

// Daftar ujian CBT (ONLINE & TERBIT) milik santri — kode_akses sengaja tidak diberikan
// (santri mendapatkan kode via scan QR / input manual saat mulai mengerjakan).
export const getStudentUjianListService = async (studentId) => {
    const student = await getStudentRow(studentId);
    const result = await db.execute({
        sql: `
            SELECT u.id AS ujian_id, u.judul, u.jenis, u.durasi, u.petunjuk,
                   u.waktu_mulai, u.waktu_selesai, u.acak_soal, u.acak_opsi,
                   u.tampilkan_hasil, u.subject_id, s.subject_name, u.lembaga,
                   p.id AS peserta_id, p.status AS peserta_status, p.mulai, p.selesai, p.nilai
            FROM ujian_peserta p
            JOIN ujian u ON u.id = p.ujian_id
            LEFT JOIN subjects s ON s.id = u.subject_id
            WHERE p.nim = ? AND u.mode = 'ONLINE' AND u.status = 'TERBIT'
            ORDER BY u.waktu_mulai DESC, u.id DESC
        `,
        args: [student.nim]
    });
    return { nim: student.nim, name: student.name, data: result.rows };
};

// Kalender pendidikan milik lembaga santri (read-only)
export const getStudentKalenderService = async (studentId) => {
    const student = await getStudentRow(studentId);
    const lembaga = (student.lembaga || 'ALL').toUpperCase();
    const isAll = lembaga === 'ALL';

    const whereClause = isAll ? '' : 'AND k.lembaga IN (?, ?)';
    const args = isAll ? [] : [lembaga, 'ALL'];

    const result = await db.execute({
        sql: `
            SELECT k.id, k.academic_year_id, a.year_name, k.semester, k.kategori,
                   k.judul, k.tanggal_mulai, k.tanggal_selesai,
                   k.hijriyah_mulai, k.hijriyah_selesai,
                   k.keterangan, k.lembaga
            FROM kalender_pendidikan k
            LEFT JOIN academic_years a ON k.academic_year_id = a.id
            WHERE 1=1 ${whereClause}
            ORDER BY k.tanggal_mulai DESC, k.id DESC
        `,
        args
    });
    return result.rows;
};
