import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Menu Chart/Grafik (E.3) — data agregat untuk halaman analitik bertab:
// Santri, Kehadiran, Akademik, Keuangan, Kegiatan, Kesehatan. Semua terscope
// lembaga (super admin ALL melihat semua, admin terscope hanya lembaganya).

const PREDIKAT_PERILAKU = ['SANGAT_BAIK', 'BAIK', 'CUKUP', 'KURANG'];

// Klausa scope kolom `lembaga` strict: isAll → semua, scoped → lembaga sendiri
const buildLembagaCond = (isAll, lembaga, alias = '') => {
    if (isAll) return null;
    const a = alias ? `${alias}.` : '';
    return { sql: `${a}lembaga = ?`, args: [lembaga] };
};

// 6 bulan terakhir termasuk bulan berjalan, format YYYY-MM
const last6Months = () => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
};

const query = async (sql, args = []) => (await db.execute({ sql, args })).rows;

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

// ===== TAB SANTRI =====
const getSantriSection = async (isAll, lembaga) => {
    const s = getSumber(lembaga);
    // Semua lembaga kini dalam satu tabel penempatan; scope via kolom sumber
    const scopeSub = isAll ? 'WHERE status = 1' : `WHERE status = 1 AND ${s.sumberFilter}`;

    const per_jenjang = await query(`
        SELECT j.id AS jenjang_id, j.nama_jenjang, COUNT(*) AS jumlah
        FROM (SELECT jenjang_id FROM ${s.santriTable} ${scopeSub}) x
        LEFT JOIN jenjang j ON j.id = x.jenjang_id
        GROUP BY j.id, j.nama_jenjang
        ORDER BY j.id
    `);

    const per_kelas = await query(`
        SELECT c.class_name AS kelas, COUNT(*) AS jumlah
        FROM (SELECT classroom_id, sumber FROM ${s.santriTable} ${scopeSub}) x
        LEFT JOIN classes c ON c.id = x.classroom_id AND c.sumber = x.sumber
        GROUP BY kelas
        ORDER BY jumlah DESC
    `);

    const per_gender = await query(`
        SELECT COALESCE(NULLIF(TRIM(UPPER(jenis_kelamin)), ''), 'LAKI-LAKI') AS jenis_kelamin, COUNT(*) AS jumlah
        FROM (SELECT jenis_kelamin FROM ${s.santriTable} ${scopeSub}) x
        GROUP BY 1
        ORDER BY jumlah DESC
    `);

    const per_tahun = await query(`
        SELECT COALESCE(ay.year_name, 'Tanpa Tahun') AS year_name, COUNT(*) AS jumlah
        FROM (SELECT academic_year_id FROM ${s.santriTable} ${scopeSub}) x
        LEFT JOIN academic_years ay ON ay.id = x.academic_year_id
        GROUP BY year_name
        ORDER BY jumlah DESC
    `);

    return {
        total: per_jenjang.reduce((sum, r) => sum + num(r.jumlah), 0),
        per_jenjang,
        per_kelas,
        per_gender,
        per_tahun
    };
};

