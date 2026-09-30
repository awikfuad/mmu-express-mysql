import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Statistik ringkas untuk halaman Dashboard (Beranda)
// Semua data di-scope sesuai lembaga user secara dinamis (ALL / KODE_LEMBAGA spesifik).
export const getDashboardStatsService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const isAll = s.isAll;
    const targetLembaga = s.lembaga.toUpperCase();

    // Scope transaksi keuangan & santri terdaftar berbasis sumber/lembaga
    const studentScope = isAll 
        ? '' 
        : `AND student_id IN (SELECT id FROM ${s.santriTable} WHERE LOWER(sumber) = LOWER(?))`;
    const studentScopeArgs = isAll ? [] : [targetLembaga];

    // 1. Total Santri Aktif (tabel students / akun mobile)
    const studentsRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM students ${isAll ? '' : 'WHERE LOWER(lembaga) = LOWER(?)'}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalSantri = Number(studentsRes.rows[0]?.c || 0);

    // 2. Kas Tabungan Wadiah (saldo gabungan seluruh santri)
    const savingsRes = await db.execute({
        sql: `
            SELECT COALESCE(SUM(CASE WHEN transaction_type = 'SETORAN' THEN amount ELSE -amount END), 0) AS total
            FROM savings_transactions
            WHERE 1 = 1 ${studentScope}
        `,
        args: studentScopeArgs
    });
    const kasTabungan = Number(savingsRes.rows[0]?.total || 0);

    // 3. Iuran Terkumpul (bulan ini vs bulan lalu untuk kalkulasi pertumbuhan)
    const now = new Date();
    const curMonth = now.toISOString().substring(0, 7);
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = prevMonthDate.toISOString().substring(0, 7);

    const iuranThisRes = await db.execute({
        sql: `
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM payment_transactions
            WHERE DATE_FORMAT(created_at, '%Y-%m') = ? ${studentScope}
        `,
        args: [curMonth, ...studentScopeArgs]
    });
    const iuranPrevRes = await db.execute({
        sql: `
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM payment_transactions
            WHERE DATE_FORMAT(created_at, '%Y-%m') = ? ${studentScope}
        `,
        args: [prevMonth, ...studentScopeArgs]
    });
    const iuranTerkumpul = Number(iuranThisRes.rows[0]?.total || 0);
    const iuranBulanLalu = Number(iuranPrevRes.rows[0]?.total || 0);

    // 4. Rata-rata Presensi Kegiatan (persentase HADIR dari seluruh record absensi istighosah)
    const presensiScope = isAll 
        ? '' 
        : 'AND activity_id IN (SELECT id FROM kegiatan WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = \'all\')';
    const presensiRes = await db.execute({
        sql: `
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN status = 'HADIR' THEN 1 ELSE 0 END), 0) AS hadir
            FROM absensi_istighosah
            WHERE 1 = 1 ${presensiScope}
        `,
        args: isAll ? [] : [targetLembaga]
    });
    const pTotal = Number(presensiRes.rows[0]?.total || 0);
    const pHadir = Number(presensiRes.rows[0]?.hadir || 0);
    const rataPresensi = pTotal > 0 ? Math.round((pHadir / pTotal) * 1000) / 10 : 0;

    // 5. Tren Pendapatan per bulan Hijriah (7 bulan terakhir)
    const pendapatanRes = await db.execute({
        sql: `
            SELECT month, MAX(tahun) AS tahun, SUM(total) AS total, MAX(tgl) AS tgl
            FROM (
                SELECT month AS month, NULL AS tahun, COALESCE(SUM(amount), 0) AS total, MAX(created_at) AS tgl
                FROM payment_transactions
                WHERE month IS NOT NULL AND month <> '' ${studentScope}
                GROUP BY month
                UNION ALL
                SELECT bulan_hijriah AS month, tahun_hijriah AS tahun, COALESCE(SUM(amount), 0) AS total, MAX(created_at) AS tgl
                FROM savings_transactions
                WHERE transaction_type = 'SETORAN'
                  AND bulan_hijriah IS NOT NULL AND bulan_hijriah <> '' ${studentScope}
                GROUP BY bulan_hijriah, tahun_hijriah
            ) AS pendapatan_union
            GROUP BY month
            ORDER BY MAX(tgl) DESC
            LIMIT 7
        `,
        args: [...studentScopeArgs, ...studentScopeArgs]
    });
    const pendapatan = pendapatanRes.rows
        .map(r => ({ month: r.month, tahun: r.tahun, total: Number(r.total) }))
        .reverse();

    // 6. Rasio Kehadiran Kegiatan Terbaru (HADIR/IZIN/SAKIT/ALPA)
    const targetClause = "AND (target IS NULL OR target IN ('MURID', 'SEMUA'))";
    const whereClause = isAll
        ? `WHERE 1 = 1 ${targetClause}`
        : `WHERE (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all') ${targetClause}`;
    const kegiatanRes = await db.execute({
        sql: `
            SELECT id, activity_name, activity_date
            FROM kegiatan
            ${whereClause}
            ORDER BY activity_date DESC, id DESC
            LIMIT 1
        `,
        args: isAll ? [] : [targetLembaga]
    });
    const kehadiran = { HADIR: 0, IZIN: 0, SAKIT: 0, ALPA: 0 };
    let kegiatanTerbaru = null;
    if (kegiatanRes.rows.length > 0) {
        kegiatanTerbaru = kegiatanRes.rows[0];
        const kehadiranRes = await db.execute({
            sql: `
                SELECT status, COUNT(*) AS c
                FROM absensi_istighosah
                WHERE activity_id = ?
                GROUP BY status
            `,
            args: [kegiatanTerbaru.id]
        });
        kehadiranRes.rows.forEach(r => {
            if (kehadiran[r.status] !== undefined) kehadiran[r.status] = Number(r.c);
        });
    }

    // 7. Riwayat Transaksi Terbaru (pembayaran + tabungan)
    const namePayment = `
        COALESCE(
            (SELECT name FROM santri_penempatan WHERE id = pt.student_id LIMIT 1),
            (SELECT name FROM students WHERE id = pt.student_id LIMIT 1)
        )
    `;
    const nameSavings = `
        COALESCE(
            (SELECT name FROM santri_penempatan WHERE id = st.student_id LIMIT 1),
            (SELECT name FROM students WHERE id = st.student_id LIMIT 1)
        )
    `;
    const recentRes = await db.execute({
        sql: `
            SELECT * FROM (
                SELECT pt.created_at AS tgl, ${namePayment} AS nama, pt.payment_type AS tipe, pt.amount AS jumlah
                FROM payment_transactions pt
                WHERE 1 = 1 ${studentScope}
                UNION ALL
                SELECT st.created_at AS tgl, ${nameSavings} AS nama, st.transaction_type AS tipe, st.amount AS jumlah
                FROM savings_transactions st
                WHERE 1 = 1 ${studentScope}
            ) AS recent_union
            ORDER BY tgl DESC
            LIMIT 8
        `,
        args: [...studentScopeArgs, ...studentScopeArgs]
    });
    const recentTransactions = recentRes.rows.map(r => ({
        time: r.tgl,
        name: r.nama,
        type: r.tipe,
        amount: Number(r.jumlah),
        status: 'Sukses'
    }));

    // 7B. Riwayat Presensi Guru Terbaru
    const guruPresensiScope = isAll ? '' : 'AND (LOWER(k.lembaga) = LOWER(?) OR LOWER(k.lembaga) = \'all\')';
    const guruPresensiRes = await db.execute({
        sql: `
            SELECT kta.id, kta.status, kta.created_at AS tgl,
                   k.activity_name, k.activity_date,
                   t.name AS guru
            FROM kegiatan_teacher_attendances kta
            JOIN kegiatan k ON kta.kegiatan_id = k.id
            JOIN teachers t ON kta.teacher_id = t.id
            WHERE 1 = 1 ${guruPresensiScope}
            ORDER BY kta.created_at DESC, kta.id DESC
            LIMIT 8
        `,
        args: isAll ? [] : [targetLembaga]
    });
    const recentTeacherAttendance = guruPresensiRes.rows.map(r => ({
        time: r.tgl,
        guru: r.guru,
        kegiatan: r.activity_name,
        tanggalKegiatan: r.activity_date,
        status: r.status
    }));

    // 7C. Riwayat Presensi KBM Terbaru
    const kbmPresensiScope = isAll ? '' : 'AND LOWER(st.lembaga) = LOWER(?)';
    const kbmRes = await db.execute({
        sql: `
            SELECT a.date AS tanggal, a.session_name AS sesi, a.status, a.created_at AS tgl,
                   st.name AS siswa,
                   COALESCE((
                       SELECT c.class_name
                       FROM santri_penempatan sp
                       JOIN classes c ON c.id = sp.classroom_id
                       WHERE sp.student_id = st.id
                       ORDER BY sp.academic_year_id DESC, sp.id DESC
                       LIMIT 1
                   ), '') AS kelas
            FROM attendances a
            JOIN students st ON a.student_id = st.id
            WHERE 1 = 1 ${kbmPresensiScope}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 8
        `,
        args: isAll ? [] : [targetLembaga]
    });
    const recentKbmAttendance = kbmRes.rows.map(r => ({
        tanggal: r.tanggal,
        sesi: r.sesi,
        status: r.status,
        siswa: r.siswa,
        kelas: r.kelas,
        time: r.tgl
    }));

    // 8. Kehadiran HARI INI (KBM + Istighosah)
    const todayStr = now.toISOString().substring(0, 10);
    const kbmTodayRes = await db.execute({
        sql: `
            SELECT COUNT(*) AS c
            FROM attendances a
            JOIN students st ON a.student_id = st.id
            WHERE a.date = ? ${isAll ? '' : 'AND LOWER(st.lembaga) = LOWER(?)'}
        `,
        args: isAll ? [todayStr] : [todayStr, targetLembaga]
    });
    const istighosahTodayRes = await db.execute({
        sql: `
            SELECT COUNT(*) AS c 
            FROM absensi_istighosah 
            WHERE tanggal_absensi = ? ${presensiScope}
        `,
        args: isAll ? [todayStr] : [todayStr, targetLembaga]
    });
    const kbmHariIni = Number(kbmTodayRes.rows[0]?.c || 0);
    const istighosahHariIni = Number(istighosahTodayRes.rows[0]?.c || 0);

    // 9. Pemasukan Kas Bulan Ini
    const kasMasukRes = await db.execute({
        sql: `
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'MASUK' AND DATE_FORMAT(created_at, '%Y-%m') = ?
            ${isAll ? '' : 'AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = \'all\')'}
        `,
        args: isAll ? [curMonth] : [curMonth, targetLembaga]
    });
    const pemasukanKasBulanIni = Number(kasMasukRes.rows[0]?.total || 0);

    // 10. Jumlah Guru
    const guruRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM teachers ${isAll ? '' : 'WHERE LOWER(lembaga) IN (LOWER(?), \'all\')'}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalGuru = Number(guruRes.rows[0]?.c || 0);

    // 11. Jumlah Kelas & Rombel
    const kelasScope = isAll ? '' : 'WHERE LOWER(sumber) = LOWER(?) OR LOWER(sumber) = \'all\'';
    const kelasRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM classes ${kelasScope}`,
        args: isAll ? [] : [targetLembaga]
    });
    const rombelRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM rombels ${kelasScope}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalKelas = Number(kelasRes.rows[0]?.c || 0);
    const totalRombel = Number(rombelRes.rows[0]?.c || 0);

    // 12. Jumlah Murid Terdaftar
    const muridScope = isAll ? '' : 'WHERE LOWER(sumber) = LOWER(?)';
    const muridRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM ${s.santriTable} ${muridScope}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalMuridTerdaftar = Number(muridRes.rows[0]?.c || 0);

    // 13. Jumlah Kegiatan & Total Absensi Istighosah
    const kegiatanCountRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM kegiatan ${isAll ? '' : 'WHERE LOWER(lembaga) IN (LOWER(?), \'all\')'}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalKegiatan = Number(kegiatanCountRes.rows[0]?.c || 0);
    const absensiKegiatanRes = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM absensi_istighosah WHERE 1 = 1 ${presensiScope}`,
        args: isAll ? [] : [targetLembaga]
    });
    const totalAbsensiKegiatan = Number(absensiKegiatanRes.rows[0]?.c || 0);

    // 14. Total Absensi KBM tercatat
    const absensiKbmRes = await db.execute({
        sql: `
            SELECT COUNT(*) AS c
            FROM attendances a
            JOIN students st ON a.student_id = st.id
            WHERE 1 = 1 ${isAll ? '' : 'AND LOWER(st.lembaga) = LOWER(?)'}
        `,
        args: isAll ? [] : [targetLembaga]
    });
    const totalAbsensiKBM = Number(absensiKbmRes.rows[0]?.c || 0);

    // 15. Distribusi data per lembaga secara dinamis (Khusus Super Admin = ALL)
    const byLembaga = isAll ? await (async () => {
        const [muridRows, kelasRows, santriRows, guruRows] = await Promise.all([
            db.execute({ sql: `SELECT LOWER(sumber) AS key_name, COUNT(*) AS c FROM santri_penempatan GROUP BY LOWER(sumber)`, args: [] }),
            db.execute({ sql: `SELECT LOWER(sumber) AS key_name, COUNT(*) AS c FROM classes GROUP BY LOWER(sumber)`, args: [] }),
            db.execute({ sql: `SELECT LOWER(lembaga) AS key_name, COUNT(*) AS c FROM students GROUP BY LOWER(lembaga)`, args: [] }),
            db.execute({ sql: `SELECT LOWER(lembaga) AS key_name, COUNT(*) AS c FROM teachers GROUP BY LOWER(lembaga)`, args: [] })
        ]);

        const mapToDict = (rows) => {
            const dict = {};
            rows.rows.forEach(r => {
                if (r.key_name) dict[String(r.key_name).toUpperCase()] = Number(r.c || 0);
            });
            return dict;
        };

        return {
            murid: mapToDict(muridRows),
            kelas: mapToDict(kelasRows),
            santri: mapToDict(santriRows),
            guru: mapToDict(guruRows)
        };
    })() : null;

    return {
        lembaga: targetLembaga,
        summary: {
            totalSantri,
            kasTabungan,
            iuranTerkumpul,
            iuranBulanLalu,
            rataPresensi,
            kehadiranHariIni: kbmHariIni + istighosahHariIni,
            kbmHariIni,
            istighosahHariIni,
            pemasukanKasBulanIni,
            totalGuru,
            totalKelas,
            totalRombel,
            totalMuridTerdaftar,
            totalKegiatan,
            totalAbsensiKegiatan,
            totalAbsensiKBM
        },
        byLembaga,
        lastUpdated: new Date().toISOString(),
        pendapatan,
        kehadiran,
        kegiatanTerbaru,
        recentTransactions,
        recentTeacherAttendance,
        recentKbmAttendance
    };
};