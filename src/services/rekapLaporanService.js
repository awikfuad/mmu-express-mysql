import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { resolveDateRange } from '../utils/dateRangeHelper.js';
import { getActiveAcademicYearIdService } from './paymentSettingService.js';
import { getRekapAbsensiService } from './rekapAbsensiService.js';
import { getTunggakanIuranService, BULAN_NAMES } from './tunggakanIuranService.js';
import { getKasReportService } from './kasService.js';
import { getFinanceReportService } from './reportService.js';

// Rekap Laporan Terpadu (E.2) — rangkum presensi, nilai, perilaku, iuran,
// kas, keuangan & inventaris dengan filter konsisten (tahun ajaran, bulan,
// kelas, jenjang) dan terscope lembaga.

const PREDIKAT = ['SANGAT_BAIK', 'BAIK', 'CUKUP', 'KURANG'];

const resolveFilter = async ({ academic_year_id, bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id }, lembaga) => {
    let yearId = academic_year_id ? Number(academic_year_id) : null;
    if (!yearId) yearId = await getActiveAcademicYearIdService();

    // Rentang tanggal (YYYY-MM-DD) lebih diutamakan; fallback bulan (YYYY-MM).
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });
    const is_range = !!range;
    let startDate = null;
    let endDate = null;
    let bulanFinal = null;
    if (range) {
        startDate = range.tanggal_mulai;
        endDate = range.tanggal_selesai;
        // Bulan representatif = bulan tanggal akhir rentang (dipakai section berbasis bulan, mis. iuran)
        bulanFinal = endDate.slice(0, 7);
    } else {
        bulanFinal = bulan ? String(bulan).trim() : new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(bulanFinal)) {
            throw new Error('Format bulan tidak valid! Gunakan YYYY-MM');
        }
        const [tahun, bulanNum] = bulanFinal.split('-').map(Number);
        if (tahun < 2000 || tahun > 2100 || bulanNum < 1 || bulanNum > 12) {
            throw new Error('Bulan tidak valid! Gunakan rentang 2000-2100 dan 01-12');
        }
        startDate = `${bulanFinal}-01`;
        endDate = `${bulanFinal}-${String(new Date(tahun, bulanNum, 0).getDate()).padStart(2, '0')}`;
    }
    const [tahun, bulanNum] = bulanFinal.split('-').map(Number);

    let yearName = null;
    if (yearId) {
        const yr = await db.execute({ sql: 'SELECT year_name FROM academic_years WHERE id = ?', args: [yearId] });
        if (yr.rows.length) yearName = yr.rows[0].year_name;
    }

    let classroomName = null;
    if (classroom_id) {
        const cr = await db.execute({ sql: 'SELECT class_name FROM classes WHERE id = ?', args: [Number(classroom_id)] });
        if (cr.rows.length) classroomName = cr.rows[0].class_name;
    }

    let jenjangName = null;
    if (jenjang_id) {
        const jr = await db.execute({ sql: 'SELECT nama_jenjang FROM jenjang WHERE id = ?', args: [Number(jenjang_id)] });
        if (jr.rows.length) jenjangName = jr.rows[0].nama_jenjang;
    }

    return {
        academic_year_id: yearId,
        year_name: yearName,
        bulan: bulanFinal,
        bulan_nama: BULAN_NAMES[bulanNum - 1],
        tanggal_mulai: startDate,
        tanggal_selesai: endDate,
        range_label: `${startDate} s/d ${endDate}`,
        is_range,
        classroom_id: classroom_id ? Number(classroom_id) : null,
        classroom_name: classroomName,
        jenjang_id: jenjang_id ? Number(jenjang_id) : null,
        jenjang_name: jenjangName,
        lembaga
    };
};

// Klausa scope kolom `lembaga`: admin super (ALL) melihat semua, admin
// terscope hanya lembaganya (konsisten dgn prestasi/inventaris/wali)
const buildLembagaCond = (isAll, lembaga, alias = '') => {
    if (isAll) return null;
    const a = alias ? `${alias}.` : '';
    return { sql: `${a}lembaga = ?`, args: [lembaga] };
};

