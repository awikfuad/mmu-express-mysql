import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { resolveDateRange } from '../utils/dateRangeHelper.js';

export const getFinanceReportService = async ({ month, tanggal_mulai, tanggal_selesai } = {}, lembaga = 'ALL') => {
    // month diharapkan 'YYYY-MM' (contoh '2026-05'); rentang tanggal opsional lebih diutamakan
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });
    const currentMonth = month || new Date().toISOString().substring(0, 7);
    if (!range && !/^\d{4}-\d{2}$/.test(currentMonth)) throw new Error('Format bulan tidak valid! Gunakan YYYY-MM');

    // Kondisi periode untuk kolom datetime (created_at 'YYYY-MM-DD HH:MM:SS') & tanggal (date)
    const datetimePeriod = range
        ? { sql: 'substr(p.created_at, 1, 10) BETWEEN ? AND ?', args: [range.tanggal_mulai, range.tanggal_selesai] }
        : { sql: "DATE_FORMAT(p.created_at, '%Y-%m') = ?", args: [currentMonth] };
    const savingsPeriod = range
        ? { sql: 'substr(s.created_at, 1, 10) BETWEEN ? AND ?', args: [range.tanggal_mulai, range.tanggal_selesai] }
        : { sql: "DATE_FORMAT(s.created_at, '%Y-%m') = ?", args: [currentMonth] };
    const kasPeriod = range
        ? { sql: 't.date BETWEEN ? AND ?', args: [range.tanggal_mulai, range.tanggal_selesai] }
        : { sql: "DATE_FORMAT(t.date, '%Y-%m') = ?", args: [currentMonth] };
    const beforeDate = range ? range.tanggal_mulai : `${currentMonth}-01`;

    const s = getSumber(lembaga);
    // Scope transaksi keuangan: id santri mengacu tabel penempatan gabungan (batasi via sumber)
    const studentScope = s.isAll
        ? ""
        : `AND student_id IN (SELECT id FROM ${s.santriTable} WHERE ${s.sumberFilter})`;

    // Scope transaksi KAS (tabel transactions) berdasarkan lembaga
    const kasScope = s.isAll
        ? ''
        : "AND (LOWER(t.lembaga) = LOWER(?) OR t.lembaga IS NULL OR t.lembaga = '')";
    const kasScopeArgs = s.isAll ? [] : [s.lembaga];

    // 1. Hitung total pemasukan dari kasir iuran majemuk (payment_transactions)
    const paymentQuery = `
        SELECT 
            payment_type,
            CAST(SUM(amount) AS REAL) as total_amount,
            COUNT(id) as transaction_count
        FROM payment_transactions p
        WHERE ${datetimePeriod.sql}
        ${studentScope}
        GROUP BY payment_type
    `;
    const payments = await db.execute({ sql: paymentQuery, args: [...datetimePeriod.args] });

    // 2. Hitung rekap mutasi tabungan (savings_transactions)
    const savingsQuery = `
        SELECT 
            transaction_type,
            CAST(SUM(amount) AS REAL) as total_amount,
            COUNT(id) as transaction_count
        FROM savings_transactions s
        WHERE ${savingsPeriod.sql}
        ${studentScope}
        GROUP BY transaction_type
    `;
    const savings = await db.execute({ sql: savingsQuery, args: [...savingsPeriod.args] });

    // 3. Rekap KAS (tabel transactions — kas keluar/masuk manual)
    const kasQuery = `
        SELECT
            type,
            CAST(SUM(amount) AS REAL) AS total,
            COUNT(id) AS jumlah
        FROM transactions t
        WHERE ${kasPeriod.sql}
        ${kasScope}
        GROUP BY type
    `;
    const kas = await db.execute({ sql: kasQuery, args: [...kasPeriod.args, ...kasScopeArgs] });

    // Saldo awal kas (sebelum periode laporan) & saldo akhir
    const kasSaldoQuery = `
        SELECT
            COALESCE(SUM(CASE WHEN type = 'MASUK' THEN amount ELSE -amount END), 0) AS total
        FROM transactions t
        WHERE t.date < ?
        ${kasScope}
    `;
    const kasSaldoAwal = await db.execute({ sql: kasSaldoQuery, args: [beforeDate, ...kasScopeArgs] });

    const kasRows = kas.rows;
    const kasMasuk = kasRows.find(r => r.type === 'MASUK')?.total || 0;
    const kasKeluar = kasRows.find(r => r.type === 'KELUAR')?.total || 0;
    const kasSaldoAkhir = Number(kasSaldoAwal.rows[0]?.total || 0) + kasMasuk - kasKeluar;

    return {
        month: range ? `${range.tanggal_mulai} s/d ${range.tanggal_selesai}` : currentMonth,
        payments: payments.rows,
        savings: savings.rows,
        kas: {
            saldo_awal: Number(kasSaldoAwal.rows[0]?.total || 0),
            masuk: kasMasuk,
            keluar: kasKeluar,
            saldo_akhir: kasSaldoAkhir
        }
    };
};