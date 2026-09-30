import db from '../config/db.js';
import bcrypt from 'bcrypt';
import env from '../config/env.js';

// 1. AMBIL SEMUA DATA SANTRI (Lengkap dengan Tahun Ajaran & Jenjang)
export const getAllStudentsService = async (lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    // Scoped admin hanya melihat santri milik lembaganya (exact match);
    // data legacy yang belum ditandai (default 'ALL') tidak ikut ter-expose.
    const whereClause = l === 'ALL' ? '' : 'WHERE s.lembaga = ?';
    const args = l === 'ALL' ? [] : [l];
    const query = `
        SELECT s.*, ac.year_name, j.nama_jenjang
        FROM students s
        LEFT JOIN academic_years ac ON s.academic_year_id = ac.id
        LEFT JOIN jenjang j ON s.jenjang_id = j.id
        ${whereClause}
        ORDER BY s.name ASC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// 2. TAMBAH SANTRI BARU
export const createStudentService = async (studentData, lembaga = 'ALL') => {
    const { nim, name, academic_year_id, jenjang_id } = studentData;
    const l = (lembaga || 'ALL').toUpperCase();

    // Enkripsi password default santri
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(env.defaultResetPassword, salt); // default password jika kosong

    const query = `
        INSERT INTO students (nim, name, password, academic_year_id, jenjang_id, lembaga)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [nim, name, hashedPassword, academic_year_id, jenjang_id || null, l]
    });

    // PERBAIKAN: Menghapus classroom_id karena tidak digunakan di scope ini
    return { 
        id: result.lastInsertRowid || result.insertId, 
        nim, 
        name,
        academic_year_id,
        jenjang_id,
        lembaga: l
    };
};

// 3. UPDATE DATA SANTRI SECARA KESELURUHAN
export const updateStudentService = async (id, studentData, lembaga = 'ALL') => {
    const { nim, name, academic_year_id, status, jenjang_id } = studentData;
    const l = (lembaga || 'ALL').toUpperCase();

    // Scoped admin hanya boleh mengubah santri lembaganya sendiri (atau legacy 'ALL'
    // yang sedang diadopsi ke lembaganya); Super Admin boleh semua.
    const whereScope = l === 'ALL' ? 'id = ?' : 'id = ? AND lembaga IN (?, ?)';
    const args = l === 'ALL'
        ? [nim, name, academic_year_id, status, jenjang_id, l, id]
        : [nim, name, academic_year_id, status, jenjang_id, l, id, l, 'ALL'];

    const query = `
        UPDATE students 
        SET nim = ?, name = ?, academic_year_id = ?, status = ?, jenjang_id = ?, lembaga = ? 
        WHERE ${whereScope}
    `;
    await db.execute({
        sql: query,
        args
    });

    // PERBAIKAN: Menghapus classroom_id yang tidak terdefinisi
    return { id, nim, name, academic_year_id, status, jenjang_id, lembaga: l };
};

// 4. UPDATE STATUS SANTRI SAJA (AKTIF / TIDAK AKTIF)
export const updateStudentStatusService = async (id, studentData, lembaga = 'ALL') => {
    const { status } = studentData;
    const l = (lembaga || 'ALL').toUpperCase();

    const whereScope = l === 'ALL' ? "id = ?" : "id = ? AND lembaga IN (?, ?)";
    const args = l === 'ALL' ? [status, id] : [status, id, l, 'ALL'];

    const query = `
        UPDATE students SET status = ? WHERE ${whereScope}
    `;
    await db.execute({
        sql: query,
        args
    });

    return { id, status };
};

// 5. HAPUS SANTRI
export const deleteStudentService = async (id, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereScope = l === 'ALL' ? "id = ?" : "id = ? AND lembaga IN (?, ?)";
    const args = l === 'ALL' ? [id] : [id, l, 'ALL'];
    await db.execute({
        sql: `DELETE FROM students WHERE ${whereScope}`,
        args
    });
    return { id };
};