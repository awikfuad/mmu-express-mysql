import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Pengumuman / Notifikasi (C.9) — publikasi pengumuman per lembaga.

export const KATEGORI_PENGUMUMAN = ['UMUM', 'AKADEMIK', 'KEUANGAN', 'KEGIATAN'];

const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq
    };
};

const isValidDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00`);
    return !isNaN(d.getTime());
};

const todayStr = () => new Date().toISOString().slice(0, 10);

// Daftar pengumuman untuk pengelola (filter kategori/status/cari, terscope lembaga)
export const getPengumumanService = async ({ kategori, status, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (kategori) {
        const kat = String(kategori).toUpperCase();
        if (!KATEGORI_PENGUMUMAN.includes(kat)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_PENGUMUMAN.join(', ')}`);
        conditions.push('p.kategori = ?');
        args.push(kat);
    }
    if (status) {
        const st = String(status).toUpperCase();
        if (!['DRAFT', 'PUBLISHED'].includes(st)) throw new Error('Status tidak valid! Pilih: DRAFT atau PUBLISHED');
        conditions.push('p.is_published = ?');
        args.push(st === 'PUBLISHED' ? 1 : 0);
    }
    if (search && String(search).trim()) {
        conditions.push('(p.judul LIKE ? OR p.isi LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like);
    }
    if (!ctx.isAll) {
        conditions.push('p.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT p.id, p.judul, p.isi, p.kategori, p.tanggal_mulai, p.tanggal_selesai,
               p.is_published, p.tanggal_publish, p.lembaga, p.dibuat_oleh, p.created_at, p.updated_at
        FROM pengumuman p
        ${whereClause}
        ORDER BY p.created_at DESC, p.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan pengumuman (admin/teacher, terscope lembaga)
export const createPengumumanService = async ({ judul, isi, kategori, tanggal_mulai, tanggal_selesai, is_published }, lembagaPemanggil = 'ALL', actorName = null) => {
    const ctx = getContext(lembagaPemanggil);
    const judulFinal = String(judul || '').trim();
    const isiFinal = String(isi || '').trim();
    const katFinal = String(kategori || 'UMUM').toUpperCase();
    const mulaiFinal = String(tanggal_mulai || todayStr()).trim();
    const selesaiFinal = tanggal_selesai ? String(tanggal_selesai).trim() : null;

    if (!judulFinal) throw new Error('Judul pengumuman wajib diisi');
    if (!isiFinal) throw new Error('Isi pengumuman wajib diisi');
    if (!KATEGORI_PENGUMUMAN.includes(katFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_PENGUMUMAN.join(', ')}`);
    if (!isValidDate(mulaiFinal)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
    if (selesaiFinal) {
        if (!isValidDate(selesaiFinal)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
        if (mulaiFinal > selesaiFinal) throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');
    }

    const published = is_published === 1 || is_published === true || is_published === '1' ? 1 : 0;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const result = await db.execute({
        sql: `
            INSERT INTO pengumuman
                (judul, isi, kategori, tanggal_mulai, tanggal_selesai, is_published, tanggal_publish, lembaga, dibuat_oleh)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            judulFinal,
            isiFinal,
            katFinal,
            mulaiFinal,
            selesaiFinal,
            published,
            published ? now : null,
            ctx.lembaga,
            actorName || null
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah pengumuman (admin/teacher, terscope lembaga)
export const updatePengumumanService = async (id, fields, lembagaPemanggil = 'ALL', actorName = null) => {
    const ctx = getContext(lembagaPemanggil);
    const updates = [];
    const args = [];
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    if (fields.judul !== undefined) {
        const judul = String(fields.judul || '').trim();
        if (!judul) throw new Error('Judul pengumuman wajib diisi');
        updates.push('judul = ?');
        args.push(judul);
    }
    if (fields.isi !== undefined) {
        const isi = String(fields.isi || '').trim();
        if (!isi) throw new Error('Isi pengumuman wajib diisi');
        updates.push('isi = ?');
        args.push(isi);
    }
    if (fields.kategori !== undefined) {
        const kat = String(fields.kategori).toUpperCase();
        if (!KATEGORI_PENGUMUMAN.includes(kat)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_PENGUMUMAN.join(', ')}`);
        updates.push('kategori = ?');
        args.push(kat);
    }
    if (fields.tanggal_mulai !== undefined) {
        const tgl = String(fields.tanggal_mulai || '').trim();
        if (!isValidDate(tgl)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
        updates.push('tanggal_mulai = ?');
        args.push(tgl);
    }
    if (fields.tanggal_selesai !== undefined) {
        const tgl = fields.tanggal_selesai ? String(fields.tanggal_selesai).trim() : null;
        if (tgl && !isValidDate(tgl)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
        updates.push('tanggal_selesai = ?');
        args.push(tgl);
    }
    if (fields.is_published !== undefined) {
        const published = fields.is_published === 1 || fields.is_published === true || fields.is_published === '1' ? 1 : 0;
        updates.push('is_published = ?');
        args.push(published);
        updates.push('tanggal_publish = ?');
        args.push(published ? now : null);
    }

    // Validasi urutan tanggal bila keduanya berubah
    if (fields.tanggal_mulai !== undefined || fields.tanggal_selesai !== undefined) {
        const existing = await db.execute({ sql: 'SELECT tanggal_mulai, tanggal_selesai FROM pengumuman WHERE id = ?', args: [Number(id)] });
        const row = existing.rows[0];
        if (!row) throw new Error('Pengumuman tidak ditemukan');
        const mulai = fields.tanggal_mulai !== undefined ? String(fields.tanggal_mulai).trim() : row.tanggal_mulai;
        const selesai = fields.tanggal_selesai !== undefined ? (fields.tanggal_selesai ? String(fields.tanggal_selesai).trim() : null) : row.tanggal_selesai;
        if (selesai && mulai > selesai) throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE pengumuman SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Publish / unpublish cepat (admin/teacher)
export const setPublishPengumumanService = async (id, is_published, lembagaPemanggil = 'ALL') => {
    const ctx = getContext(lembagaPemanggil);
    const published = is_published === 1 || is_published === true || is_published === '1' ? 1 : 0;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = [published, published ? now : null, Number(id)];
    if (!ctx.isAll) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE pengumuman SET is_published = ?, tanggal_publish = ?, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus pengumuman (admin, terscope lembaga)
export const deletePengumumanService = async (id, lembagaPemanggil = 'ALL') => {
    const ctx = getContext(lembagaPemanggil);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM pengumuman WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Pengumuman yang sedang tayang (papan pengumuman — semua role)
// Hanya is_published=1, dalam masa tayang, dan lembaga cocok (lembaga sendiri + ALL).
export const getPublishedPengumumanService = async (lembaga = 'ALL', limit = 20) => {
    const ctx = getContext(lembaga);
    const today = todayStr();
    const conditions = ['p.is_published = 1', 'p.tanggal_mulai <= ?', '(p.tanggal_selesai IS NULL OR p.tanggal_selesai >= ?)'];
    const args = [today, today];
    if (!ctx.isAll) {
        conditions.push('(p.lembaga = ? OR p.lembaga = ?)');
        args.push(ctx.lembaga, 'ALL');
    }
    const query = `
        SELECT p.id, p.judul, p.isi, p.kategori, p.tanggal_mulai, p.tanggal_selesai,
               p.tanggal_publish, p.lembaga, p.dibuat_oleh, p.created_at
        FROM pengumuman p
        WHERE ${conditions.join(' AND ')}
        ORDER BY COALESCE(p.tanggal_publish, p.created_at) DESC, p.id DESC
        LIMIT ?
    `;
    args.push(Number(limit) > 0 ? Number(limit) : 20);
    const result = await db.execute({ sql: query, args });
    return result.rows;
};
