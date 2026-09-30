import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// ============================================================================
// TAHUN AJARAN
// ============================================================================

export const getAllAcademicYearsService = async () => {
    const result = await db.execute('SELECT * FROM academic_years ORDER BY id DESC');
    return result.rows;
};

export const createAcademicYearService = async ({ year_name, semester, is_active }) => {
    const name = String(year_name || '').trim();
    if (!name) throw new Error('Nama tahun ajaran wajib diisi');
    if (!semester) throw new Error('Semester wajib diisi');
    const active = is_active === 1 || is_active === true || is_active === '1' ? 1 : 0;
    if (active === 1) await deactivateAllAcademicYearsService();
    const result = await db.execute({
        sql: 'INSERT INTO academic_years (year_name, semester, is_active) VALUES (?, ?, ?)',
        args: [name, semester, active]
    });
    return { id: result.lastInsertRowid, year_name: name, semester, is_active: active };
};

export const updateAcademicYearService = async (id, { year_name, semester, is_active }) => {
    const updates = [];
    const args = [];
    if (year_name) { updates.push('year_name = ?'); args.push(String(year_name).trim()); }
    if (semester) { updates.push('semester = ?'); args.push(semester); }
    if (is_active === 1 || is_active === true || is_active === '1') {
        await deactivateAllAcademicYearsService();
        updates.push('is_active = 1');
    } else if (is_active === 0 || is_active === false || is_active === '0') {
        updates.push('is_active = 0');
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');
    args.push(Number(id));
    const result = await db.execute({ sql: `UPDATE academic_years SET ${updates.join(', ')} WHERE id = ?`, args });
    if (result.rowsAffected === 0) throw new Error('Tahun ajaran tidak ditemukan');
    return { id: Number(id) };
};

export const activateAcademicYearService = async (id) => {
    const exists = await db.execute({ sql: 'SELECT id FROM academic_years WHERE id = ?', args: [Number(id)] });
    if (exists.rows.length === 0) throw new Error('Tahun ajaran tidak ditemukan');
    await deactivateAllAcademicYearsService();
    await db.execute({ sql: 'UPDATE academic_years SET is_active = 1 WHERE id = ?', args: [Number(id)] });
    return { id: Number(id) };
};

const deactivateAllAcademicYearsService = async () => {
    await db.execute('UPDATE academic_years SET is_active = 0');
};

export const deleteAcademicYearService = async (id) => {
    const result = await db.execute({ sql: 'DELETE FROM academic_years WHERE id = ?', args: [Number(id)] });
    return result.rowsAffected > 0;
};

// ============================================================================
// JENJANG (terscope lembaga untuk CRUD)
// ============================================================================

export const getAllJenjangService = async (lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    let sql = 'SELECT id, nama_jenjang, lembaga FROM jenjang ORDER BY id ASC';
    const args = [];
    if (l !== 'ALL') {
        sql = `SELECT id, nama_jenjang, lembaga FROM jenjang WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all' ORDER BY id ASC`;
        args.push(l);
    }
    const result = await db.execute({ sql, args });
    return result.rows;
};

export const createJenjangService = async ({ nama_jenjang, lembaga: lembagaBody }, lembaga = 'ALL') => {
    const nama = String(nama_jenjang || '').trim();
    if (!nama) throw new Error('Nama jenjang wajib diisi');
    const l = (lembaga || 'ALL').toUpperCase();
    const targetLembaga = l === 'ALL' ? String(lembagaBody || 'ALL').toUpperCase() : l;
    const result = await db.execute({
        sql: 'INSERT INTO jenjang (nama_jenjang, lembaga) VALUES (?, ?)',
        args: [nama, targetLembaga]
    });
    return { id: result.lastInsertRowid, nama_jenjang: nama, lembaga: targetLembaga };
};

export const updateJenjangService = async (id, { nama_jenjang }, lembaga = 'ALL') => {
    const nama = String(nama_jenjang || '').trim();
    if (!nama) throw new Error('Nama jenjang wajib diisi');
    const l = (lembaga || 'ALL').toUpperCase();
    const scope = l === 'ALL' ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    const args = l === 'ALL' ? [nama, Number(id)] : [nama, Number(id), l];
    const result = await db.execute({ sql: `UPDATE jenjang SET nama_jenjang = ? WHERE ${scope}`, args });
    if (result.rowsAffected === 0) throw new Error('Jenjang tidak ditemukan atau di luar lingkup lembaga');
    return { id: Number(id), nama_jenjang: nama };
};

export const deleteJenjangService = async (id, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const scope = l === 'ALL' ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    const args = l === 'ALL' ? [Number(id)] : [Number(id), l];
    const result = await db.execute({ sql: `DELETE FROM jenjang WHERE ${scope}`, args });
    if (result.rowsAffected === 0) throw new Error('Jenjang tidak ditemukan atau di luar lingkup lembaga');
    return { id: Number(id) };
};

// ============================================================================
// ROMBEL (satu tabel `rombels`, dibedakan via kolom `sumber`)
// ============================================================================

export const getAllRombelService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` WHERE ${s.rombelFilter}`;
    const result = await db.execute(`SELECT id, nama_rombel FROM ${s.rombelTable}${scope} ORDER BY id ASC`);
    return result.rows;
};

