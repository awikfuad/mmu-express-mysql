import db from '../config/db.js';
import bcrypt from 'bcrypt';
import env from '../config/env.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Upsert biodata ke tabel induk gabungan (santri_biodata), dibedakan via kolom `sumber`.
const upsertMasterBiodata = async (s, { nim, name, classroom_id, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali }) => {
    if (!nim) return;

    let kelasName = null;
    if (classroom_id) {
        const kelas = await db.execute({
            sql: `SELECT class_name FROM ${s.kelasTable} WHERE id = ?`,
            args: [classroom_id]
        });
        kelasName = kelas.rows[0]?.class_name || null;
    }

    const existing = await db.execute({
        sql: `SELECT id FROM ${s.masterTable} WHERE nim = ? AND LOWER(sumber) = LOWER(?) LIMIT 1`,
        args: [nim, s.sumber]
    });

    const nama = name !== undefined ? name : null;
    const jk = jenis_kelamin !== undefined && jenis_kelamin !== '' ? jenis_kelamin : null;
    const nikFinal = nik !== undefined && nik !== '' ? nik : null;
    const kkFinal = kk !== undefined && kk !== '' ? kk : null;
    const tglLahirFinal = tanggal_lahir !== undefined && tanggal_lahir !== '' ? tanggal_lahir : null;
    const fotoFinal = foto !== undefined && foto !== '' ? foto : null;
    const tempatFinal = tempat !== undefined ? tempat : null;
    const tahunMasukFinal = tahun_masuk !== undefined ? tahun_masuk : null;
    const dusunFinal = dusun !== undefined ? dusun : null;
    const desaFinal = desa !== undefined ? desa : null;
    const kecamatanFinal = kecamatan !== undefined ? kecamatan : null;
    const kabupatenFinal = kabupaten !== undefined ? kabupaten : null;
    const waliFinal = wali !== undefined ? wali : null;

    if (existing.rows.length) {
        await db.execute({
            sql: `UPDATE ${s.masterTable} SET nama = COALESCE(?, nama), kelas = COALESCE(?, kelas), jenis_kelamin = COALESCE(?, jenis_kelamin), nik = COALESCE(?, nik), kk = COALESCE(?, kk), tanggal_lahir = COALESCE(?, tanggal_lahir), foto = COALESCE(?, foto), tempat = COALESCE(?, tempat), tahun_masuk = COALESCE(?, tahun_masuk), dusun = COALESCE(?, dusun), desa = COALESCE(?, desa), kecamatan = COALESCE(?, kecamatan), kabupaten = COALESCE(?, kabupaten), wali = COALESCE(?, wali) WHERE nim = ? AND LOWER(sumber) = LOWER(?)`,
            args: [nama, kelasName, jk, nikFinal, kkFinal, tglLahirFinal, fotoFinal, tempatFinal, tahunMasukFinal, dusunFinal, desaFinal, kecamatanFinal, kabupatenFinal, waliFinal, nim, s.sumber]
        });
    } else {
        await db.execute({
            sql: `INSERT INTO ${s.masterTable} (sumber, nim, nama, kelas, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [s.sumber, nim, nama, kelasName, jk, nikFinal, kkFinal, tglLahirFinal, fotoFinal, tempatFinal, tahunMasukFinal, dusunFinal, desaFinal, kecamatanFinal, kabupatenFinal, waliFinal]
        });
    }
};

// Resolve lembaga/sumber target secara dinamis dari database (classes / jenjang)
const resolveTargetLembaga = async (s, { classroom_id, jenjang_id }) => {
    if (!s.isAll) return s.lembaga;

    // 1. Cek berdasarkan kelas terpilih
    if (classroom_id) {
        const kelas = await db.execute({
            sql: 'SELECT sumber FROM classes WHERE id = ?',
            args: [classroom_id]
        });
        const ks = kelas.rows[0]?.sumber;
        if (ks && ks.toLowerCase() !== 'all') return ks.toUpperCase();
    }

    // 2. Fallback: Cek berdasarkan jenjang terpilih
    if (jenjang_id) {
        const jenjang = await db.execute({
            sql: 'SELECT lembaga FROM jenjang WHERE id = ?',
            args: [jenjang_id]
        });
        const jl = jenjang.rows[0]?.lembaga;
        if (jl && jl.toLowerCase() !== 'all') return jl.toUpperCase();
    }

    return s.lembaga;
};

// 1. AMBIL SEMUA DATA SANTRI
export const getAllMuridKelasService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ' WHERE LOWER(m.sumber) = LOWER(?)';

    const query = `
        SELECT m.*, ac.year_name, j.nama_jenjang, r.nama_rombel, c.class_name,
               COALESCE(NULLIF(TRIM(dm.jenis_kelamin), ''), m.jenis_kelamin) AS jenis_kelamin,
               dm.nik AS nik, dm.kk AS kk, dm.foto AS foto, dm.tanggal_lahir AS tanggal_lahir
        FROM ${s.santriTable} m
        LEFT JOIN academic_years ac ON m.academic_year_id = ac.id
        LEFT JOIN jenjang j ON m.jenjang_id = j.id
        LEFT JOIN ${s.rombelTable} r ON m.rombel_id = r.id
        LEFT JOIN ${s.kelasTable} c ON m.classroom_id = c.id 
        LEFT JOIN ${s.masterTable} dm ON m.nim = dm.nim AND LOWER(m.sumber) = LOWER(dm.sumber)
        ${scope}
        ORDER BY m.name ASC
    `;
    const result = await db.execute({
        sql: query,
        args: s.isAll ? [] : [s.sumber]
    });
    return result.rows;
};

// 2. TAMBAH SANTRI BARU
export const createMuridKelasService = async (studentData, lembaga = 'ALL') => {
    const { nim, name, academic_year_id, classroom_id, rombel_id, jenjang_id, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali } = studentData;
    
    const userLembaga = (lembaga || 'ALL').toUpperCase();
    const targetLembaga = await resolveTargetLembaga(getSumber(lembaga), { classroom_id, jenjang_id });
    const s = getSumber(targetLembaga);

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(env.defaultResetPassword, salt);

    const query = `
        INSERT INTO ${s.santriTable} (sumber, nim, name, password, academic_year_id, classroom_id, rombel_id, jenjang_id, jenis_kelamin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [s.sumber, nim, name, hashedPassword, academic_year_id || null, classroom_id || null, rombel_id || null, jenjang_id || null, jenis_kelamin || 'LAKI-LAKI']
    });

    const placementId = result.lastInsertRowid;

    const tglLahirForLogin = tanggal_lahir || null;
    const studentResult = await db.execute({
        sql: `INSERT IGNORE INTO students (nim, name, password, academic_year_id, jenjang_id, lembaga, tanggal_lahir)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [nim, name, hashedPassword, academic_year_id || null, jenjang_id || null, userLembaga, tglLahirForLogin]
    });

    const lookup = await db.execute({
        sql: `SELECT id FROM students WHERE nim = ? LIMIT 1`,
        args: [nim]
    });
    const studentId = lookup.rows[0]?.id ?? studentResult.lastInsertRowid;
    if (studentId) {
        await db.execute({
            sql: `UPDATE ${s.santriTable} SET student_id = ? WHERE id = ?`,
            args: [studentId, placementId]
        });
    }

    await upsertMasterBiodata(s, { nim, name, classroom_id, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali });

    return { id: placementId, nim, name, classroom_id, student_id: studentId };
};

// 3. UPDATE DATA SANTRI
export const updateMuridKelasService = async (id, studentData, lembaga = 'ALL') => {
    const { nim, name, classroom_id, status, rombel_id, jenjang_id, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali } = studentData;
    const base = getSumber(lembaga);
    
    const sourceFootprintChanged = base.isAll && ((classroom_id !== undefined && classroom_id !== null) || (jenjang_id !== undefined && jenjang_id !== null));
    const s = sourceFootprintChanged
        ? getSumber(await resolveTargetLembaga(base, { classroom_id, jenjang_id }))
        : base;

    const updates = [];
    const args = [];
    const setField = (field, value) => {
        if (value !== undefined && value !== null) {
            updates.push(`${field} = ?`);
            args.push(value);
        }
    };
    setField('nim', nim);
    setField('name', name);
    setField('classroom_id', classroom_id);
    setField('status', status);
    setField('rombel_id', rombel_id);
    setField('jenjang_id', jenjang_id);
    setField('jenis_kelamin', jenis_kelamin);

    if (base.isAll && sourceFootprintChanged && !updates.includes('sumber = ?')) {
        updates.push('sumber = ?');
        args.push(s.sumber);
    }

    if (updates.length) {
        args.push(id);
        const scope = base.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';
        if (!base.isAll) args.push(base.sumber);
        await db.execute({
            sql: `UPDATE ${s.santriTable} SET ${updates.join(', ')} WHERE id = ?${scope}`,
            args
        });
    }

    if (base.isAll && sourceFootprintChanged) {
        await db.execute({
            sql: `UPDATE students SET lembaga = ? WHERE id = (SELECT student_id FROM ${s.santriTable} WHERE id = ?)`,
            args: [s.lembaga, id]
        });
    }

    const hasStudentSync = [nim, name, tanggal_lahir, jenjang_id].some((v) => v !== undefined && v !== null);
    if (hasStudentSync) {
        const placement = await db.execute({
            sql: `SELECT student_id, nim AS placement_nim FROM ${s.santriTable} WHERE id = ?${s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)'}`,
            args: s.isAll ? [id] : [id, s.sumber]
        });
        const studentId = placement.rows[0]?.student_id;
        const currentNim = nim || placement.rows[0]?.placement_nim;

        if (studentId) {
            if (nim !== undefined) {
                const existingAcc = await db.execute({
                    sql: `SELECT id FROM students WHERE nim = ? AND id != ? LIMIT 1`,
                    args: [nim, studentId]
                });
                if (existingAcc.rows[0]) {
                    await db.execute({
                        sql: `UPDATE ${s.santriTable} SET student_id = ? WHERE id = ?`,
                        args: [existingAcc.rows[0].id, id]
                    });
                } else {
                    const sUpdates = [];
                    const sArgs = [];
                    if (nim !== undefined) { sUpdates.push('nim = ?'); sArgs.push(nim); }
                    if (name !== undefined) { sUpdates.push('name = ?'); sArgs.push(name); }
                    if (tanggal_lahir !== undefined) { sUpdates.push('tanggal_lahir = ?'); sArgs.push(tanggal_lahir || null); }
                    if (jenjang_id !== undefined) { sUpdates.push('jenjang_id = ?'); sArgs.push(jenjang_id || null); }
                    if (sUpdates.length) {
                        sArgs.push(studentId);
                        await db.execute({ sql: `UPDATE students SET ${sUpdates.join(', ')} WHERE id = ?`, args: sArgs });
                    }
                }
            } else {
                const sUpdates = [];
                const sArgs = [];
                if (name !== undefined) { sUpdates.push('name = ?'); sArgs.push(name); }
                if (tanggal_lahir !== undefined) { sUpdates.push('tanggal_lahir = ?'); sArgs.push(tanggal_lahir || null); }
                if (jenjang_id !== undefined) { sUpdates.push('jenjang_id = ?'); sArgs.push(jenjang_id || null); }
                if (sUpdates.length) {
                    sArgs.push(studentId);
                    await db.execute({ sql: `UPDATE students SET ${sUpdates.join(', ')} WHERE id = ?`, args: sArgs });
                }
            }
        } else if (currentNim) {
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(env.defaultResetPassword, salt);
            const studentResult = await db.execute({
                sql: `INSERT IGNORE INTO students (nim, name, password, academic_year_id, jenjang_id, lembaga, tanggal_lahir)
SELECT ?, ?, ?, academic_year_id, jenjang_id, ?, ?
                    FROM ${s.santriTable} WHERE id = ?${s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)'}`,
                args: s.isAll ? [currentNim, name || currentNim, hashedPassword, (lembaga || 'ALL').toUpperCase(), tanggal_lahir || null, id] : [currentNim, name || currentNim, hashedPassword, (lembaga || 'ALL').toUpperCase(), tanggal_lahir || null, id, s.sumber]
            });
            const stLookup = await db.execute({
                sql: `SELECT id FROM students WHERE nim = ? LIMIT 1`,
                args: [currentNim]
            });
            const linkedStudentId = stLookup.rows[0]?.id ?? studentResult.lastInsertRowid;
            if (linkedStudentId) {
                await db.execute({
                    sql: `UPDATE ${s.santriTable} SET student_id = ? WHERE id = ?`,
                    args: [linkedStudentId, id]
                });
            }
        }
    }

    const hasBiodata = [nik, kk, tanggal_lahir, foto, jenis_kelamin, name, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali].some((v) => v !== undefined && v !== null);
    if (hasBiodata) {
        const nimForBio = nim || (await db.execute({
            sql: `SELECT nim FROM ${s.santriTable} WHERE id = ?${s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)'}`,
            args: s.isAll ? [id] : [id, s.sumber]
        })).rows[0]?.nim;
        const classroomForBio = classroom_id !== undefined ? classroom_id : (await db.execute({
            sql: `SELECT classroom_id FROM ${s.santriTable} WHERE id = ?${s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)'}`,
            args: s.isAll ? [id] : [id, s.sumber]
        })).rows[0]?.classroom_id;
        await upsertMasterBiodata(s, { nim: nimForBio, name, classroom_id: classroomForBio, jenis_kelamin, nik, kk, tanggal_lahir, foto, tempat, tahun_masuk, dusun, desa, kecamatan, kabupaten, wali });
    }

    return { id, nim, name, classroom_id, status };
};

export const updateMuridKelasStatusService = async (id, studentData, lembaga = 'ALL') => {
    const { status } = studentData;
    const s = getSumber(lembaga);

    const scope = s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';
    const args = [status, id];
    if (!s.isAll) args.push(s.sumber);

    const query = `
        UPDATE ${s.santriTable} SET status = ? WHERE id = ?${scope}
    `;
    await db.execute({ sql: query, args });

    return { status };
};

// 4. HAPUS SANTRI
export const deleteMuridKelasService = async (id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';
    const args = [id];
    if (!s.isAll) args.push(s.sumber);
    
    await db.execute({
        sql: `DELETE FROM ${s.santriTable} WHERE id = ?${scope}`,
        args
    });
    return { id };  
};

export const getMuridKelasByNimService = async (nim, academic_year_id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';
    const args = [nim, academic_year_id];
    if (!s.isAll) args.push(s.sumber);

    const result = await db.execute({
        sql: `SELECT * FROM ${s.santriTable} WHERE nim = ? AND academic_year_id = ?${scope} ORDER BY id DESC LIMIT 1`,
        args
    });
    return result.rows[0];  
};

// Cari santri berdasarkan NIM
export const getSiswaByNimService = async (nim, academic_year_id, lembaga = 'ALL') => {
    const currentTA = academic_year_id || null;
    const s = getSumber(lembaga);
    const scope = s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';

    const sqlQuery = currentTA
        ? `SELECT * FROM ${s.santriTable} WHERE nim = ? AND academic_year_id = ?${scope} ORDER BY id DESC LIMIT 1`
        : `SELECT * FROM ${s.santriTable} WHERE nim = ?${scope} ORDER BY id DESC LIMIT 1`;
    
    const queryArgs = currentTA ? [nim, currentTA] : [nim];
    if (!s.isAll) queryArgs.push(s.sumber);

    const sumber = await db.execute({
        sql: sqlQuery,
        args: queryArgs
    });

    if (sumber.rows[0]) {
        return { ...sumber.rows[0] };
    }

    const students = await db.execute({
        sql: "SELECT * FROM students WHERE nim = ? ORDER BY id DESC LIMIT 1",
        args: [nim]
    });
    if (students.rows[0]) {
        return { sumber: 'students', ...students.rows[0] };
    }

    return null;
};