// ===== TAB KEHADIRAN (KBM) =====
const getAttendanceSection = async (isAll, lembaga) => {
    const scope = buildLembagaCond(isAll, lembaga, 's');
    const scopeSql = scope ? `WHERE ${scope.sql}` : '';
    const scopeArgs = scope ? scope.args : [];

    const months = last6Months();
    const placeholders = months.map(() => '?').join(',');
    const per_bulan = await query(`
        SELECT substr(a.date, 1, 7) AS bulan,
               COUNT(CASE WHEN a.status = 'HADIR' THEN 1 END) AS hadir,
               COUNT(CASE WHEN a.status = 'SAKIT' THEN 1 END) AS sakit,
               COUNT(CASE WHEN a.status = 'IZIN' THEN 1 END) AS izin,
               COUNT(CASE WHEN a.status = 'ALPA' THEN 1 END) AS alpa
        FROM attendances a
        JOIN students s ON s.id = a.student_id
        ${scopeSql ? scopeSql + ' AND' : 'WHERE'} substr(a.date, 1, 7) IN (${placeholders})
        GROUP BY substr(a.date, 1, 7)
    `, [...scopeArgs, ...months]);

    const bulanMap = {};
    for (const r of per_bulan) {
        bulanMap[r.bulan] = {
            bulan: r.bulan,
            hadir: num(r.hadir),
            sakit: num(r.sakit),
            izin: num(r.izin),
            alpa: num(r.alpa)
        };
    }
    const per_bulan_filled = months.map((m) => bulanMap[m] || { bulan: m, hadir: 0, sakit: 0, izin: 0, alpa: 0 });

    const status_total = await query(`
        SELECT a.status, COUNT(*) AS jumlah
        FROM attendances a
        JOIN students s ON s.id = a.student_id
        ${scopeSql}
        GROUP BY a.status
    `, scopeArgs);

    const hari_ini = await query(`
        SELECT COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN a.student_id END) AS hadir_hari_ini,
               COUNT(DISTINCT a.student_id) AS tercatat
        FROM attendances a
        JOIN students s ON s.id = a.student_id
        ${scopeSql ? scopeSql + ' AND' : 'WHERE'} a.date = ?
    `, [...scopeArgs, new Date().toISOString().slice(0, 10)]);

    const today = hari_ini[0] || {};
    const totalAbsensi = status_total.reduce((sum, r) => sum + num(r.jumlah), 0);

    return {
        per_bulan: per_bulan_filled,
        status_total,
        total_absensi: totalAbsensi,
        hadir_hari_ini: num(today.hadir_hari_ini),
        tercatat_hari_ini: num(today.tercatat)
    };
};

// ===== TAB AKADEMIK (Nilai & Perilaku) =====
const getAcademicSection = async (isAll, lembaga) => {
    const scope = buildLembagaCond(isAll, lembaga, 'n');
    const scopeSql = scope ? `WHERE ${scope.sql}` : '';
    const scopeArgs = scope ? scope.args : [];

    const nilai_per_mapel = await query(`
        SELECT COALESCE(sub.subject_name, 'Tanpa Mapel') AS subject_name,
               ROUND(AVG(n.nilai), 1) AS avg_nilai,
               COUNT(*) AS total_records
        FROM nilai_harian n
        LEFT JOIN subjects sub ON sub.id = n.subject_id
        ${scopeSql}
        GROUP BY sub.subject_name
        ORDER BY avg_nilai DESC
    `, scopeArgs);

    const distribusi_nilai = await query(`
        SELECT CASE
            WHEN n.nilai < 60 THEN '< 60'
            WHEN n.nilai < 70 THEN '60-69'
            WHEN n.nilai < 80 THEN '70-79'
            WHEN n.nilai < 90 THEN '80-89'
            ELSE '90-100' END AS bucket,
            COUNT(*) AS jumlah
        FROM nilai_harian n
        ${scopeSql}
        GROUP BY bucket
    `, scopeArgs);

    const scopeP = buildLembagaCond(isAll, lembaga, 'p');
    const scopeSqlP = scopeP ? `WHERE ${scopeP.sql}` : '';
    const scopeArgsP = scopeP ? scopeP.args : [];

    const aspek = {};
    for (const kolom of ['kerajinan', 'kedisiplinan', 'kebersihan']) {
        const rows = await query(`
            SELECT ${kolom} AS predikat, COUNT(*) AS jumlah
            FROM perilaku_murid p
            ${scopeSqlP ? scopeSqlP + ' AND' : 'WHERE'} ${kolom} IS NOT NULL AND TRIM(${kolom}) != ''
            GROUP BY ${kolom}
        `, scopeArgsP);
        const obj = {};
        for (const pr of PREDIKAT_PERILAKU) obj[pr] = 0;
        for (const r of rows) obj[r.predikat] = num(r.jumlah);
        aspek[kolom] = obj;
    }

    const nilaiCounts = {};
    for (const r of distribusi_nilai) nilaiCounts[r.bucket] = num(r.jumlah);

    return {
        nilai_per_mapel,
        distribusi_nilai: nilaiCounts,
        perilaku: aspek,
        total_nilai_records: distribusi_nilai.reduce((sum, r) => sum + num(r.jumlah), 0)
    };
};