// Rekap nilai harian per mapel pada rentang tanggal (fallback: bulan berjalan)
const getNilaiSection = async ({ bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id }, isAll, lembaga) => {
    const conds = [];
    const args = [];
    if (tanggal_mulai) {
        conds.push('n.tanggal BETWEEN ? AND ?');
        args.push(tanggal_mulai, tanggal_selesai);
    } else {
        conds.push(`substr(n.tanggal, 1, 7) = ?`);
        args.push(bulan);
    }
    const scope = buildLembagaCond(isAll, lembaga, 'n');
    if (scope) {
        conds.push(scope.sql);
        args.push(...scope.args);
    }
    if (classroom_id) {
        conds.push('n.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (jenjang_id) {
        conds.push('n.jenjang_id = ?');
        args.push(Number(jenjang_id));
    }

    const res = await db.execute({
        sql: `
            SELECT sub.id AS subject_id, sub.subject_name,
                   COUNT(n.id) AS total_records,
                   CAST(SUM(n.nilai) AS REAL) AS total_nilai,
                   CAST(AVG(n.nilai) AS REAL) AS avg_nilai
            FROM nilai_harian n
            LEFT JOIN subjects sub ON sub.id = n.subject_id
            WHERE ${conds.join(' AND ')}
            GROUP BY sub.id, sub.subject_name
            ORDER BY avg_nilai DESC
        `,
        args
    });

    const rows = res.rows.map((r) => ({
        subject_id: r.subject_id,
        subject_name: r.subject_name || 'Tanpa Mapel',
        total_records: Number(r.total_records) || 0,
        avg_nilai: r.avg_nilai !== null ? Math.round(Number(r.avg_nilai) * 100) / 100 : null
    }));

    const totalRecords = rows.reduce((s, r) => s + r.total_records, 0);
    const avgAll = totalRecords > 0
        ? Math.round((rows.reduce((s, r) => s + (r.avg_nilai || 0) * r.total_records, 0) / totalRecords) * 100) / 100
        : null;

    return { data: rows, summary: { total_records: totalRecords, avg_nilai: avgAll } };
};

// Rekap perilaku murid (3 aspek) pada rentang tanggal (fallback: bulan berjalan)
const getPerilakuSection = async ({ bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id }, isAll, lembaga) => {
    const conds = [];
    const args = [];
    if (tanggal_mulai) {
        conds.push('p.tanggal BETWEEN ? AND ?');
        args.push(tanggal_mulai, tanggal_selesai);
    } else {
        conds.push(`substr(p.tanggal, 1, 7) = ?`);
        args.push(bulan);
    }
    const scope = buildLembagaCond(isAll, lembaga, 'p');
    if (scope) {
        conds.push(scope.sql);
        args.push(...scope.args);
    }
    if (classroom_id) {
        conds.push('p.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (jenjang_id) {
        conds.push('p.jenjang_id = ?');
        args.push(Number(jenjang_id));
    }

    const res = await db.execute({
        sql: `
            SELECT COUNT(p.id) AS total_records,
                   ${PREDIKAT.map((pr) => `SUM(CASE WHEN p.kerajinan = '${pr}' THEN 1 ELSE 0 END)`).join(', ')}
                   ,
                   ${PREDIKAT.map((pr) => `SUM(CASE WHEN p.kedisiplinan = '${pr}' THEN 1 ELSE 0 END)`).join(', ')}
                   ,
                   ${PREDIKAT.map((pr) => `SUM(CASE WHEN p.kebersihan = '${pr}' THEN 1 ELSE 0 END)`).join(', ')}
            FROM perilaku_murid p
            WHERE ${conds.join(' AND ')}
        `,
        args
    });

    const row = res.rows[0] || {};
    const kolom = {
        kerajinan: PREDIKAT.map((_, i) => i),
        kedisiplinan: PREDIKAT.map((_, i) => i + PREDIKAT.length),
        kebersihan: PREDIKAT.map((_, i) => i + PREDIKAT.length * 2)
    };

    const build = (offsets) => {
        const obj = {};
        offsets.forEach((i, idx) => {
            obj[PREDIKAT[idx]] = Number(row[i]) || 0;
        });
        return obj;
    };

    return {
        total_records: Number(row.total_records) || 0,
        kerajinan: build(kolom.kerajinan),
        kedisiplinan: build(kolom.kedisiplinan),
        kebersihan: build(kolom.kebersihan)
    };
};

// Rekap inventaris / aset (kondisi + nilai)
const getInventarisSection = async (isAll, lembaga) => {
    const scope = buildLembagaCond(isAll, lembaga);
    const whereClause = scope ? `WHERE ${scope.sql}` : '';
    const res = await db.execute({
        sql: `
            SELECT COUNT(id) AS total_item,
                   CAST(COALESCE(SUM(jumlah), 0) AS SIGNED) AS total_jumlah,
                   CAST(COALESCE(SUM(nilai), 0) AS REAL) AS total_nilai,
                   CAST(COALESCE(SUM(CASE WHEN kondisi = 'BAIK' THEN jumlah ELSE 0 END), 0) AS SIGNED) AS j_baik,
                   CAST(COALESCE(SUM(CASE WHEN kondisi = 'RUSAK_RINGAN' THEN jumlah ELSE 0 END), 0) AS SIGNED) AS j_ringan,
                   CAST(COALESCE(SUM(CASE WHEN kondisi = 'RUSAK_BERAT' THEN jumlah ELSE 0 END), 0) AS SIGNED) AS j_berat,
                   CAST(COALESCE(SUM(CASE WHEN kondisi = 'HILANG' THEN jumlah ELSE 0 END), 0) AS SIGNED) AS j_hilang
            FROM inventaris_aset
            ${whereClause}
        `,
        args: scope ? scope.args : []
    });

    const row = res.rows[0] || {};
    return {
        total_item: Number(row.total_item) || 0,
        total_jumlah: Number(row.total_jumlah) || 0,
        total_nilai: Number(row.total_nilai) || 0,
        per_kondisi: {
            BAIK: Number(row.j_baik) || 0,
            RUSAK_RINGAN: Number(row.j_ringan) || 0,
            RUSAK_BERAT: Number(row.j_berat) || 0,
            HILANG: Number(row.j_hilang) || 0
        }
    };
};

// Rekap Laporan Terpadu (E.2)
export const getRekapLaporanService = async ({ academic_year_id, bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id }, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const filter = await resolveFilter({ academic_year_id, bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id }, s.lembaga);
    const period = {
        bulan: filter.bulan,
        tanggal_mulai: filter.tanggal_mulai,
        tanggal_selesai: filter.tanggal_selesai
    };

    // Setiap section dihitung mandiri; bila gagal (mis. belum ada tahun ajaran
    // aktif utk iuran) section di-null-kan agar rekap lainnya tetap tersaji.
    const safe = async (fn) => {
        try {
            return await fn();
        } catch (error) {
            console.error('EROR SECTION REKAP LAPORAN:', error.message);
            return null;
        }
    };

    const [presensi, nilai, perilaku, iuran, kas, keuangan, inventaris] = await Promise.all([
        safe(async () => {
            const { summary } = await getRekapAbsensiService({ ...period, classroom_id, jenjang_id }, s.lembaga);
            return { summary };
        }),
        safe(async () => getNilaiSection({ ...period, classroom_id, jenjang_id }, s.isAll, s.lembaga)),
        safe(async () => getPerilakuSection({ ...period, classroom_id, jenjang_id }, s.isAll, s.lembaga)),
        safe(async () => {
            // Iuran bersifat bulanan — gunakan bulan representatif (akhir rentang) bila berupa rentang
            const { summary } = await getTunggakanIuranService(
                { academic_year_id: filter.academic_year_id, bulan: filter.bulan_nama, classroom_id, jenjang_id },
                s.lembaga
            );
            return { summary };
        }),
        safe(async () => {
            const r = await getKasReportService(
                filter.is_range ? { tanggal_mulai: filter.tanggal_mulai, tanggal_selesai: filter.tanggal_selesai } : { month: filter.bulan },
                s.lembaga
            );
            return {
                month: r.month,
                saldo_awal: r.saldo_awal,
                total_masuk: r.total_masuk,
                total_keluar: r.total_keluar,
                saldo_akhir: r.saldo_akhir
            };
        }),
        safe(async () => {
            const r = await getFinanceReportService(
                filter.is_range ? { tanggal_mulai: filter.tanggal_mulai, tanggal_selesai: filter.tanggal_selesai } : { month: filter.bulan },
                s.lembaga
            );
            return { month: r.month, payments: r.payments, savings: r.savings };
        }),
        safe(async () => getInventarisSection(s.isAll, s.lembaga))
    ]);

    return {
        filter,
        sections: { presensi, nilai, perilaku, iuran, kas, keuangan, inventaris }
    };
};
