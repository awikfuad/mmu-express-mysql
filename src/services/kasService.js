import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { resolveDateRange } from '../utils/dateRangeHelper.js';

const getCtx = (lembaga) => getSumber(lembaga);

// Scope WHERE lembaga untuk query akun/jurnal
const scopeWhere = (ctx, alias = '') => {
    const a = alias ? `${alias}.` : '';
    if (ctx.isAll) return '';
    return `WHERE (LOWER(${a}lembaga) = LOWER(?) OR LOWER(${a}lembaga) = 'all')`;
};

// ============================================================================
// MASTER AKUN (CHART OF ACCOUNTS)
// ============================================================================

export const getAccountsService = async (lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const whereClause = scopeWhere(ctx);
    const args = ctx.isAll ? [] : [ctx.lembaga];
    const result = await db.execute({
        sql: `SELECT id, account_code, account_name, account_type, lembaga, is_system, created_at
              FROM accounts ${whereClause} ORDER BY account_code ASC`,
        args
    });
    return result.rows;
};

export const createAccountService = async ({ account_code, account_name, account_type }, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const code = String(account_code || '').trim();
    const name = String(account_name || '').trim();
    const type = String(account_type || '').trim().toUpperCase();

    if (!code) throw new Error('Kode akun wajib diisi');
    if (!name) throw new Error('Nama akun wajib diisi');
    if (!['KAS', 'BANK', 'PIUTANG', 'PENDAPATAN', 'BEBAN'].includes(type)) {
        throw new Error('Tipe akun tidak valid! Pilih: KAS, BANK, PIUTANG, PENDAPATAN, BEBAN');
    }

    const exists = await db.execute({ sql: 'SELECT id FROM accounts WHERE account_code = ?', args: [code] });
    if (exists.rows.length > 0) throw new Error(`Kode akun ${code} sudah digunakan`);

    const result = await db.execute({
        sql: 'INSERT INTO accounts (account_code, account_name, account_type, lembaga, is_system) VALUES (?, ?, ?, ?, 0)',
        args: [code, name, type, ctx.lembaga]
    });
    return { id: result.lastInsertRowid, account_code: code, account_name: name, account_type: type, lembaga: ctx.lembaga };
};

