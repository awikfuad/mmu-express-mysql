import db from '../config/db.js';
import { logAudit } from './auditService.js';
import { getSumber } from '../utils/lembagaHelper.js';

const getCtx = (lembaga) => getSumber(lembaga);

/**
 * Tutup Buku Tahunan — Snapshot saldo akhir + lock tahun + buat tahun baru + aktifkan.
 *
 * Alur:
 * 1. Validasi tahun aktif belum ditutup
 * 2. Snapshot saldo KAS per akun per lembaga (dari jurnal `transactions`)
 * 3. Snapshot saldo TABUNGAN per santri (dari `savings_transactions`)
 * 4. Snapshot rekap IURAN per tahun (dari `payment_transactions`)
 * 5. Tandai tahun ditutup (`is_closed = 1`)
 * 6. Buat tahun ajaran baru otomatis (next year)
 * 7. Aktifkan tahun baru
 * 8. Audit trail
 */

// Get summary data for a year before closing (preview) — terscope lembaga
export const getClosingPreviewService = async (yearId, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const year = await db.execute({
        sql: 'SELECT * FROM academic_years WHERE id = ?',
        args: [Number(yearId)]
    });
    if (year.rows.length === 0) throw new Error('Tahun ajaran tidak ditemukan');
    const y = year.rows[0];
    if (y.is_closed) throw new Error('Tahun ajaran sudah ditutup');

    // Scope: admin scoped hanya lembaganya (kas/berbagi ALL; iuran/tabungan via sumber sandri)
    const iuranScope = ctx.isAll ? '' : "pt.student_id IN (SELECT id FROM santri_penempatan WHERE sumber = ?)";
    const iuranArgs = ctx.isAll ? [Number(yearId)] : [Number(yearId), ctx.sumber];

    // Total iuran per type
    const iuranQuery = `
        SELECT payment_type, COUNT(*) AS jumlah, COALESCE(SUM(amount), 0) AS total
        FROM payment_transactions pt
        WHERE pt.academic_year_id = ?
        ${iuranScope ? `AND ${iuranScope}` : ''}
        GROUP BY payment_type
    `;
    const iuran = await db.execute({ sql: iuranQuery, args: iuranArgs });

    // Total kas per lembaga (kas = milik sendiri + ALL/shared). Scoped hanya lembaganya.
    const kasScopeClause = ctx.isAll
        ? ''
        : "AND (LOWER(t.lembaga) = LOWER(?) OR t.lembaga IS NULL OR t.lembaga = '')";
    const kasQuery = `
        SELECT 
            COALESCE(lembaga, 'ALL') AS lembaga,
            COUNT(*) AS jumlah,
            COALESCE(SUM(CASE WHEN type = 'MASUK' THEN amount ELSE 0 END), 0) AS total_masuk,
            COALESCE(SUM(CASE WHEN type = 'KELUAR' THEN amount ELSE 0 END), 0) AS total_keluar
        FROM transactions t
        WHERE (academic_year_id IS NULL OR academic_year_id = ?)
        ${kasScopeClause}
        GROUP BY COALESCE(lembaga, 'ALL')
    `;
    const kasArgs = ctx.isAll ? [Number(yearId)] : [Number(yearId), ctx.lembaga];
    const kas = await db.execute({ sql: kasQuery, args: kasArgs });

    // Total tabungan (student_id = santri_penempatan.id; scoped via sumber)
    const savingsScopeClause = ctx.isAll
        ? ''
        : "AND st.student_id IN (SELECT id FROM santri_penempatan WHERE sumber = ?)";
    const savingsQuery = `
        SELECT 
            COUNT(DISTINCT student_id) AS jumlah_siswa,
            COALESCE(SUM(CASE WHEN transaction_type = 'SETORAN' THEN amount ELSE 0 END), 0) AS total_setoran,
            COALESCE(SUM(CASE WHEN transaction_type = 'PENARIKAN' THEN amount ELSE 0 END), 0) AS total_penarikan
        FROM savings_transactions st
        WHERE 1 = 1
        ${savingsScopeClause}
    `;
    const savingsArgs = ctx.isAll ? [] : [ctx.sumber];
    const savings = await db.execute({ sql: savingsQuery, args: savingsArgs });

    // Jumlah guru dibayar (slip terscope lembaga sendiri + ALL)
    const salaryScopeClause = ctx.isAll ? '' : "AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all')";
    const salaryQuery = `
        SELECT COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS total_gaji
        FROM teacher_salaries
        WHERE period LIKE ?
        ${salaryScopeClause}
    `;
    // Get year period pattern from year_name (e.g., "2025/2026" → "2025-" or "2026-")
    const yearStart = y.year_name.split('/')[0];
    const salaryArgs = ctx.isAll ? [`${yearStart}%`] : [`${yearStart}%`, ctx.lembaga];
    const salary = await db.execute({ sql: salaryQuery, args: salaryArgs });

    return {
        year: y,
        lembaga: ctx.lembaga,
        sumber: ctx.sumber,
        iuran: iuran.rows,
        kas: kas.rows,
        savings: savings.rows[0] || { jumlah_siswa: 0, total_setoran: 0, total_penarikan: 0 },
        salary: salary.rows[0] || { jumlah: 0, total_gaji: 0 }
    };
};

