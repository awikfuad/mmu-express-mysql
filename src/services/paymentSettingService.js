import db from '../config/db.js';
import { LEMBAGA, getLembagaKodeBySumber } from '../utils/lembagaHelper.js';
import { isLembagaValidService } from './lembagaService.js';

const VALID_TYPES = ['YAUMIYAH', 'DAFTAR_ULANG'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry transaksi singkat saat DB file terkunci (SQLITE_BUSY) — lazim terjadi di
// lingkungan dev ketika ada aplikasi lain (mis. SQLite Expert) membuka DB bersamaan.
const withBusyRetry = async (fn, retries = 3) => {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (String(err.message || '').includes('SQLITE_BUSY')) {
                await sleep(150 * (i + 1));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
};

// Ambil tahun ajaran yang sedang aktif
export const getActiveAcademicYearIdService = async () => {
    const result = await db.execute({
        sql: 'SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1'
    });
    return result.rows.length ? result.rows[0].id : null;
};

// Cari konteks akademik sebuah akun santri (id tabel penempatan gabungan)
export const getAccountAcademicContext = async (accountId) => {
    try {
        const sp = await db.execute({
            sql: 'SELECT academic_year_id, sumber FROM santri_penempatan WHERE id = ?',
            args: [accountId]
        });
        if (sp.rows.length) {
            const row = sp.rows[0];
            return {
                academic_year_id: row.academic_year_id,
                lembaga: getLembagaKodeBySumber(row.sumber) || LEMBAGA.ALL
            };
        }
    } catch (e) {
        // tabel santri_penempatan belum ada (mis. DB test) — lewati
    }

    return { academic_year_id: null, lembaga: LEMBAGA.ALL };
};

// Resolve nominal pembayaran (tahun, jenis, lembaga):
// prioritas lembaga spesifik dulu, lalu fallback ke 'ALL'. Null bila belum diatur.
export const getPaymentNominalService = async (academicYearId, paymentType, lembaga) => {
    if (!academicYearId) return null;
    const type = (paymentType || '').toUpperCase();
    const l = (lembaga || LEMBAGA.ALL).toUpperCase();

    const result = await db.execute({
        sql: `
            SELECT nominal FROM payment_settings
            WHERE academic_year_id = ? AND payment_type = ? AND lembaga IN (?, ?)
            ORDER BY CASE WHEN lembaga = ? THEN 0 ELSE 1 END
            LIMIT 1
        `,
        args: [academicYearId, type, l, LEMBAGA.ALL, l]
    });

    return result.rows.length ? Number(result.rows[0].nominal) : null;
};

// Resolve nominal + tahun ajaran efektif untuk sebuah akun santri
export const resolveNominalForAccount = async (accountId, paymentType) => {
    const ctx = await getAccountAcademicContext(accountId);
    let yearId = ctx.academic_year_id;
    if (!yearId) yearId = await getActiveAcademicYearIdService();
    const nominal = await getPaymentNominalService(yearId, paymentType, ctx.lembaga);
    return { yearId, nominal, lembaga: ctx.lembaga };
};

// List setting nominal (terscope lembaga: admin scoped hanya melihat lembaganya + ALL)
export const getPaymentSettingsService = async (lembaga) => {
    const l = (lembaga || LEMBAGA.ALL).toUpperCase();
    const whereClause = l === LEMBAGA.ALL ? '' : 'WHERE ps.lembaga IN (?, ?)';
    const args = l === LEMBAGA.ALL ? [] : [l, LEMBAGA.ALL];

    const result = await db.execute({
        sql: `
            SELECT ps.id, ps.academic_year_id, ps.payment_type, ps.lembaga, ps.nominal,
                   ps.created_at, ps.updated_at, ay.year_name, ay.semester
            FROM payment_settings ps
            LEFT JOIN academic_years ay ON ay.id = ps.academic_year_id
            ${whereClause}
            ORDER BY ay.id DESC, ps.payment_type ASC, ps.lembaga ASC
        `,
        args
    });

    return result.rows;
};

// Simpan/ubah setting nominal. Lembaga admin scoped dipaksa ke lembaganya sendiri.
export const upsertPaymentSettingService = async ({ academic_year_id, payment_type, nominal, lembaga }, userLembaga) => {
    const type = (payment_type || '').toUpperCase();
    if (!VALID_TYPES.includes(type)) {
        throw new Error('Jenis pembayaran harus YAUMIYAH atau DAFTAR_ULANG');
    }

    const tahunId = Number(academic_year_id);
    if (!Number.isInteger(tahunId) || tahunId <= 0) {
        throw new Error('Tahun ajaran wajib diisi');
    }

    const amount = Number(nominal);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Nominal pembayaran harus lebih besar dari Rp 0');
    }

    const userL = (userLembaga || LEMBAGA.ALL).toUpperCase();
    let targetLembaga = (lembaga || LEMBAGA.ALL).toUpperCase();
    if (userL !== LEMBAGA.ALL) {
        targetLembaga = userL;
    }
    if (!(await isLembagaValidService(targetLembaga))) {
        throw new Error('Lembaga tidak valid! Pilih ALL, MADRASAH, atau TPQ.');
    }

    await withBusyRetry(() => db.execute({
        sql: `
            INSERT INTO payment_settings (academic_year_id, payment_type, lembaga, nominal, updated_at)
            VALUES (?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                nominal = VALUES(nominal),
                updated_at = NOW()
        `,
        args: [tahunId, type, targetLembaga, amount]
    }));

    return { academic_year_id: tahunId, payment_type: type, lembaga: targetLembaga, nominal: amount };
};

// Hapus setting nominal (terscope lembaga)
export const deletePaymentSettingService = async (id, userLembaga) => {
    const settingId = Number(id);
    if (!Number.isInteger(settingId) || settingId <= 0) {
        throw new Error('ID setting tidak valid');
    }

    const l = (userLembaga || LEMBAGA.ALL).toUpperCase();
    const whereClause = l === LEMBAGA.ALL ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = l === LEMBAGA.ALL ? [settingId] : [settingId, l];

    const result = await withBusyRetry(() => db.execute({
        sql: `DELETE FROM payment_settings WHERE ${whereClause}`,
        args
    }));

    return result.rowsAffected > 0;
};