export const updateAccountService = async (id, { account_code, account_name, account_type }, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const updates = [];
    const args = [];
    if (account_code) {
        const code = String(account_code).trim();
        const dup = await db.execute({
            sql: 'SELECT id FROM accounts WHERE account_code = ? AND id != ?',
            args: [code, Number(id)]
        });
        if (dup.rows.length > 0) throw new Error(`Kode akun ${code} sudah digunakan`);
        updates.push('account_code = ?');
        args.push(code);
    }
    if (account_name) { updates.push('account_name = ?'); args.push(String(account_name).trim()); }
    if (account_type) {
        const type = String(account_type).toUpperCase();
        if (!['KAS', 'BANK', 'PIUTANG', 'PENDAPATAN', 'BEBAN'].includes(type)) {
            throw new Error('Tipe akun tidak valid!');
        }
        updates.push('account_type = ?');
        args.push(type);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : "id = ? AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all')";
    args.push(Number(id));
    if (!ctx.isAll) { args.push(ctx.lembaga); args.push('ALL'); }

    const result = await db.execute({
        sql: `UPDATE accounts SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    if (result.rowsAffected === 0) throw new Error('Akun tidak ditemukan');
    return { id: Number(id) };
};

export const deleteAccountService = async (id, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const account = await db.execute({ sql: 'SELECT is_system, lembaga FROM accounts WHERE id = ?', args: [Number(id)] });
    if (account.rows.length === 0) throw new Error('Akun tidak ditemukan');
    if (account.rows[0].is_system === 1) throw new Error('Akun sistem tidak dapat dihapus');
    if (!ctx.isAll && String(account.rows[0].lembaga || '').toLowerCase() !== String(ctx.lembaga).toLowerCase()) throw new Error('Akun di luar lembaga Anda');

    const used = await db.execute({ sql: 'SELECT COUNT(*) AS c FROM transactions WHERE account_code = (SELECT account_code FROM accounts WHERE id = ?)', args: [Number(id)] });
    if (used.rows[0].c > 0) throw new Error('Akun sudah dipakai di transaksi, tidak dapat dihapus');

    const result = await db.execute({ sql: 'DELETE FROM accounts WHERE id = ?', args: [Number(id)] });
    return result.rowsAffected > 0;
};

// ============================================================================
// JURNAL / TRANSAKSI KAS
// ============================================================================

// List jurnal kas (filter rentang tanggal ATAU bulan YYYY-MM, + account_code), terscope lembaga
export const getKasTransactionsService = async ({ month, account_code, tanggal_mulai, tanggal_selesai } = {}, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const conditions = [];
    const args = [];
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });
    if (range) {
        conditions.push('t.date BETWEEN ? AND ?');
        args.push(range.tanggal_mulai, range.tanggal_selesai);
    } else if (month) {
        conditions.push("substr(t.date, 1, 7) = ?");
        args.push(month);
    }
    if (account_code) {
        conditions.push('t.account_code = ?');
        args.push(account_code);
    }
    if (!ctx.isAll) {
        conditions.push("(LOWER(t.lembaga) = LOWER(?) OR t.lembaga IS NULL OR t.lembaga = '')");
        args.push(ctx.lembaga);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT t.id, t.academic_year_id, t.date, t.account_code, t.description, t.type, t.amount,
               t.notes, t.lembaga, t.created_at, t.posted_by,
               a.account_name, a.account_type
        FROM transactions t
        LEFT JOIN accounts a ON a.account_code = t.account_code
        ${whereClause}
        ORDER BY t.date DESC, t.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Input transaksi kas keluar/masuk (validasi akun & saldo kas untuk tipe KELUAR)
export const createKasTransactionService = async ({ academic_year_id, date, account_code, description, type, amount, notes }, lembaga = 'ALL', postedBy = null) => {
    const ctx = getCtx(lembaga);
    const tipe = String(type || '').toUpperCase();
    if (!['MASUK', 'KELUAR'].includes(tipe)) throw new Error('Tipe transaksi harus MASUK atau KELUAR');
    const nominal = Number(amount);
    if (!Number.isFinite(nominal) || nominal <= 0) throw new Error('Nominal harus lebih besar dari Rp 0');
    if (!account_code) throw new Error('Akun wajib diisi');
    if (!String(description || '').trim()) throw new Error('Keterangan wajib diisi');

    const account = await db.execute({ sql: 'SELECT account_code, lembaga FROM accounts WHERE account_code = ?', args: [account_code] });
    if (account.rows.length === 0) throw new Error('Akun tidak ditemukan');
    const accLembaga = account.rows[0].lembaga || 'ALL';
    if (!ctx.isAll && accLembaga.toUpperCase() !== 'ALL' && accLembaga.toUpperCase() !== String(ctx.lembaga).toUpperCase()) {
        throw new Error('Akun di luar lembaga Anda');
    }

    if (tipe === 'KELUAR') {
        // Pengecekan saldo kas menyeluruh (total MASUK - KELUAR) milik lembaga tsb
        const saldo = await getSaldoKasService(ctx.lembaga);
        if (saldo < nominal) {
            throw new Error(`Saldo kas tidak mencukupi! Saldo saat ini: Rp ${Number(saldo).toLocaleString('id-ID')}`);
        }
    }

    const result = await db.execute({
        sql: `INSERT INTO transactions (academic_year_id, date, account_code, description, type, amount, notes, lembaga, posted_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            academic_year_id ? Number(academic_year_id) : null,
            date || new Date().toISOString().slice(0, 10),
            account_code,
            String(description).trim(),
            tipe,
            nominal,
            notes || null,
            ctx.lembaga,
            postedBy
        ]
    });
    return { id: result.lastInsertRowid, type: tipe, amount: nominal, account_code };
};

// Hapus jurnal kas
export const deleteKasTransactionService = async (id, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : "id = ? AND (LOWER(lembaga) = LOWER(?) OR lembaga IS NULL OR lembaga = '')";
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({ sql: `DELETE FROM transactions WHERE ${whereClause}`, args });
    return result.rowsAffected > 0;
};

// Saldo kas per akun (opsional) hingga bulan tertentu
export const getSaldoKasService = async (lembaga = 'ALL', untilMonth = null, accountCode = null) => {
    const conditions = [];
    const args = [];
    if (!getSumber(lembaga).isAll) {
        conditions.push("(LOWER(lembaga) = LOWER(?) OR lembaga IS NULL OR lembaga = '')");
        args.push(lembaga);
    }
    if (accountCode) {
        conditions.push('account_code = ?');
        args.push(accountCode);
    }
    if (untilMonth) {
        conditions.push('date <= ?');
        args.push(`${untilMonth}-31`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT
            COALESCE(SUM(CASE WHEN type = 'MASUK' THEN amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN type = 'KELUAR' THEN amount ELSE 0 END), 0) AS saldo
        FROM transactions ${whereClause}
    `;
    const result = await db.execute({ sql: query, args });
    return Number(result.rows[0].saldo || 0);
};

// Rekonsiliasi KAS: saldo awal, total masuk, total keluar, saldo akhir + rincian per akun.
// Filter rentang tanggal (YYYY-MM-DD) ATAU bulan (YYYY-MM).
export const getKasReportService = async ({ month, tanggal_mulai, tanggal_selesai } = {}, lembaga = 'ALL') => {
    const ctx = getCtx(lembaga);
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });

    let bulan = month || new Date().toISOString().slice(0, 7);
    if (!range && !/^\d{4}-\d{2}$/.test(bulan)) throw new Error('Format bulan tidak valid! Gunakan YYYY-MM');
    if (!range) {
        const [tahun, bulanNum] = bulan.split('-').map(Number);
        if (tahun < 2000 || tahun > 2100 || bulanNum < 1 || bulanNum > 12) {
            throw new Error('Bulan tidak valid! Gunakan rentang 2000-2100 dan 01-12');
        }
    }

    const scopeCond = ctx.isAll ? '' : "(LOWER(t.lembaga) = LOWER(?) OR t.lembaga IS NULL OR t.lembaga = '')";
    const scopeArgs = ctx.isAll ? [] : [ctx.lembaga];

    // Klausa periode: rentang tanggal atau satu bulan
    const periodBefore = range ? ['t.date < ?', range.tanggal_mulai] : ['t.date < ?', `${bulan}-01`];
    const periodIn = range
        ? { sql: 't.date BETWEEN ? AND ?', args: [range.tanggal_mulai, range.tanggal_selesai] }
        : { sql: "substr(t.date, 1, 7) = ?", args: [bulan] };

    // Saldo awal = total MASUK - KELUAR sebelum periode laporan
    const saldoAwalQuery = `
        SELECT COALESCE(SUM(CASE WHEN type = 'MASUK' THEN amount ELSE 0 END), 0) -
               COALESCE(SUM(CASE WHEN type = 'KELUAR' THEN amount ELSE 0 END), 0) AS saldo
        FROM transactions t
        WHERE ${periodBefore[0]} ${scopeCond ? `AND ${scopeCond}` : ''}
    `;
    const saldoAwal = await db.execute({
        sql: saldoAwalQuery,
        args: [periodBefore[1], ...scopeArgs]
    });

    // Rekap dalam periode
    const rekapQuery = `
        SELECT type, CAST(SUM(amount) AS REAL) AS total, COUNT(id) AS jumlah
        FROM transactions t
        WHERE ${periodIn.sql} ${scopeCond ? `AND ${scopeCond}` : ''}
        GROUP BY type
    `;
    const rekap = await db.execute({ sql: rekapQuery, args: [...periodIn.args, ...scopeArgs] });

    // Rincian per akun dalam periode
    const perAkunQuery = `
        SELECT t.account_code, a.account_name, a.account_type,
               CAST(SUM(CASE WHEN t.type = 'MASUK' THEN t.amount ELSE 0 END) AS REAL) AS masuk,
               CAST(SUM(CASE WHEN t.type = 'KELUAR' THEN t.amount ELSE 0 END) AS REAL) AS keluar
        FROM transactions t
        LEFT JOIN accounts a ON a.account_code = t.account_code
        WHERE ${periodIn.sql} ${scopeCond ? `AND ${scopeCond}` : ''}
        GROUP BY t.account_code, a.account_name, a.account_type
        ORDER BY t.account_code ASC
    `;
    const perAkun = await db.execute({ sql: perAkunQuery, args: [...periodIn.args, ...scopeArgs] });

    const rows = rekap.rows;
    const totalMasuk = rows.find(r => r.type === 'MASUK')?.total || 0;
    const totalKeluar = rows.find(r => r.type === 'KELUAR')?.total || 0;
    const saldoAkhir = Number(saldoAwal.rows[0].saldo || 0) + totalMasuk - totalKeluar;

    return {
        month: range ? `${range.tanggal_mulai} s/d ${range.tanggal_selesai}` : bulan,
        periode: range
            ? { tanggal_mulai: range.tanggal_mulai, tanggal_selesai: range.tanggal_selesai }
            : { bulan },
        saldo_awal: Number(saldoAwal.rows[0].saldo || 0),
        total_masuk: totalMasuk,
        total_keluar: totalKeluar,
        saldo_akhir: saldoAkhir,
        per_akun: perAkun.rows
    };
};