// Execute closing — hanya boleh dijalankan Super Admin (ALL)
export const closeYearService = async (yearId, actorName, actorId, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    if (!ctx.isAll) {
        throw new Error('Hanya Super Admin (ALL) yang dapat menutup buku tahunan. Hubungi Super Admin.');
    }

    const year = await db.execute({
        sql: 'SELECT * FROM academic_years WHERE id = ?',
        args: [Number(yearId)]
    });
    if (year.rows.length === 0) throw new Error('Tahun ajaran tidak ditemukan');
    const y = year.rows[0];
    if (y.is_closed) throw new Error('Tahun ajaran sudah ditutup');
    if (!y.is_active) throw new Error('Hanya tahun aktif yang bisa ditutup. Aktifkan tahun ini terlebih dahulu.');

    const snapshotTime = new Date().toISOString();
    const statements = [];

    // 1. Snapshot KAS per akun per lembaga
    const kasPerAkunQuery = `
        SELECT 
            t.account_code,
            a.account_name,
            a.account_type,
            COALESCE(t.lembaga, 'ALL') AS lembaga,
            COALESCE(SUM(CASE WHEN t.type = 'MASUK' THEN t.amount ELSE 0 END), 0) AS total_masuk,
            COALESCE(SUM(CASE WHEN t.type = 'KELUAR' THEN t.amount ELSE 0 END), 0) AS total_keluar
        FROM transactions t
        LEFT JOIN accounts a ON a.account_code = t.account_code
        WHERE t.academic_year_id IS NULL OR t.academic_year_id = ?
        GROUP BY t.account_code, a.account_name, a.account_type, COALESCE(t.lembaga, 'ALL')
    `;
    const kasPerAkun = await db.execute({ sql: kasPerAkunQuery, args: [Number(yearId)] });

    for (const row of kasPerAkun.rows) {
        const closingBalance = row.total_masuk - row.total_keluar;
        statements.push({
            sql: `INSERT INTO year_closing_snapshots 
                    (academic_year_id, snapshot_type, account_code, lembaga, description, opening_balance, total_masuk, total_keluar, closing_balance)
                  VALUES (?, 'KAS', ?, ?, ?, 0, ?, ?, ?)`,
            args: [Number(yearId), row.account_code, row.lembaga, row.account_name || row.account_code, row.total_masuk, row.total_keluar, closingBalance]
        });
    }

    // 2. Snapshot TABUNGAN per santri
    // student_id kanonik = santri_penempatan.id; resolve nama/nim dari placement (fallback students).
    const savingsQuery = `
        SELECT 
            st.student_id,
            COALESCE(sp.nim, s.nim) AS nim,
            COALESCE(sp.name, s.name) AS student_name,
            COALESCE((SELECT UPPER(kode) FROM lembaga WHERE LOWER(sumber) = LOWER(sp.sumber)), 'ALL') AS lembaga,
            COALESCE(SUM(CASE WHEN st.transaction_type = 'SETORAN' THEN st.amount ELSE 0 END), 0) AS total_setoran,
            COALESCE(SUM(CASE WHEN st.transaction_type = 'PENARIKAN' THEN st.amount ELSE 0 END), 0) AS total_penarikan
        FROM savings_transactions st
        LEFT JOIN santri_penempatan sp ON st.student_id = sp.id
        LEFT JOIN students s ON st.student_id = s.id
        GROUP BY st.student_id, COALESCE(sp.nim, s.nim), COALESCE(sp.name, s.name), sp.sumber
        HAVING total_setoran > 0 OR total_penarikan > 0
    `;
    const savings = await db.execute({ sql: savingsQuery, args: [] });

    for (const row of savings.rows) {
        const balance = row.total_setoran - row.total_penarikan;
        statements.push({
            sql: `INSERT INTO year_closing_snapshots
                    (academic_year_id, snapshot_type, student_id, nim, description, opening_balance, total_masuk, total_keluar, closing_balance, lembaga)
                  VALUES (?, 'TABUNGAN', ?, ?, ?, 0, ?, ?, ?, ?)`,
            args: [Number(yearId), row.student_id, row.nim, row.student_name, row.total_setoran, row.total_penarikan, balance, row.lembaga || 'ALL']
        });
    }

    // 3. Snapshot IURAN per type per lembaga
    const iuranQuery = `
        SELECT 
            pt.payment_type,
            COALESCE((SELECT UPPER(kode) FROM lembaga WHERE LOWER(sumber) = LOWER(sp.sumber)), 'ALL') AS lembaga,
            COUNT(*) AS jumlah,
            COALESCE(SUM(pt.amount), 0) AS total
        FROM payment_transactions pt
        LEFT JOIN santri_penempatan sp ON pt.student_id = sp.id
        WHERE pt.academic_year_id = ?
        GROUP BY pt.payment_type, lembaga
    `;
    const iuran = await db.execute({ sql: iuranQuery, args: [Number(yearId)] });

    for (const row of iuran.rows) {
        statements.push({
            sql: `INSERT INTO year_closing_snapshots
                    (academic_year_id, snapshot_type, description, total_masuk, closing_balance, lembaga)
                  VALUES (?, 'IURAN', ?, ?, ?, ?)`,
            args: [Number(yearId), `Iuran ${row.payment_type}`, row.total, row.total, row.lembaga || 'ALL']
        });
    }

    // 4. Lock tahun + nonaktifkan
    statements.push({
        sql: `UPDATE academic_years SET is_closed = 1, is_active = 0, closed_at = ?, closed_by = ? WHERE id = ?`,
        args: [snapshotTime, actorName || 'admin', Number(yearId)]
    });

    // 5. Buat tahun baru otomatis
    const yearParts = y.year_name.split('/');
    const nextStart = parseInt(yearParts[0]) + 1;
    const nextEnd = parseInt(yearParts[1]) + 1;
    const nextYearName = `${nextStart}/${nextEnd}`;
    const nextSemester = 'IMDA 1';

    // Cek apakah tahun baru sudah ada
    const existingNew = await db.execute({
        sql: 'SELECT id FROM academic_years WHERE year_name = ? AND semester = ?',
        args: [nextYearName, nextSemester]
    });

    let newYearId;
    if (existingNew.rows.length > 0) {
        newYearId = existingNew.rows[0].id;
    } else {
        const insertResult = await db.execute({
            sql: 'INSERT INTO academic_years (year_name, semester, is_active) VALUES (?, ?, 1)',
            args: [nextYearName, nextSemester]
        });
        newYearId = insertResult.lastInsertRowid;
        // Nonaktifkan semua tahun lain
        await db.execute({ sql: 'UPDATE academic_years SET is_active = 0 WHERE id != ?', args: [newYearId] });
    }

    // 6. Nonaktifkan semua tahun lain dulu, lalu aktifkan tahun baru
    await db.execute('UPDATE academic_years SET is_active = 0');
    await db.execute({ sql: 'UPDATE academic_years SET is_active = 1 WHERE id = ?', args: [newYearId] });

    // 7. Jalankan semua snapshot + lock dalam batch
    // Karena better-sqlite3 synchronous, kita jalankan serial
    for (const stmt of statements) {
        await db.execute({ sql: stmt.sql, args: stmt.args });
    }

    // 8. Audit trail
    await logAudit({
        lembaga: 'ALL',
        actor_role: 'admin',
        actor_id: actorId || null,
        actor_name: actorName || 'admin',
        action: 'CLOSE_YEAR',
        module: 'TUTUP_BUKU',
        target_id: String(yearId),
        detail: `Menutup tahun ajaran ${y.year_name} (${y.semester}). Tahun baru ${nextYearName} (${nextSemester}) dibuat & diaktifkan.`
    });

    return {
        closed_year: { id: Number(yearId), year_name: y.year_name, semester: y.semester },
        new_year: { id: newYearId, year_name: nextYearName, semester: nextSemester },
        snapshot_count: statements.length - 2 // exclude lock + activate
    };
};