// ===== TAB KEUANGAN (Iuran & Kas) =====
const getFinanceSection = async (isAll, lembaga) => {
    const s = getSumber(lembaga);
    const studentScopeSql = isAll ? '' : `WHERE pt.student_id IN (SELECT id FROM ${s.santriTable} WHERE ${s.sumberFilter})`;
    const months = last6Months();
    const placeholders = months.map(() => '?').join(',');

    const iuran_per_bulan = await query(`
        SELECT DATE_FORMAT(pt.created_at, '%Y-%m') AS bulan, SUM(pt.amount) AS total
        FROM payment_transactions pt
        ${studentScopeSql ? studentScopeSql + ' AND' : 'WHERE'} DATE_FORMAT(pt.created_at, '%Y-%m') IN (${placeholders})
        GROUP BY DATE_FORMAT(pt.created_at, '%Y-%m')
    `, months);

    const bulanMap = {};
    for (const r of iuran_per_bulan) bulanMap[r.bulan] = num(r.total);
    const iuran_per_bulan_filled = months.map((m) => ({ bulan: m, total: bulanMap[m] || 0 }));

    const iuran_by_type = await query(`
        SELECT pt.payment_type, SUM(pt.amount) AS total_amount, COUNT(*) AS jumlah
        FROM payment_transactions pt
        ${studentScopeSql}
        GROUP BY pt.payment_type
    `);

    const metode_bayar = await query(`
        SELECT pt.payment_method, SUM(pt.amount) AS total_amount, COUNT(*) AS jumlah
        FROM payment_transactions pt
        ${studentScopeSql}
        GROUP BY pt.payment_method
    `);

    const scopeK = buildLembagaCond(isAll, lembaga, 't');
    const scopeSqlK = scopeK ? `WHERE ${scopeK.sql}` : '';
    const scopeArgsK = scopeK ? scopeK.args : [];

    const kas_per_bulan = await query(`
        SELECT substr(t.date, 1, 7) AS bulan,
               SUM(CASE WHEN t.type = 'MASUK' THEN t.amount ELSE 0 END) AS masuk,
               SUM(CASE WHEN t.type = 'KELUAR' THEN t.amount ELSE 0 END) AS keluar
        FROM transactions t
        ${scopeSqlK ? scopeSqlK + ' AND' : 'WHERE'} substr(t.date, 1, 7) IN (${placeholders})
        GROUP BY substr(t.date, 1, 7)
    `, [...scopeArgsK, ...months]);

    const kasMap = {};
    for (const r of kas_per_bulan) {
        kasMap[r.bulan] = { bulan: r.bulan, masuk: num(r.masuk), keluar: num(r.keluar) };
    }
    const kas_per_bulan_filled = months.map((m) => kasMap[m] || { bulan: m, masuk: 0, keluar: 0 });

    return {
        iuran_per_bulan: iuran_per_bulan_filled,
        iuran_by_type,
        metode_bayar,
        kas_per_bulan: kas_per_bulan_filled
    };
};

