import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Ambil lembaga & sumber tabel (madrasah/tpq)
const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq,
        sumber: s.sumber
    };
};

// Ambil nama murid dari tabel penempatan gabungan (fallback ke students / data induk)
const nameExpr = (alias) => `
    COALESCE(
        (SELECT name FROM santri_penempatan WHERE nim = ${alias}.nim LIMIT 1),
        (SELECT name FROM students WHERE nim = ${alias}.nim LIMIT 1)
    ) AS student_name
`;

const classExpr = (alias) => `
    (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = ${alias}.nim LIMIT 1) AS class_name
`;

const clean = (v) => (v !== undefined && v !== null ? String(v).trim() : null);

// List data wali (filter cari NIM/nama/telepon, terscope lembaga)
export const getWaliService = async ({ search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (search && String(search).trim()) {
        conditions.push('(wm.nim LIKE ? OR wm.nama_ayah LIKE ? OR wm.nama_ibu LIKE ? OR wm.nama_wali LIKE ? OR wm.telepon_wali LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('wm.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT wm.id, wm.murid_id, wm.sumber, wm.nim,
               wm.nama_ayah, wm.pekerjaan_ayah, wm.nama_ibu, wm.pekerjaan_ibu,
               wm.nama_wali, wm.hubungan_wali, wm.telepon_wali, wm.alamat,
               wm.lembaga, wm.created_at,
               ${nameExpr('wm')},
               ${classExpr('wm')}
        FROM wali_murid wm
        ${whereClause}
        ORDER BY wm.created_at DESC, wm.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan data wali (buat baru / perbarui jika sudah ada utk murid yang sama)
export const createWaliService = async ({ murid_id, nim, sumber, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, hubungan_wali, telepon_wali, alamat }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    if (!murid_id) throw new Error('Murid wajib dipilih');
    const muridId = Number(murid_id);
    // Scoped: sumber & murid wajib milik lembaga sendiri (data lembaga lain tak boleh disentuh).
    const sumberFinal = ctx.isAll ? (sumber || ctx.sumber) : ctx.sumber;
    if (!ctx.isAll) {
        const owned = await db.execute({
            sql: `SELECT id FROM santri_penempatan WHERE id = ? AND sumber = ?`,
            args: [muridId, ctx.sumber]
        });
        if (owned.rows.length === 0) throw new Error('Murid tersebut bukan milik lembaga Anda.');
    }

    // Cari wali yang ada (scoped: milik lembaga sendiri + legacy 'ALL' untuk diadopsi).
    const existing = await db.execute({
        sql: `SELECT id, lembaga FROM wali_murid WHERE murid_id = ? AND sumber = ?${ctx.isAll ? '' : ' AND lembaga IN (?, \'ALL\')'}`,
        args: ctx.isAll ? [muridId, sumberFinal] : [muridId, sumberFinal, ctx.lembaga]
    });

    const incoming = { nim, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, hubungan_wali, telepon_wali, alamat };

    const allFields = {
        nim: clean(nim),
        nama_ayah: clean(nama_ayah),
        pekerjaan_ayah: clean(pekerjaan_ayah),
        nama_ibu: clean(nama_ibu),
        pekerjaan_ibu: clean(pekerjaan_ibu),
        nama_wali: clean(nama_wali),
        hubungan_wali: clean(hubungan_wali),
        telepon_wali: clean(telepon_wali),
        alamat: clean(alamat)
    };

    if (existing.rows.length > 0) {
        const waliId = Number(existing.rows[0].id);
        const setEntries = Object.entries(incoming).filter(([k, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]);
        const setClause = setEntries.map(([k]) => `${k} = ?`).join(', ');
        // Adopsi baris legacy 'ALL' ke lembaga pemanggil (scoped) saat di-update.
        const adopt = ctx.isAll ? '' : ', lembaga = ?';
        await db.execute({
            sql: `UPDATE wali_murid SET ${setClause}${adopt} WHERE id = ?`,
            args: [...setEntries.map(([, v]) => v), ...(ctx.isAll ? [] : [ctx.lembaga]), waliId]
        });
        return { id: waliId, updated: true };
    }

    const result = await db.execute({
        sql: `
            INSERT INTO wali_murid (murid_id, sumber, nim, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu,
                                    nama_wali, hubungan_wali, telepon_wali, alamat, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            muridId, sumberFinal, allFields.nim, allFields.nama_ayah, allFields.pekerjaan_ayah,
            allFields.nama_ibu, allFields.pekerjaan_ibu, allFields.nama_wali, allFields.hubungan_wali,
            allFields.telepon_wali, allFields.alamat, ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid), updated: false };
};

// Ubah data wali (admin/teacher, terscope lembaga)
export const updateWaliService = async (id, { nim, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, hubungan_wali, telepon_wali, alamat }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    const map = { nim, nama_ayah, pekerjaan_ayah, nama_ibu, pekerjaan_ibu, nama_wali, hubungan_wali, telepon_wali, alamat };
    for (const [key, value] of Object.entries(map)) {
        if (value !== undefined) {
            updates.push(`${key} = ?`);
            args.push(clean(value));
        }
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE wali_murid SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus data wali (admin, terscope lembaga)
export const deleteWaliService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM wali_murid WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};
