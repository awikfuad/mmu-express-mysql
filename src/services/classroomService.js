import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// 1. AMBIL SEMUA DATA KELAS (Lengkap dengan Tahun Ajaran & Jenjang)
// v3.1: semua lembaga dalam satu tabel `classes`, scope via kolom `sumber`.
export const getAllClassroomsService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` WHERE c.${s.kelasFilter}`;
    const query = `
        SELECT c.*, ac.year_name, j.nama_jenjang
        FROM ${s.kelasTable} c
        LEFT JOIN academic_years ac ON c.academic_year_id = ac.id
        LEFT JOIN jenjang j ON c.jenjang_id = j.id
        ${scope}
        ORDER BY j.nama_jenjang ASC, c.class_name ASC
    `;
    const result = await db.execute({ sql: query });
    return result.rows;
};

// 2. TAMBAH KELAS BARU
export const createClassroomService = async (classroomData, lembaga = 'ALL') => {
    const { academic_year_id, jenjang_id, class_name, description } = classroomData;
    const s = getSumber(lembaga);

    const query = `
        INSERT INTO ${s.kelasTable} (sumber, academic_year_id, jenjang_id, class_name, description)
        VALUES (?, ?, ?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [s.sumber, academic_year_id || null, jenjang_id || null, class_name, description || null]
    });

    return {
        id: result.lastInsertRowid || result.insertId,
        academic_year_id,
        jenjang_id,
        class_name,
        description
    };
};

// 3. UPDATE DATA KELAS (terscope lembaga)
export const updateClassroomService = async (id, classroomData, lembaga = 'ALL') => {
    const { academic_year_id, jenjang_id, class_name, description } = classroomData;
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` AND ${s.kelasFilter}`;

    const query = `
        UPDATE ${s.kelasTable} 
        SET academic_year_id = ?, jenjang_id = ?, class_name = ?, description = ?
        WHERE id = ?${scope}
    `;
    await db.execute({
        sql: query,
        args: [academic_year_id || null, jenjang_id || null, class_name, description || null, id]
    });

    return { id, academic_year_id, jenjang_id, class_name, description };
};

// 4. HAPUS KELAS (terscope lembaga)
export const deleteClassroomService = async (id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` AND ${s.kelasFilter}`;
    await db.execute({
        sql: `DELETE FROM ${s.kelasTable} WHERE id = ?${scope}`,
        args: [id]
    });
    return { id };
};