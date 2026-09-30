import fs from 'fs';
import path from 'path';
import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { saveLocalUpload } from '../config/upload.js';

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

export const IMDA_AR_SIP = ['IMDA 1', 'IMDA 2', 'IMDA 3'];

// Resolve path fisik file dari path publik ('/uploads/xxx.pdf' -> 'public/uploads/xxx.pdf')
const resolveLocalPath = (filePath) => {
    if (!filePath) return null;
    if (filePath.startsWith('/')) return path.join('public', filePath);
    return filePath;
};

// Hapus file fisik dari disk bila ada
const removeFile = (filePath) => {
    const full = resolveLocalPath(filePath);
    if (!full) return;
    try {
        if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch (e) { /* abaikan bila gagal hapus */ }
};

// List arsip soal (filter jenjang/kelas/imda/tahun/cari, terscope lembaga)
export const getArsipSoalanService = async ({ jenjang_id, classroom_id, imda, academic_year_id, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (jenjang_id) {
        conditions.push('a.jenjang_id = ?');
        args.push(Number(jenjang_id));
    }
    if (classroom_id) {
        conditions.push('a.classroom_id = ?');
        args.push(Number(classroom_id));
    }
    if (imda) {
        const imdaFinal = String(imda).trim().toUpperCase();
        if (!IMDA_AR_SIP.includes(imdaFinal)) throw new Error(`IMDA tidak valid! Pilih: ${IMDA_AR_SIP.join(', ')}`);
        conditions.push('(a.imda IS NULL OR a.imda = ?)');
        args.push(imdaFinal);
    }
    if (academic_year_id) {
        conditions.push('a.academic_year_id = ?');
        args.push(Number(academic_year_id));
    }
    if (search && String(search).trim()) {
        conditions.push('(a.judul LIKE ? OR a.keterangan LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like);
    }
    if (!ctx.isAll) {
        conditions.push('a.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT a.id, a.judul, a.file_path, a.jenjang_id, a.classroom_id, a.imda,
               a.academic_year_id, a.keterangan, a.lembaga, a.created_at, a.updated_at,
               jt.nama_jenjang AS jenjang_name,
               cl.class_name AS class_name,
               ay.year_name AS academic_year_name
        FROM arsip_soalan a
        LEFT JOIN jenjang jt ON jt.id = a.jenjang_id
        LEFT JOIN classes cl ON cl.id = a.classroom_id
        LEFT JOIN academic_years ay ON ay.id = a.academic_year_id
        ${whereClause}
        ORDER BY a.created_at DESC, a.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Tambah arsip soal (admin) — wajib file PDF
export const createArsipSoalanService = async ({ judul, jenjang_id, classroom_id, imda, academic_year_id, keterangan }, file, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const judulFinal = String(judul || '').trim();
    if (!judulFinal) throw new Error('Judul arsip wajib diisi');
    if (!file || !file.buffer) throw new Error('File PDF wajib diunggah');

    let imdaFinal = imda ? String(imda).trim().toUpperCase() : null;
    if (imdaFinal && !IMDA_AR_SIP.includes(imdaFinal)) throw new Error(`IMDA tidak valid! Pilih: ${IMDA_AR_SIP.join(', ')}`);

    const filePath = await saveLocalUpload(file.buffer, file.originalname, 'arsip');
    if (!filePath) throw new Error('Gagal menyimpan file arsip');

    const result = await db.execute({
        sql: `
            INSERT INTO arsip_soalan (judul, file_path, jenjang_id, classroom_id, imda, academic_year_id, keterangan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            judulFinal,
            filePath,
            jenjang_id ? Number(jenjang_id) : null,
            classroom_id ? Number(classroom_id) : null,
            imdaFinal,
            academic_year_id ? Number(academic_year_id) : null,
            keterangan || null,
            ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid), file_path: filePath };
};

// Ubah arsip soal (admin) — SET dinamis; bila ada file baru, ganti file lama
export const updateArsipSoalanService = async (id, { judul, jenjang_id, classroom_id, imda, academic_year_id, keterangan }, file, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const scopeArgs = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];

    const existing = await db.execute({
        sql: `SELECT id, file_path FROM arsip_soalan WHERE ${whereClause}`,
        args: scopeArgs
    });
    if (existing.rows.length === 0) throw new Error('NOT_FOUND');

    const updates = [];
    const args = [];

    if (judul !== undefined) {
        const judulFinal = String(judul || '').trim();
        if (!judulFinal) throw new Error('Judul arsip wajib diisi');
        updates.push('judul = ?');
        args.push(judulFinal);
    }
    if (jenjang_id !== undefined) {
        updates.push('jenjang_id = ?');
        args.push(jenjang_id ? Number(jenjang_id) : null);
    }
    if (classroom_id !== undefined) {
        updates.push('classroom_id = ?');
        args.push(classroom_id ? Number(classroom_id) : null);
    }
    if (imda !== undefined) {
        let imdaFinal = imda ? String(imda).trim().toUpperCase() : null;
        if (imdaFinal && !IMDA_AR_SIP.includes(imdaFinal)) throw new Error(`IMDA tidak valid! Pilih: ${IMDA_AR_SIP.join(', ')}`);
        updates.push('imda = ?');
        args.push(imdaFinal);
    }
    if (academic_year_id !== undefined) {
        updates.push('academic_year_id = ?');
        args.push(academic_year_id ? Number(academic_year_id) : null);
    }
    if (keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(keterangan || null);
    }

    // File baru menggantikan file lama
    if (file && file.buffer) {
        const newPath = await saveLocalUpload(file.buffer, file.originalname, 'arsip');
        if (!newPath) throw new Error('Gagal menyimpan file arsip');
        updates.push('file_path = ?', 'updated_at = CURRENT_TIMESTAMP');
        args.push(newPath);
        removeFile(existing.rows[0].file_path);
    } else {
        updates.push('updated_at = CURRENT_TIMESTAMP');
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    args.push(...scopeArgs);
    const result = await db.execute({
        sql: `UPDATE arsip_soalan SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus arsip soal (admin, terscope lembaga) — hapus baris + file fisik
export const deleteArsipSoalanService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];

    const existing = await db.execute({
        sql: `SELECT file_path FROM arsip_soalan WHERE ${whereClause}`,
        args
    });
    if (existing.rows.length === 0) return false;

    const result = await db.execute({
        sql: `DELETE FROM arsip_soalan WHERE ${whereClause}`,
        args
    });
    if (result.rowsAffected > 0) {
        removeFile(existing.rows[0].file_path);
    }
    return result.rowsAffected > 0;
};