export const createRombelService = async ({ nama_rombel }, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const nama = String(nama_rombel || '').trim();
    if (!nama) throw new Error('Nama rombel wajib diisi');
    const result = await db.execute({ sql: `INSERT INTO ${s.rombelTable} (sumber, nama_rombel) VALUES (?, ?)`, args: [s.sumber, nama] });
    return { id: result.lastInsertRowid, nama_rombel: nama };
};

export const updateRombelService = async (id, { nama_rombel }, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` AND ${s.rombelFilter}`;
    const nama = String(nama_rombel || '').trim();
    if (!nama) throw new Error('Nama rombel wajib diisi');
    const result = await db.execute({ sql: `UPDATE ${s.rombelTable} SET nama_rombel = ? WHERE id = ?${scope}`, args: [nama, Number(id)] });
    if (result.rowsAffected === 0) throw new Error('Rombel tidak ditemukan');
    return { id: Number(id), nama_rombel: nama };
};

export const deleteRombelService = async (id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ` AND ${s.rombelFilter}`;
    const result = await db.execute({ sql: `DELETE FROM ${s.rombelTable} WHERE id = ?${scope}`, args: [Number(id)] });
    return result.rowsAffected > 0;
};

// ============================================================================
// MATA PELAJARAN (SUBJEK) — terscope lembaga
// ============================================================================

export const getAllSubjectsService = async (lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    let sql = 'SELECT id, subject_code, subject_name, lembaga FROM subjects ORDER BY id ASC';
    const args = [];
    if (l !== 'ALL') {
        sql = `SELECT id, subject_code, subject_name, lembaga FROM subjects WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all' ORDER BY id ASC`;
        args.push(l);
    }
    const result = await db.execute({ sql, args });
    return result.rows;
};

export const createSubjectService = async ({ subject_code, subject_name, lembaga: lembagaBody }, lembaga = 'ALL') => {
    const code = String(subject_code || '').trim();
    const name = String(subject_name || '').trim();
    if (!code) throw new Error('Kode mapel wajib diisi');
    if (!name) throw new Error('Nama mapel wajib diisi');
    const l = (lembaga || 'ALL').toUpperCase();
    const targetLembaga = l === 'ALL' ? String(lembagaBody || 'ALL').toUpperCase() : l;
    const dup = await db.execute({ sql: 'SELECT id FROM subjects WHERE subject_code = ?', args: [code] });
    if (dup.rows.length > 0) throw new Error(`Kode mapel ${code} sudah digunakan`);
    const result = await db.execute({
        sql: 'INSERT INTO subjects (subject_code, subject_name, lembaga) VALUES (?, ?, ?)',
        args: [code, name, targetLembaga]
    });
    return { id: result.lastInsertRowid, subject_code: code, subject_name: name, lembaga: targetLembaga };
};

export const updateSubjectService = async (id, { subject_code, subject_name }, lembaga = 'ALL') => {
    const updates = [];
    const args = [];
    const l = (lembaga || 'ALL').toUpperCase();
    if (subject_code) {
        const code = String(subject_code).trim();
        if (!l || l === '' || l === 'ALL') {
            const dup = await db.execute({ sql: 'SELECT id FROM subjects WHERE subject_code = ? AND id != ?', args: [code, Number(id)] });
            if (dup.rows.length > 0) throw new Error(`Kode mapel ${code} sudah digunakan`);
        } else {
            const dup = await db.execute({ sql: 'SELECT id FROM subjects WHERE subject_code = ? AND id != ? AND (LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = \'all\')', args: [code, Number(id), l] });
            if (dup.rows.length > 0) throw new Error(`Kode mapel ${code} sudah digunakan`);
        }
        updates.push('subject_code = ?');
        args.push(code);
    }
    if (subject_name) { updates.push('subject_name = ?'); args.push(String(subject_name).trim()); }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');
    const scope = l === 'ALL' ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    args.push(Number(id));
    if (l !== 'ALL') args.push(l);
    const result = await db.execute({ sql: `UPDATE subjects SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${scope}`, args });
    if (result.rowsAffected === 0) throw new Error('Mapel tidak ditemukan atau di luar lingkup lembaga');
    return { id: Number(id) };
};

export const deleteSubjectService = async (id, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const scope = l === 'ALL' ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    const args = l === 'ALL' ? [Number(id)] : [Number(id), l];
    const result = await db.execute({ sql: `DELETE FROM subjects WHERE ${scope}`, args });
    if (result.rowsAffected === 0) throw new Error('Mapel tidak ditemukan atau di luar lingkup lembaga');
    return { id: Number(id) };
};