// ===== TAB KEGIATAN (Istighosah — santri & guru) =====
const getKegiatanSection = async (isAll, lembaga) => {
    // Kegiatan mengikuti konvensi kegiatanService: scoped → lembaga sendiri + ALL
    const scope = buildLembagaCond(isAll, lembaga, 'k');
    const scopeSql = scope ? `WHERE ${scope.sql.replace('k.lembaga = ?', "k.lembaga IN (?, 'ALL')")}` : '';
    const scopeArgs = scope ? scope.args : [];

    const per_kegiatan = await query(`
        SELECT k.id AS kegiatan_id, k.activity_name, k.activity_date,
               COUNT(CASE WHEN ai.status = 'HADIR' THEN 1 END) AS hadir,
               COUNT(CASE WHEN ai.status = 'SAKIT' THEN 1 END) AS sakit,
               COUNT(CASE WHEN ai.status = 'IZIN' THEN 1 END) AS izin,
               COUNT(CASE WHEN ai.status = 'ALPA' THEN 1 END) AS alpa,
               COUNT(*) AS total
        FROM absensi_istighosah ai
        JOIN kegiatan k ON k.id = ai.activity_id
        ${scopeSql}
        GROUP BY k.id, k.activity_name, k.activity_date
        ORDER BY k.activity_date DESC
    `, scopeArgs);

    const status_total = await query(`
        SELECT ai.status, COUNT(*) AS jumlah
        FROM absensi_istighosah ai
        JOIN kegiatan k ON k.id = ai.activity_id
        ${scopeSql}
        GROUP BY ai.status
    `, scopeArgs);

    const guru_per_kegiatan = await query(`
        SELECT k.id AS kegiatan_id, k.activity_name, k.activity_date,
               COUNT(CASE WHEN kta.status = 'HADIR' THEN 1 END) AS hadir,
               COUNT(*) AS total
        FROM kegiatan_teacher_attendances kta
        JOIN kegiatan k ON k.id = kta.kegiatan_id
        ${scopeSql}
        GROUP BY k.id, k.activity_name, k.activity_date
        ORDER BY k.activity_date DESC
    `, scopeArgs);

    return { per_kegiatan, status_total, guru_per_kegiatan };
};

// ===== TAB KESEHATAN (Siswi Haid) =====
const getHealthSection = async (isAll, lembaga) => {
    const s = getSumber(lembaga);
    const joinSql = isAll ? '' : `JOIN ${s.santriTable} mk ON mk.nim = sh.nim AND ${s.sumberFilter}`;

    const per_bulan = await query(`
        SELECT substr(sh.tanggal_mulai_haid, 1, 7) AS bulan, COUNT(*) AS jumlah
        FROM siswi_haid sh
        ${joinSql}
        GROUP BY substr(sh.tanggal_mulai_haid, 1, 7)
        ORDER BY bulan
    `);

    const per_kelas = await query(`
        SELECT sh.kelas, COUNT(*) AS jumlah
        FROM siswi_haid sh
        ${joinSql}
        GROUP BY sh.kelas
        ORDER BY jumlah DESC
    `);

    const status = await query(`
        SELECT sh.status, COUNT(*) AS jumlah
        FROM siswi_haid sh
        ${joinSql}
        GROUP BY sh.status
    `);

    return {
        total: per_bulan.reduce((sum, r) => sum + num(r.jumlah), 0),
        per_bulan,
        per_kelas,
        status
    };
};

// Rekap Analitik & Grafik (E.3)
export const getAnalyticsService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);

    const safe = async (fn) => {
        try {
            return await fn();
        } catch (error) {
            console.error('EROR SECTION ANALITIK:', error.message);
            return null;
        }
    };

    const [santri, kehadiran, akademik, keuangan, kegiatan, kesehatan] = await Promise.all([
        safe(() => getSantriSection(s.isAll, s.lembaga)),
        safe(() => getAttendanceSection(s.isAll, s.lembaga)),
        safe(() => getAcademicSection(s.isAll, s.lembaga)),
        safe(() => getFinanceSection(s.isAll, s.lembaga)),
        safe(() => getKegiatanSection(s.isAll, s.lembaga)),
        safe(() => getHealthSection(s.isAll, s.lembaga))
    ]);

    return {
        lembaga: s.lembaga,
        generated_at: new Date().toISOString(),
        sections: { santri, kehadiran, akademik, keuangan, kegiatan, kesehatan }
    };
};
