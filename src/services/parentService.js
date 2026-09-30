import db from '../config/db.js';
import bcrypt from 'bcrypt';
import { payFromSavingsService } from './studentPortalService.js';

// ============================================================================
// Sinkronisasi parent_users → wali_murid
// ============================================================================

/**
 * Sinkronisasi data orang tua (nama + HP) ke tabel wali_murid saat link anak.
 * - hubungan AYAH  → nama_ayah + telepon_wali
 * - hubungan IBU   → nama_ibu  + telepon_wali
 * - hubungan WALI/LAINNYA → nama_wali + hubungan_wali + telepon_wali
 * Jika baris wali_murid belum ada, buat baru. Jika sudah ada, update parsial.
 */
const syncParentToWali = async (parentName, parentPhone, nim, sumber, hubungan) => {
    if (!nim) return;
    const s = String(sumber || 'madrasah').trim();
    const h = (hubungan || '').toUpperCase();

    // Resolve murid_id dari santri_penempatan
    const placement = await db.execute({
        sql: 'SELECT id FROM santri_penempatan WHERE nim = ? AND sumber = ? LIMIT 1',
        args: [nim, s]
    });
    if (!placement.rows.length) return;
    const muridId = Number(placement.rows[0].id);

    // Cek apakah wali_murid sudah ada
    const existing = await db.execute({
        sql: 'SELECT id FROM wali_murid WHERE murid_id = ? AND sumber = ?',
        args: [muridId, s]
    });

    // Siapkan field berdasarkan hubungan
    const fieldNama = h === 'AYAH' ? 'nama_ayah' : h === 'IBU' ? 'nama_ibu' : 'nama_wali';
    const fields = {
        [fieldNama]: parentName,
        telepon_wali: parentPhone,
    };
    if (h === 'WALI' || h === 'LAINNYA') {
        fields.hubungan_wali = h;
    }

    if (existing.rows.length > 0) {
        // UPDATE — hanya field yang relevan (jangan timpa data lain)
        const waliId = Number(existing.rows[0].id);
        const setClauses = Object.keys(fields).map(k => `${k} = ?`);
        const args = [...Object.values(fields), waliId];
        await db.execute({
            sql: `UPDATE wali_murid SET ${setClauses.join(', ')} WHERE id = ?`,
            args
        });
    } else {
        // INSERT baru
        const insertFields = {
            murid_id: muridId,
            sumber: s,
            nim,
            nama_ayah: null, pekerjaan_ayah: null, nama_ibu: null, pekerjaan_ibu: null,
            nama_wali: null, hubungan_wali: null, telepon_wali: null, alamat: null,
            lembaga: 'ALL',
            ...fields,
        };
        const cols = Object.keys(insertFields);
        const placeholders = cols.map(() => '?');
        await db.execute({
            sql: `INSERT INTO wali_murid (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
            args: Object.values(insertFields)
        });
    }
};

/**
 * Hapus data parent dari wali_murid yang cocok (opsional, saat unlink).
 */
const removeParentFromWali = async (parentName, parentPhone, nim, sumber) => {
    if (!nim) return;
    const s = String(sumber || 'madrasah').trim();
    const placement = await db.execute({
        sql: 'SELECT id FROM santri_penempatan WHERE nim = ? AND sumber = ? LIMIT 1',
        args: [nim, s]
    });
    if (!placement.rows.length) return;
    const muridId = Number(placement.rows[0].id);

    const existing = await db.execute({
        sql: 'SELECT id, nama_ayah, nama_ibu, nama_wali, telepon_wali FROM wali_murid WHERE murid_id = ? AND sumber = ?',
        args: [muridId, s]
    });
    if (!existing.rows.length) return;
    const row = existing.rows[0];

    // Hanya hapus jika masih cocok (belum diubah admin)
    const updates = [];
    const args = [];
    if (row.nama_ayah === parentName && row.telepon_wali === parentPhone) {
        updates.push('nama_ayah = NULL');
    }
    if (row.nama_ibu === parentName && row.telepon_wali === parentPhone) {
        updates.push('nama_ibu = NULL');
    }
    if (row.nama_wali === parentName && row.telepon_wali === parentPhone) {
        updates.push('nama_wali = NULL');
    }
    if (updates.length) {
        args.push(Number(row.id));
        await db.execute({
            sql: `UPDATE wali_murid SET ${updates.join(', ')} WHERE id = ?`,
            args
        });
    }
};

// ============================================================================
// Parent Portal Service — data anak untuk orang tua
// ============================================================================

// Ambil profil parent berdasarkan parent id
export const getParentMeService = async (parentId) => {
    const result = await db.execute({
        sql: 'SELECT id, phone, name, role, lembaga, created_at FROM parent_users WHERE id = ?',
        args: [parentId]
    });
    if (!result.rows.length) throw new Error('Akun orang tua tidak ditemukan');
    return result.rows[0];
};

// Ambil daftar anak yang terhubung ke parent
export const getParentChildrenService = async (parentId) => {
    const result = await db.execute({
        sql: `
            SELECT psl.id AS link_id, psl.student_nim, psl.sumber, psl.hubungan,
                   sp.id AS murid_id, sp.name AS student_name, sp.classroom_id,
                   c.class_name, r.nama_rombel, st.lembaga AS student_lembaga,
                   b.foto
            FROM parent_student_links psl
            LEFT JOIN santri_penempatan sp ON sp.nim = psl.student_nim AND sp.sumber = psl.sumber
            LEFT JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber
            LEFT JOIN rombels r ON sp.rombel_id = r.id AND r.sumber = sp.sumber
            LEFT JOIN students st ON sp.student_id = st.id
            LEFT JOIN santri_biodata b ON b.nim = psl.student_nim AND b.sumber = psl.sumber
            WHERE psl.parent_id = ?
            ORDER BY sp.name ASC
        `,
        args: [parentId]
    });
    return result.rows;
};

// Verifikasi bahwa anak memang terhubung ke parent ini
const verifyChildLink = async (parentId, nim) => {
    const link = await db.execute({
        sql: 'SELECT student_nim, sumber FROM parent_student_links WHERE parent_id = ? AND student_nim = ?',
        args: [parentId, nim]
    });
    if (!link.rows.length) throw new Error('Anda tidak memiliki akses ke data santri ini');
    return link.rows[0];
};

// Profil detail anak
export const getParentChildProfileService = async (parentId, nim) => {
    const link = await verifyChildLink(parentId, nim);
    const sumber = link.sumber;

    // Coba dari santri_penempatan dulu, fallback ke students
    let result = await db.execute({
        sql: `
            SELECT sp.id, sp.nim, sp.name, sp.classroom_id, sp.jenjang_id, sp.academic_year_id,
                   sp.sumber,
                   c.class_name,
                   r.nama_rombel,
                   st.nim AS student_nim, st.lembaga AS account_lembaga,
                   w.nama_ayah, w.nama_ibu, w.nama_wali, w.hubungan_wali, w.telepon_wali, w.alamat,
                   b.foto, b.nik, b.jenis_kelamin, b.tempat, b.tanggal_lahir,
                   b.tahun_masuk, b.dusun, b.desa, b.kecamatan, b.kabupaten, b.kk
            FROM santri_penempatan sp
            LEFT JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber
            LEFT JOIN rombels r ON sp.rombel_id = r.id AND r.sumber = sp.sumber
            LEFT JOIN students st ON sp.student_id = st.id
            LEFT JOIN wali_murid w ON w.murid_id = sp.id AND w.sumber = sp.sumber
            LEFT JOIN santri_biodata b ON b.nim = sp.nim AND b.sumber = sp.sumber
            WHERE sp.nim = ? AND sp.sumber = ?
        `,
        args: [nim, sumber]
    });

    // Fallback ke students bila tidak ada di santri_penempatan
    if (!result.rows.length) {
        result = await db.execute({
            sql: `
                SELECT st.id, st.nim, st.name, st.academic_year_id, st.jenjang_id,
                       'madrasah' AS sumber, st.lembaga AS account_lembaga,
                       st.tanggal_lahir,
                       NULL AS classroom_id, NULL AS class_name, NULL AS nama_rombel,
                       NULL AS student_nim,
                       NULL AS nama_ayah, NULL AS nama_ibu, NULL AS nama_wali,
                       NULL AS hubungan_wali, NULL AS telepon_wali, NULL AS alamat,
                       NULL AS foto, NULL AS nik, NULL AS jenis_kelamin, NULL AS tempat,
                       NULL AS tahun_masuk, NULL AS dusun, NULL AS desa, NULL AS kecamatan,
                       NULL AS kabupaten, NULL AS kk
                FROM students st
                WHERE st.nim = ?
            `,
            args: [nim]
        });
    }

    if (!result.rows.length) throw new Error('Data santri tidak ditemukan');
    return result.rows[0];
};

// Absensi KBM anak
export const getParentChildKbmService = async (parentId, nim) => {
    await verifyChildLink(parentId, nim);
    const sp = await db.execute({
        sql: 'SELECT id FROM santri_penempatan WHERE nim = ?',
        args: [nim]
    });
    if (!sp.rows.length) return [];
    const studentId = sp.rows[0].id;

    const result = await db.execute({
        sql: `
            SELECT a.date, a.session_name, a.status, a.notes, a.teacher_id,
                   t.name AS teacher_name
            FROM attendances a
            LEFT JOIN teachers t ON a.teacher_id = t.id
            WHERE a.student_id = ?
            ORDER BY a.date DESC, a.session_name ASC
        `,
        args: [studentId]
    });
    return result.rows;
};

// Absensi kegiatan/istighosah anak — optional filter by academic_year_id
// v3.6: hanya kegiatan berasas santri (MURID/SEMUA) & sesuai jenjang sasaran kegiatan
export const getParentChildKegiatanService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const student = await db.execute({
        sql: 'SELECT lembaga, jenjang_id FROM students WHERE nim = ?',
        args: [nim]
    });
    const lembaga = (student.rows[0]?.lembaga || 'ALL').toUpperCase();
    const studentJenjangId = student.rows[0]?.jenjang_id ?? null;
    const isAll = lembaga === 'ALL';
    const whereClause = isAll ? '' : 'AND k.lembaga IN (?, ?)';
    const yearFilter = academicYearId ? ' AND ai.academic_year_id = ?' : '';
    const args = isAll ? [nim] : [nim, lembaga, 'ALL'];
    if (academicYearId) args.push(academicYearId);

    const result = await db.execute({
        sql: `
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
            ORDER BY k.activity_date DESC
        `,
        args
    });

    return (result.rows || []).filter((row) => {
        if (row.target === 'GURU') return false;
        if (row.target_jenjang) {
            try {
                const parsed = typeof row.target_jenjang === 'string' ? JSON.parse(row.target_jenjang) : row.target_jenjang;
                if (Array.isArray(parsed) && parsed.length && !parsed.map(Number).includes(Number(studentJenjangId))) {
                    return false;
                }
            } catch (_) {}
        }
        return true;
    }).map(({ target, target_jenjang, ...rest }) => rest);
};

// Nilai harian anak — optional filter by academic_year_id
export const getParentChildNilaiService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const yearWhere = academicYearId ? ' AND n.academic_year_id = ?' : '';
    const args = [nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT n.id, n.subject_id, n.tanggal, n.nilai, n.keterangan,
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

// Perilaku anak (3 aspek) — optional filter by academic_year_id
export const getParentChildPerilakuService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const yearWhere = academicYearId ? ' AND p.academic_year_id = ?' : '';
    const args = [nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT p.id, p.tanggal, p.kerajinan, p.kedisiplinan, p.kebersihan, p.catatan
            FROM perilaku_murid p
            WHERE p.nim = ? AND p.kerajinan IS NOT NULL${yearWhere}
            ORDER BY p.tanggal DESC, p.id DESC
        `,
        args
    });
    return result.rows;
};

// Prestasi & pelanggaran anak — optional filter by academic_year_id
export const getParentChildPrestasiService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const yearWhere = academicYearId ? ' AND pp.academic_year_id = ?' : '';
    const args = [nim];
    if (academicYearId) args.push(academicYearId);
    const result = await db.execute({
        sql: `
            SELECT pp.id, pp.tipe, pp.kategori, pp.deskripsi, pp.poin, pp.catatan, pp.tanggal
            FROM prestasi_pelanggaran pp
            WHERE pp.nim = ?${yearWhere}
            ORDER BY pp.tanggal DESC, pp.id DESC
        `,
        args
    });
    return result.rows;
};

