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

export const KATEGORI_INVENTARIS = [
    'PERALATAN', 'PERABOT', 'ALAT_BELAJAR', 'KENDARAAN', 'BANGUNAN', 'LAINNYA'
];

export const KONDISI_INVENTARIS = ['BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT', 'HILANG'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

// List aset inventaris (filter kategori/kondisi/cari, terscope lembaga)
export const getInventarisService = async ({ kategori, kondisi, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (kategori) {
        const kategoriFinal = toUpper(kategori);
        if (!KATEGORI_INVENTARIS.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_INVENTARIS.join(', ')}`);
        conditions.push('ia.kategori = ?');
        args.push(kategoriFinal);
    }
    if (kondisi) {
        const kondisiFinal = toUpper(kondisi);
        if (!KONDISI_INVENTARIS.includes(kondisiFinal)) throw new Error(`Kondisi tidak valid! Pilih: ${KONDISI_INVENTARIS.join(', ')}`);
        conditions.push('ia.kondisi = ?');
        args.push(kondisiFinal);
    }
    if (search && String(search).trim()) {
        conditions.push('(ia.nama LIKE ? OR ia.kode LIKE ? OR ia.lokasi LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like, like);
    }
    if (!ctx.isAll) {
        conditions.push('ia.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT ia.id, ia.kode, ia.nama, ia.kategori, ia.jumlah, ia.kondisi, ia.lokasi,
               ia.nilai, ia.tahun_pengadaan, ia.keterangan, ia.lembaga, ia.created_at
        FROM inventaris_aset ia
        ${whereClause}
        ORDER BY ia.created_at DESC, ia.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Tambah aset inventaris (admin)
export const createInventarisService = async ({ kode, nama, kategori, jumlah, kondisi, lokasi, nilai, tahun_pengadaan, keterangan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const namaFinal = String(nama || '').trim();
    if (!namaFinal) throw new Error('Nama aset wajib diisi');

    const kategoriFinal = kategori ? toUpper(kategori) : null;
    if (kategoriFinal && !KATEGORI_INVENTARIS.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_INVENTARIS.join(', ')}`);

    const kondisiFinal = kondisi ? toUpper(kondisi) : 'BAIK';
    if (!KONDISI_INVENTARIS.includes(kondisiFinal)) throw new Error(`Kondisi tidak valid! Pilih: ${KONDISI_INVENTARIS.join(', ')}`);

    const jumlahFinal = (jumlah !== undefined && jumlah !== null && jumlah !== '') ? Number(jumlah) : 0;
    if (!Number.isInteger(jumlahFinal) || jumlahFinal < 0) throw new Error('Jumlah harus angka bulat >= 0');

    const nilaiFinal = (nilai !== undefined && nilai !== null && nilai !== '') ? Number(nilai) : null;
    if (nilaiFinal !== null && (!Number.isFinite(nilaiFinal) || nilaiFinal < 0)) throw new Error('Nilai harus angka >= 0');

    // Validasi tahun pengadaan (YYYY)
    let tahunFinal = null
    if (tahun_pengadaan && String(tahun_pengadaan).trim()) {
        const t = String(tahun_pengadaan).trim()
        if (!/^\d{4}$/.test(t)) throw new Error('Tahun pengadaan harus 4 digit (mis. 2024)')
        tahunFinal = t
    }

    // Cek unik kode jika diisi
    if (kode && String(kode).trim()) {
        const kodeFinal = String(kode).trim()
        const existing = await db.execute({
            sql: ctx.isAll ? 'SELECT id FROM inventaris_aset WHERE kode = ?' : 'SELECT id FROM inventaris_aset WHERE kode = ? AND lembaga = ?',
            args: ctx.isAll ? [kodeFinal] : [kodeFinal, ctx.lembaga]
        })
        if (existing.rows.length > 0) throw new Error('Kode inventaris sudah digunakan')
    }

    const result = await db.execute({
        sql: `
            INSERT INTO inventaris_aset (kode, nama, kategori, jumlah, kondisi, lokasi, nilai, tahun_pengadaan, keterangan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            kode ? String(kode).trim() : null,
            namaFinal,
            kategoriFinal,
            jumlahFinal,
            kondisiFinal,
            lokasi ? String(lokasi).trim() : null,
            nilaiFinal,
            tahunFinal,
            keterangan || null,
            ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah aset inventaris (admin)
export const updateInventarisService = async (id, { kode, nama, kategori, jumlah, kondisi, lokasi, nilai, tahun_pengadaan, keterangan }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (kode !== undefined) {
        const kodeFinal = kode ? String(kode).trim() : null
        if (kodeFinal) {
            // Cek unik kode jika diisi
            const existing = await db.execute({
                sql: ctx.isAll
                    ? 'SELECT id FROM inventaris_aset WHERE kode = ? AND id != ?'
                    : 'SELECT id FROM inventaris_aset WHERE kode = ? AND id != ? AND lembaga = ?',
                args: ctx.isAll ? [kodeFinal, Number(id)] : [kodeFinal, Number(id), ctx.lembaga]
            })
            if (existing.rows.length > 0) throw new Error('Kode inventaris sudah digunakan')
        }
        updates.push('kode = ?');
        args.push(kodeFinal);
    }
    if (nama !== undefined) {
        const namaFinal = String(nama || '').trim();
        if (!namaFinal) throw new Error('Nama aset wajib diisi');
        updates.push('nama = ?');
        args.push(namaFinal);
    }
    if (kategori !== undefined) {
        const kategoriFinal = kategori ? toUpper(kategori) : null;
        if (kategoriFinal && !KATEGORI_INVENTARIS.includes(kategoriFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_INVENTARIS.join(', ')}`);
        updates.push('kategori = ?');
        args.push(kategoriFinal);
    }
    if (jumlah !== undefined) {
        const jumlahFinal = (jumlah !== null && jumlah !== '') ? Number(jumlah) : 0;
        if (!Number.isInteger(jumlahFinal) || jumlahFinal < 0) throw new Error('Jumlah harus angka bulat >= 0');
        updates.push('jumlah = ?');
        args.push(jumlahFinal);
    }
    if (kondisi !== undefined) {
        const kondisiFinal = kondisi ? toUpper(kondisi) : 'BAIK';
        if (!KONDISI_INVENTARIS.includes(kondisiFinal)) throw new Error(`Kondisi tidak valid! Pilih: ${KONDISI_INVENTARIS.join(', ')}`);
        updates.push('kondisi = ?');
        args.push(kondisiFinal);
    }
    if (lokasi !== undefined) {
        updates.push('lokasi = ?');
        args.push(lokasi ? String(lokasi).trim() : null);
    }
    if (nilai !== undefined) {
        const nilaiFinal = (nilai !== null && nilai !== '') ? Number(nilai) : null;
        if (nilaiFinal !== null && (!Number.isFinite(nilaiFinal) || nilaiFinal < 0)) throw new Error('Nilai harus angka >= 0');
        updates.push('nilai = ?');
        args.push(nilaiFinal);
    }
    if (tahun_pengadaan !== undefined) {
        let tahunFinal = null
        if (tahun_pengadaan && String(tahun_pengadaan).trim()) {
            const t = String(tahun_pengadaan).trim()
            if (!/^\d{4}$/.test(t)) throw new Error('Tahun pengadaan harus 4 digit (mis. 2024)')
            tahunFinal = t
        }
        updates.push('tahun_pengadaan = ?');
        args.push(tahunFinal);
    }
    if (keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(keterangan || null);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE inventaris_aset SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus aset inventaris (admin, terscope lembaga)
export const deleteInventarisService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM inventaris_aset WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};