// Get closing snapshot for a year (report) — terscope lembaga
export const getClosingReportService = async (yearId, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const year = await db.execute({
        sql: 'SELECT * FROM academic_years WHERE id = ?',
        args: [Number(yearId)]
    });
    if (year.rows.length === 0) throw new Error('Tahun ajaran tidak ditemukan');

    const scopeClause = ctx.isAll
        ? ''
        : "AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all')";
    const snapArgs = ctx.isAll ? [Number(yearId)] : [Number(yearId), ctx.lembaga];
    const snapshots = await db.execute({
        sql: `SELECT * FROM year_closing_snapshots WHERE academic_year_id = ? ${scopeClause} ORDER BY snapshot_type, account_code, nim`,
        args: snapArgs
    });

    return {
        year: year.rows[0],
        lembaga: ctx.lembaga,
        snapshots: snapshots.rows
    };
};

// Get all years with closing status — snapshot_count terscope lembaga
export const getClosingHistoryService = async (lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const scopeClause = ctx.isAll
        ? ''
        : "AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all')";
    const args = ctx.isAll ? [] : [ctx.lembaga];
    const result = await db.execute({
        sql: `
            SELECT 
                ay.*,
                (SELECT COUNT(*) FROM year_closing_snapshots WHERE academic_year_id = ay.id ${scopeClause}) AS snapshot_count
            FROM academic_years ay
            ORDER BY ay.id DESC
        `,
        args
    });
    return result.rows;
};