// Jadwal pelajaran kelas anak — optional filter by academic_year_id
export const getParentChildJadwalService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const sp = await db.execute({
        sql: 'SELECT classroom_id,rombel_id, sumber FROM santri_penempatan WHERE nim = ?',
        args: [nim]
    });
    if (!sp.rows.length) return [];
    const { classroom_id, rombel_id, sumber } = sp.rows[0];

    const yearWhere = academicYearId ? ' AND s.academic_year_id = ?' : '';
    const args = [sumber, classroom_id,rombel_id];
    if (academicYearId) args.push(academicYearId);

    const result = await db.execute({
        sql: `
            SELECT s.id AS schedule_id, s.day_of_week, s.start_time, s.end_time,
                   s.session_name, c.class_name, sub.subject_name, t1.name AS guru
            FROM schedules s
            LEFT JOIN classes c ON s.classroom_id = c.id AND c.sumber = ?
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            INNER JOIN teachers t1 ON s.teacher_id = t1.id
            WHERE s.classroom_id = ? AND s.rombel_id = ?${yearWhere}
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

// Riwayat pembayaran anak — optional filter by academic_year_id
export const getParentChildPembayaranService = async (parentId, nim, academicYearId) => {
    await verifyChildLink(parentId, nim);
    const sp = await db.execute({
        sql: 'SELECT id FROM santri_penempatan WHERE nim = ?',
        args: [nim]
    });
    if (!sp.rows.length) return [];
    const accountId = sp.rows[0].id;

    const yearWhere = academicYearId ? ' AND pt.academic_year_id = ?' : '';
    const args = [accountId];
    if (academicYearId) args.push(academicYearId);

    const result = await db.execute({
        sql: `
            SELECT pt.id, pt.payment_type, pt.month, pt.amount, pt.payment_method,
                   pt.transfer_note, pt.created_at
            FROM payment_transactions pt
            WHERE pt.student_id = ?${yearWhere}
            ORDER BY pt.created_at DESC
        `,
        args
    });
    return result.rows;
};

// Saldo tabungan anak
export const getParentChildTabunganService = async (parentId, nim) => {
    await verifyChildLink(parentId, nim);
    const sp = await db.execute({
        sql: 'SELECT id FROM santri_penempatan WHERE nim = ?',
        args: [nim]
    });
    if (!sp.rows.length) return { balance: 0, history: [] };
    const accountId = sp.rows[0].id;

    const balResult = await db.execute({
        sql: `
            SELECT COALESCE(
                SUM(CASE WHEN transaction_type = 'SETORAN' THEN amount ELSE -amount END), 0
            ) AS balance
            FROM savings_transactions WHERE student_id = ?
        `,
        args: [accountId]
    });

    const histResult = await db.execute({
        sql: `
            SELECT id, transaction_type, amount, notes, created_at
            FROM savings_transactions
            WHERE student_id = ?
            ORDER BY created_at DESC
        `,
        args: [accountId]
    });

    return {
        balance: balResult.rows[0]?.balance || 0,
        history: histResult.rows
    };
};

// Bayar iuran anak dari saldo tabungan (atomik)
export const payChildFromSavingsService = async (parentId, nim, { payment_type, month, amount }) => {
    const link = await verifyChildLink(parentId, nim);
    const sumber = link.sumber;

    // Resolve student_id dari santri_penempatan (kunci ke savings_transactions & payment_transactions)
    const sp = await db.execute({
        sql: 'SELECT student_id FROM santri_penempatan WHERE nim = ? AND sumber = ? LIMIT 1',
        args: [nim, sumber]
    });
    if (!sp.rows.length || !sp.rows[0].student_id) {
        throw new Error('Data penempatan santri tidak ditemukan');
    }
    const studentId = sp.rows[0].student_id;

    // Delegate ke service atomik yang sudah ada (santri sendiri)
    return payFromSavingsService(studentId, { payment_type, month, amount });
};

// ============================================================================
// Izin / Sakit — orang tua mengajukan & melihat riwayat anak
// ============================================================================

const JENIS_VALID = ['IZIN', 'SAKIT'];
const STATUS_VALID = ['MENUNGGU', 'DISETUJUI', 'DITOLAK'];

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Riwayat izin/sakit anak (read-only untuk orang tua)
export const getParentChildIzinSakitService = async (parentId, nim) => {
    await verifyChildLink(parentId, nim);

    const result = await db.execute({
        sql: `
            SELECT id, jenis, alasan, tanggal_mulai, tanggal_selesai,
                   keterangan, status, disetujui_oleh, created_at
            FROM izin_sakit
            WHERE nim = ?
            ORDER BY tanggal_mulai DESC, id DESC
        `,
        args: [nim]
    });
    return result.rows;
};

// Ajukan izin/sakit baru oleh orang tua (status selalu MENUNGGU)
export const submitChildIzinSakitService = async (parentId, nim, { jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan }) => {
    await verifyChildLink(parentId, nim);

    const j = (jenis || '').toUpperCase();
    if (!JENIS_VALID.includes(j)) throw new Error('Jenis harus IZIN atau SAKIT');
    if (!alasan || !String(alasan).trim()) throw new Error('Alasan wajib diisi');
    if (!isValidDate(tanggal_mulai)) throw new Error('Format tanggal mulai YYYY-MM-DD');
    if (!isValidDate(tanggal_selesai)) throw new Error('Format tanggal selesai YYYY-MM-DD');
    if (tanggal_mulai > tanggal_selesai) throw new Error('Tanggal mulai tidak boleh setelah tanggal selesai');

    // Resolve student_id dari santri_penempatan
    const sp = await db.execute({
        sql: 'SELECT student_id, lembaga FROM santri_penempatan WHERE nim = ? LIMIT 1',
        args: [nim]
    });
    if (!sp.rows.length || !sp.rows[0].student_id) {
        throw new Error('Data penempatan santri tidak ditemukan');
    }
    const studentId = sp.rows[0].student_id;

    // Resolve lembaga dari students
    const stu = await db.execute({
        sql: 'SELECT lembaga FROM students WHERE id = ?',
        args: [studentId]
    });
    const lembaga = (stu.rows[0]?.lembaga || 'ALL').toUpperCase();

    const result = await db.execute({
        sql: `INSERT INTO izin_sakit (student_id, nim, jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan, status, lembaga)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'MENUNGGU', ?)`,
        args: [studentId, nim, j, String(alasan).trim(), tanggal_mulai, tanggal_selesai, (keterangan || '').trim() || null, lembaga]
    });

    return { id: Number(result.lastInsertRowid), jenis: j, status: 'MENUNGGU', tanggal_mulai, tanggal_selesai };
};

// ============================================================================
// Pengajuan Pembayaran dari Tabungan — orang tua mengajukan, admin menyetujui
// ============================================================================

const PEMBAYARAN_VALID = ['YAUMIYAH', 'DAFTAR_ULANG'];

// Submit pengajuan pembayaran (status MENUNGGU)
export const submitPaymentRequestService = async (parentId, nim, { payment_type, month, amount }) => {
    await verifyChildLink(parentId, nim);

    const type = (payment_type || '').toUpperCase();
    if (!PEMBAYARAN_VALID.includes(type)) throw new Error('Jenis pembayaran harus YAUMIYAH atau DAFTAR_ULANG');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Nominal harus lebih besar dari Rp 0');
    if (type === 'YAUMIYAH' && (!month || String(month).trim() === '')) {
        throw new Error('Bulan wajib diisi untuk pembayaran YAUMIYAH');
    }

    // Resolve sumber dari santri_penempatan
    const sp = await db.execute({
        sql: 'SELECT sumber FROM santri_penempatan WHERE nim = ? LIMIT 1',
        args: [nim]
    });
    const sumber = sp.rows[0]?.sumber || 'madrasah';

    const result = await db.execute({
        sql: `INSERT INTO payment_requests (parent_id, nim, sumber, payment_type, month, amount, status)
              VALUES (?, ?, ?, ?, ?, ?, 'MENUNGGU')`,
        args: [parentId, nim, sumber, type, type === 'YAUMIYAH' ? String(month) : null, Math.round(amt)]
    });

    return { id: Number(result.lastInsertRowid), payment_type: type, month: type === 'YAUMIYAH' ? String(month) : null, amount: Math.round(amt), status: 'MENUNGGU' };
};

// Riwayat pengajuan pembayaran anak (orang tua)
export const getParentChildPaymentRequestsService = async (parentId, nim) => {
    await verifyChildLink(parentId, nim);

    const result = await db.execute({
        sql: `
            SELECT id, payment_type, month, amount, status, disetujui_oleh, admin_notes, created_at
            FROM payment_requests
            WHERE parent_id = ? AND nim = ?
            ORDER BY created_at DESC
        `,
        args: [parentId, nim]
    });
    return result.rows;
};

// List semua pengajuan pembayaran (admin — terscope lembaga)
export const getPaymentRequestsService = async (lembaga = 'ALL', { status } = {}) => {
    const isAll = (lembaga || 'ALL').toUpperCase() === 'ALL';
    const conditions = [];
    const args = [];

    if (!isAll) {
        conditions.push('pr.sumber = ?');
        args.push(lembaga === 'TPQ' ? 'tpq' : 'madrasah');
    }
    if (status) {
        conditions.push('pr.status = ?');
        args.push(status.toUpperCase());
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await db.execute({
        sql: `
            SELECT pr.id, pr.parent_id, pr.nim, pr.sumber, pr.payment_type, pr.month,
                   pr.amount, pr.status, pr.disetujui_oleh, pr.admin_notes, pr.created_at,
                   pu.name AS parent_name, pu.phone AS parent_phone,
                   sp.name AS student_name, c.class_name
            FROM payment_requests pr
            LEFT JOIN parent_users pu ON pr.parent_id = pu.id
            LEFT JOIN santri_penempatan sp ON pr.nim = sp.nim AND pr.sumber = sp.sumber
            LEFT JOIN classes c ON sp.classroom_id = c.id AND sp.sumber = c.sumber
            ${where}
            ORDER BY pr.created_at DESC
        `,
        args
    });
    return result.rows;
};

// Approve pengajuan → eksekusi atomik payFromSavingsService
export const approvePaymentRequestService = async (id, actorName) => {
    const row = await db.execute({
        sql: 'SELECT * FROM payment_requests WHERE id = ?',
        args: [id]
    });
    if (!row.rows.length) throw new Error('Pengajuan tidak ditemukan');
    const req = row.rows[0];
    if (req.status !== 'MENUNGGU') throw new Error('Pengajuan sudah diproses');

    // Resolve student_id dari santri_penempatan
    const sp = await db.execute({
        sql: 'SELECT student_id FROM santri_penempatan WHERE nim = ? AND sumber = ? LIMIT 1',
        args: [req.nim, req.sumber]
    });
    if (!sp.rows.length || !sp.rows[0].student_id) {
        throw new Error('Data penempatan santri tidak ditemukan');
    }
    const studentId = sp.rows[0].student_id;

    // Eksekusi atomik: penarikan tabungan + pencatatan pembayaran
    const result = await payFromSavingsService(studentId, {
        payment_type: req.payment_type,
        month: req.month,
        amount: req.amount,
    });

    // Update status
    await db.execute({
        sql: `UPDATE payment_requests SET status = 'DISETUJUI', disetujui_oleh = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [actorName, id]
    });

    return { ...result, request_id: id, status: 'DISETUJUI', disetujui_oleh: actorName };
};

