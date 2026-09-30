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

export const TIPE_PRESTASI = ['PRESTASI', 'PELANGGARAN'];

export const KATEGORI_PRESTASI = [
    'AKADEMIK', 'AKHLAK', 'KEHADIRAN', 'KEAGAMAAN', 'OLAHRAGA', 'LAINNYA'
];

export const KATEGORI_PELANGGARAN = [
    'KEDISIPLINAN', 'KETERTIBAN', 'KETIDAKHADIRAN', 'AKHLAK', 'LAINNYA'
];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

// List catatan prestasi & pelanggaran (filter tipe/tanggal/kelas/murid/cari, terscope lembaga)
export const getPrestasiPelanggaranService = async ({ tipe, tanggal, tanggal_from, tanggal_to, classroom_id, murid_id, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (tipe) {
        const tipeFinal = toUpper(tipe);
        if (!TIPE_PRESTASI.includes(tipeFinal)) throw new Error(`Tipe tidak valid! Pilih: ${TIPE_PRESTASI.join(', ')}`);
        conditions.push('pp.tipe = ?');
        args.push(tipeFinal);
    }
    if (tanggal) {
        conditions.push('pp.tanggal = ?');
        args.push(tanggal);
    }
    if (tanggal_from) {
        conditions.push('pp.tanggal >= ?');
        args.push(tanggal_from);
    }
    if (tanggal_to) {
        conditions.push('pp.tanggal <= ?');
        args.push(tanggal_to);
    }
    if (classroom_id) {
        conditions.push('pp.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (murid_id) {
        conditions.push('pp.murid_id = ?');
        args.push(Number(murid_id));
    }
    if (search && String(search).trim()) {
        conditions.push('(pp.nim LIKE ? OR pp.deskripsi LIKE ? OR pp.kategori LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('pp.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT pp.id, pp.academic_year_id, pp.jenjang_id, pp.classroom_id, pp.murid_id, pp.sumber,
               pp.nim, pp.tipe, pp.kategori, pp.deskripsi, pp.poin, pp.catatan, pp.tanggal,
               pp.lembaga, pp.created_at,
               ${nameExpr('pp')},
               ${classExpr('pp')}
        FROM prestasi_pelanggaran pp
        ${whereClause}
        ORDER BY pp.tanggal DESC, pp.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan 1 catatan prestasi/pelanggaran (admin/teacher)
export const createPrestasiPelanggaranService = async ({ academic_year_id, jenjang_id, classroom_id, murid_id, nim, sumber, tipe, kategori, deskripsi, poin, catatan, tanggal }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tipeFinal = toUpper(tipe);
    const deskripsiFinal = String(deskripsi || '').trim();
    const tgl = String(tanggal || '').trim();

    if (!tipeFinal || !TIPE_PRESTASI.includes(tipeFinal)) throw new Error(`Tipe tidak valid! Pilih: ${TIPE_PRESTASI.join(', ')}`);
    if (!deskripsiFinal) throw new Error('Deskripsi wajib diisi');
    if (!tgl) throw new Error('Tanggal wajib diisi');
    if (!murid_id) throw new Error('Murid wajib dipilih');

    // Validasi ownership & paksa sumber untuk scoped
    if (!ctx.isAll) {
        const owned = await db.execute({
            sql: `SELECT id FROM santri_penempatan WHERE id = ? AND sumber = ?`,
            args: [Number(murid_id), ctx.sumber]
        });
        if (owned.rows.length === 0) throw new Error('Murid tersebut bukan milik lembaga Anda.');
    }

    const kategoriFinal = kategori ? toUpper(kategori) : null;
    const poinFinal = (poin !== undefined && poin !== null && poin !== '') ? Number(poin) : null;
    if (poinFinal !== null && !Number.isFinite(poinFinal)) throw new Error('Poin harus angka');

    const result = await db.execute({
        sql: `
            INSERT INTO prestasi_pelanggaran
                (academic_year_id, jenjang_id, classroom_id, murid_id, sumber, nim, tipe, kategori, deskripsi, poin, catatan, tanggal, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            academic_year_id ? Number(academic_year_id) : null,
            jenjang_id ? Number(jenjang_id) : null,
            classroom_id ? Number(classroom_id) : null,
            Number(murid_id),
            ctx.isAll ? (sumber || ctx.sumber) : ctx.sumber,
            String(nim || ''),
            tipeFinal,
            kategoriFinal,
            deskripsiFinal,
            poinFinal,
            catatan || null,
            tgl,
            ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah catatan prestasi/pelanggaran (admin/teacher)
export const updatePrestasiPelanggaranService = async (id, { tipe, kategori, deskripsi, poin, catatan, tanggal, classroom_id, jenjang_id, academic_year_id }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (tipe !== undefined) {
        const tipeFinal = toUpper(tipe);
        if (!TIPE_PRESTASI.includes(tipeFinal)) throw new Error(`Tipe tidak valid! Pilih: ${TIPE_PRESTASI.join(', ')}`);
        updates.push('tipe = ?');
        args.push(tipeFinal);
    }
    if (kategori !== undefined) {
        updates.push('kategori = ?');
        args.push(kategori ? toUpper(kategori) : null);
    }
    if (deskripsi !== undefined) {
        const deskripsiFinal = String(deskripsi || '').trim();
        if (!deskripsiFinal) throw new Error('Deskripsi wajib diisi');
        updates.push('deskripsi = ?');
        args.push(deskripsiFinal);
    }
    if (poin !== undefined) {
        const poinFinal = (poin !== null && poin !== '') ? Number(poin) : null;
        if (poinFinal !== null && !Number.isFinite(poinFinal)) throw new Error('Poin harus angka');
        updates.push('poin = ?');
        args.push(poinFinal);
    }
    if (catatan !== undefined) {
        updates.push('catatan = ?');
        args.push(catatan || null);
    }
    if (tanggal !== undefined) {
        const tgl = String(tanggal || '').trim();
        if (!tgl) throw new Error('Tanggal wajib diisi');
        updates.push('tanggal = ?');
        args.push(tgl);
    }
    if (classroom_id !== undefined) {
        updates.push('classroom_id = ?');
        args.push(classroom_id ? Number(classroom_id) : null);
    }
    if (jenjang_id !== undefined) {
        updates.push('jenjang_id = ?');
        args.push(jenjang_id ? Number(jenjang_id) : null);
    }
    if (academic_year_id !== undefined) {
        updates.push('academic_year_id = ?');
        args.push(academic_year_id ? Number(academic_year_id) : null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE prestasi_pelanggaran SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus catatan prestasi/pelanggaran (admin, terscope lembaga)
export const deletePrestasiPelanggaranService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM prestasi_pelanggaran WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};