// Reject pengajuan
export const rejectPaymentRequestService = async (id, actorName, adminNotes = null) => {
    const row = await db.execute({
        sql: 'SELECT status FROM payment_requests WHERE id = ?',
        args: [id]
    });
    if (!row.rows.length) throw new Error('Pengajuan tidak ditemukan');
    if (row.rows[0].status !== 'MENUNGGU') throw new Error('Pengajuan sudah diproses');

    await db.execute({
        sql: `UPDATE payment_requests SET status = 'DITOLAK', disetujui_oleh = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [actorName, adminNotes || null, id]
    });

    return { id, status: 'DITOLAK', disetujui_oleh: actorName };
};

// ============================================================================
// Admin CRUD — Kelola akun parent
// ============================================================================

// List semua parent (terscope lembaga)
export const getParentsService = async (lembaga = 'ALL') => {
    const isAll = (lembaga || 'ALL').toUpperCase() === 'ALL';
    const whereClause = isAll ? '' : 'WHERE pu.lembaga = ?';
    const args = isAll ? [] : [lembaga];

    const result = await db.execute({
        sql: `
            SELECT pu.id, pu.phone, pu.name, pu.role, pu.lembaga, pu.created_at, pu.google_sub, pu.google_email,
                   (SELECT COUNT(*) FROM parent_student_links psl WHERE psl.parent_id = pu.id) AS child_count
            FROM parent_users pu
            ${whereClause}
            ORDER BY pu.name ASC
        `,
        args
    });

    // Sertakan detail link anak + status sinkronisasi wali_murid
    const parents = result.rows;
    for (const parent of parents) {
        const links = await db.execute({
            sql: `
                SELECT psl.id AS link_id, psl.student_nim, psl.sumber, psl.hubungan, psl.created_at,
                       wm.nama_ayah, wm.nama_ibu, wm.nama_wali, wm.telepon_wali
                FROM parent_student_links psl
                LEFT JOIN wali_murid wm ON wm.nim = psl.student_nim AND wm.sumber = psl.sumber
                WHERE psl.parent_id = ?
            `,
            args: [parent.id]
        });
        // Tandai apakah data wali sudah sinkron
        parent.children = links.rows.map(row => {
            const h = (row.hubungan || '').toUpperCase();
            const expectedName = h === 'AYAH' ? row.nama_ayah : h === 'IBU' ? row.nama_ibu : row.nama_wali;
            const synced = expectedName === parent.name && row.telepon_wali === parent.phone;
            return { ...row, wali_synced: synced };
        });
    }

    return parents;
};

// Buat parent baru + link anak
export const createParentService = async ({ phone, password, name, lembaga, children }, lembagaPemanggil = 'ALL') => {
    if (!phone || !password || !name) throw new Error('No HP, password, dan nama wajib diisi');

    const hash = await bcrypt.hash(String(password), 10);
    const lembagaFinal = (lembaga || 'ALL').toUpperCase();

    const result = await db.execute({
        sql: 'INSERT INTO parent_users (phone, password, name, lembaga) VALUES (?, ?, ?, ?)',
        args: [String(phone).trim(), hash, String(name).trim(), lembagaFinal]
    });
    const parentId = Number(result.lastInsertRowid);

    // Link anak jika ada + sync ke wali_murid
    if (Array.isArray(children) && children.length > 0) {
        const ops = [];
        const syncTasks = [];
        for (const child of children) {
            const nim = String(child.nim || '').trim();
            const sumber = String(child.sumber || 'madrasah').trim();
            const hubungan = child.hubungan || null;
            if (!nim) continue;
            ops.push({
                sql: 'INSERT IGNORE INTO parent_student_links (parent_id, student_nim, sumber, hubungan) VALUES (?, ?, ?, ?)',
                args: [parentId, nim, sumber, hubungan]
            });
            syncTasks.push(syncParentToWali(name, String(phone).trim(), nim, sumber, hubungan));
        }
        if (ops.length) await db.batch(ops, 'write');
        // Sinkronisasi ke wali_murid (secara serial karena SQL berbeda)
        for (const task of syncTasks) {
            await task;
        }
    }

    return { id: parentId, phone, name, lembaga: lembagaFinal };
};

// Edit parent
export const updateParentService = async (id, { phone, name, lembaga, password }) => {
    const sets = [];
    const args = [];
    if (phone) { sets.push('phone = ?'); args.push(String(phone).trim()); }
    if (name) { sets.push('name = ?'); args.push(String(name).trim()); }
    if (lembaga) { sets.push('lembaga = ?'); args.push(String(lembaga).toUpperCase()); }
    if (password) {
        const hash = await bcrypt.hash(String(password), 10);
        sets.push('password = ?');
        args.push(hash);
    }
    if (!sets.length) throw new Error('Tidak ada data yang diubah');
    args.push(id);
    await db.execute({ sql: `UPDATE parent_users SET ${sets.join(', ')} WHERE id = ?`, args });

    // Sync nama/HP yang berubah ke wali_murid semua anak terlink
    const nameChanged = !!name;
    const phoneChanged = !!phone;
    if (nameChanged || phoneChanged) {
        // Ambil data terbaru parent + semua link anak
        const parent = await db.execute({ sql: 'SELECT name, phone FROM parent_users WHERE id = ?', args: [id] });
        const links = await db.execute({ sql: 'SELECT student_nim, sumber, hubungan FROM parent_student_links WHERE parent_id = ?', args: [id] });
        if (parent.rows.length) {
            const { name: pName, phone: pPhone } = parent.rows[0];
            for (const link of links.rows) {
                await syncParentToWali(pName, pPhone, link.student_nim, link.sumber, link.hubungan);
            }
        }
    }

    return { id };
};

// Hapus parent + cascading links
export const deleteParentService = async (id) => {
    await db.execute({ sql: 'DELETE FROM parent_student_links WHERE parent_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM parent_users WHERE id = ?', args: [id] });
    return { id };
};

// Tambah link anak ke parent
export const addChildLinkService = async (parentId, { nim, sumber, hubungan }) => {
    if (!nim) throw new Error('NIM anak wajib diisi');
    const s = String(sumber || 'madrasah').trim();
    const h = hubungan || null;

    await db.execute({
        sql: 'INSERT IGNORE INTO parent_student_links (parent_id, student_nim, sumber, hubungan) VALUES (?, ?, ?, ?)',
        args: [parentId, String(nim).trim(), s, h]
    });

    // Sync nama + HP orang tua ke wali_murid
    const parent = await db.execute({
        sql: 'SELECT name, phone FROM parent_users WHERE id = ?',
        args: [parentId]
    });
    if (parent.rows.length) {
        const { name, phone } = parent.rows[0];
        await syncParentToWali(name, phone, nim, s, h);
    }

    return { parentId, nim };
};

// ============================================================================
// Keluarga berbasis KK (virtual grouping — 1 KK = 1 keluarga)
// ============================================================================

const normalizeKK = (v) => String(v || '').replace(/\D/g, '').trim();

/**
 * Cari semua anggota keluarga berdasarkan KK (lintas sumber madrasah/tpq).
 * KK disimpan di santri_biodata.kk (16 digit). Virtual grouping, tidak ada kolom parent_users.kk.
 */
export const findFamilyByKKService = async (kk) => {
    const kkDigits = normalizeKK(kk);
    if (!/^\d{16}$/.test(kkDigits)) throw new Error('No. KK harus 16 digit angka');
    const result = await db.execute({
        sql: `
            SELECT sb.nim, sb.sumber, sb.kk, sb.nama AS biodata_nama,
                   sp.id AS placement_id, sp.name AS placement_name, sp.classroom_id, sp.sumber AS placement_sumber,
                   c.class_name
            FROM santri_biodata sb
            JOIN santri_penempatan sp ON sb.nim = sp.nim AND sb.sumber = sp.sumber
            LEFT JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber
            WHERE sb.kk = ?
            ORDER BY sp.name ASC
        `,
        args: [kkDigits]
    });
    return { kk: kkDigits, members: result.rows };
};

/**
 * Preview keluarga dari satu NIM acuan: resolve KK dari santri_biodata lalu list anggota.
 */
export const previewFamilyByNimService = async (nim, sumber = null) => {
    if (!nim) throw new Error('NIM acuan wajib diisi');
    const n = String(nim).trim();
    let bio;
    if (sumber) {
        bio = await db.execute({ sql: 'SELECT kk, sumber FROM santri_biodata WHERE nim = ? AND sumber = ? LIMIT 1', args: [n, String(sumber).trim()] });
    } else {
        bio = await db.execute({ sql: 'SELECT kk, sumber FROM santri_biodata WHERE nim = ? LIMIT 1', args: [n] });
    }
    if (!bio.rows.length) throw new Error('Data biodata santri tidak ditemukan');
    const kkDigits = normalizeKK(bio.rows[0].kk);
    if (!/^\d{16}$/.test(kkDigits)) throw new Error('Santri acuan belum memiliki No. KK yang valid (16 digit). Gunakan hubungkan manual per anak.');
    return findFamilyByKKService(kkDigits);
};

/**
 * Hubungkan seluruh anggota keluarga (by KK) ke satu parent — explicit tombol.
 * Sumber telepon/wali diambil dari parent_users (sudah ada) dan disinkronkan ke wali_murid per anak via syncParentToWali.
 * Merge = INSERT IGNORE, jadi sudah terhubung tidak duplikat.
 */
export const linkFamilyByKKService = async (parentId, { nim, sumber, hubungan } = {}) => {
    if (!parentId) throw new Error('Parent ID wajib diisi');
    if (!nim) throw new Error('NIM acuan keluarga wajib diisi');

    const parent = await db.execute({ sql: 'SELECT id, name, phone FROM parent_users WHERE id = ?', args: [parentId] });
    if (!parent.rows.length) throw new Error('Akun orang tua tidak ditemukan');
    const { name: parentName, phone: parentPhone } = parent.rows[0];

    const preview = await previewFamilyByNimService(nim, sumber);
    const members = preview.members;
    if (!members.length) throw new Error('Tidak ada anggota keluarga dengan KK tersebut');

    // Cek existing links untuk hitung sudah terhubung vs baru
    const existing = await db.execute({ sql: 'SELECT student_nim, sumber FROM parent_student_links WHERE parent_id = ?', args: [parentId] });
    const existingSet = new Set(existing.rows.map(r => `${String(r.student_nim)}|${String(r.sumber)}`));

    const toLink = members.filter(m => !existingSet.has(`${String(m.nim)}|${String(m.sumber)}`));
    const alreadyLinked = members.length - toLink.length;

    if (!toLink.length) {
        return { kk: preview.kk, total: members.length, linked: 0, alreadyLinked, members };
    }

    const h = hubungan || null;
    const ops = toLink.map(m => ({
        sql: 'INSERT IGNORE INTO parent_student_links (parent_id, student_nim, sumber, hubungan) VALUES (?, ?, ?, ?)',
        args: [parentId, String(m.nim).trim(), String(m.sumber).trim(), h]
    }));
    await db.batch(ops, 'write');

    // Sinkron ke wali_murid per anak (serial karena per-anak UPDATE/INSERT berbeda)
    for (const m of toLink) {
        await syncParentToWali(parentName, parentPhone, m.nim, m.sumber, h);
    }

    return { kk: preview.kk, total: members.length, linked: toLink.length, alreadyLinked, members };
};

// Hapus link anak + bersihkan wali_murid
export const removeChildLinkService = async (parentId, linkId) => {
    // Ambil info link sebelum dihapus
    const link = await db.execute({
        sql: 'SELECT student_nim, sumber, hubungan FROM parent_student_links WHERE id = ? AND parent_id = ?',
        args: [linkId, parentId]
    });
    if (link.rows.length) {
        const { student_nim, sumber, hubungan } = link.rows[0];
        const parent = await db.execute({ sql: 'SELECT name, phone FROM parent_users WHERE id = ?', args: [parentId] });
        if (parent.rows.length) {
            await removeParentFromWali(parent.rows[0].name, parent.rows[0].phone, student_nim, sumber);
        }
    }

    await db.execute({
        sql: 'DELETE FROM parent_student_links WHERE id = ? AND parent_id = ?',
        args: [linkId, parentId]
    });
    return { linkId };
};
