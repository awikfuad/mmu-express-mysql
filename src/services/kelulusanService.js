import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// ============================================================
// STATUS KELULUSAN & ALUMNI
// — kelulusan (LULUS / MUTASI_KELUAR / MUTASI_MASUK) + alumni
// ============================================================

export const JENIS_KELULUSAN = ['LULUS', 'MUTASI_KELUAR', 'MUTASI_MASUK'];

const getContext = (lembaga) => {
    const s = getSumber(String(lembaga || 'ALL').toUpperCase());
    return { lembaga: s.lembaga, isAll: s.isAll, sumber: s.sumber };
};

const scopeClause = (ctx, alias) => {
    if (ctx.isAll) return '';
    return ` AND ${alias}.lembaga = ?`;
};

const isValidTanggal = (v) => {
    if (!v) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
};

const todayStr = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ============ KELULUSAN / MUTASI ============

export const getKelulusanService = async (filters = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (filters.jenis) {
        const jenisFinal = String(filters.jenis).toUpperCase();
        if (!JENIS_KELULUSAN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_KELULUSAN.join(', ')}`);
        conditions.push('k.jenis = ?');
        args.push(jenisFinal);
    }
    if (filters.academic_year_id) {
        conditions.push('k.academic_year_id = ?');
        args.push(Number(filters.academic_year_id));
    }
    if (filters.classroom_id) {
        conditions.push('k.classroom_id = ?');
        args.push(Number(filters.classroom_id));
    }
    if (filters.jenjang_id) {
        conditions.push('k.jenjang_id = ?');
        args.push(Number(filters.jenjang_id));
    }
    if (filters.tahun) {
        conditions.push('LEFT(k.tanggal, 4) = ?');
        args.push(String(filters.tahun));
    }
    if (filters.search && String(filters.search).trim()) {
        conditions.push('(k.nim LIKE ? OR k.name LIKE ?)');
        const like = `%${String(filters.search).trim()}%`;
        args.push(like, like);
    }
    const scope = scopeClause(ctx, 'k');
    if (scope) args.push(ctx.lembaga);

    const query = `
        SELECT k.*, ac.year_name, j.nama_jenjang, c.class_name
        FROM kelulusan k
        LEFT JOIN academic_years ac ON k.academic_year_id = ac.id
        LEFT JOIN jenjang j ON k.jenjang_id = j.id
        LEFT JOIN classes c ON k.classroom_id = c.id
        WHERE 1=1 ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}${scope}
        ORDER BY k.tanggal DESC, k.created_at DESC, k.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Roster santri aktif yang berhak di-klaim lulus/mutasi (status=1), termasuk yang sudah diproses.
export const getKelulusanRosterService = async (filters = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const s = getSumber(ctx.lembaga);
    const conditions = ['m.status = 1'];
    const args = [];

    if (filters.academic_year_id) {
        conditions.push('m.academic_year_id = ?');
        args.push(Number(filters.academic_year_id));
    }
    if (filters.classroom_id) {
        conditions.push('m.classroom_id = ?');
        args.push(Number(filters.classroom_id));
    }
    if (filters.jenjang_id) {
        conditions.push('m.jenjang_id = ?');
        args.push(Number(filters.jenjang_id));
    }
    if (filters.search && String(filters.search).trim()) {
        conditions.push('(m.nim LIKE ? OR m.name LIKE ?)');
        const like = `%${String(filters.search).trim()}%`;
        args.push(like, like);
    }
    if (!s.isAll) {
        conditions.push('LOWER(m.sumber) = LOWER(?)');
        args.push(s.sumber);
    }

    const query = `
        SELECT m.id AS murid_id, m.sumber, m.nim, m.name, m.classroom_id, c.class_name,
               m.jenjang_id, j.nama_jenjang, m.academic_year_id, ac.year_name,
               COALESCE(m.jenis_kelamin, dm.jenis_kelamin) AS jenis_kelamin,
               dm.tanggal_lahir AS tanggal_lahir, m.status
        FROM ${s.santriTable} m
        LEFT JOIN academic_years ac ON m.academic_year_id = ac.id
        LEFT JOIN jenjang j ON m.jenjang_id = j.id
        LEFT JOIN ${s.kelasTable} c ON m.classroom_id = c.id
        LEFT JOIN ${s.masterTable} dm ON m.nim = dm.nim AND LOWER(m.sumber) = LOWER(dm.sumber)
        WHERE ${conditions.join(' AND ')}
        ORDER BY m.name ASC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

export const createKelulusanService = async (data, lembaga = 'ALL', actorName = '') => {
    const ctx = getContext(lembaga);

    const jenisFinal = String(data.jenis || '').toUpperCase();
    if (!JENIS_KELULUSAN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_KELULUSAN.join(', ')}`);

    const tanggal = data.tanggal || todayStr();
    if (!isValidTanggal(tanggal)) throw new Error('Tanggal harus format YYYY-MM-DD');

    let murid = null;

    // LULUS / MUTASI_KELUAR diambil dari roster penempatan aktif (terscope lembaga).
    // MUTASI_MASUK cukup log manual dengan nim & name.
    if (jenisFinal !== 'MUTASI_MASUK') {
        if (!data.murid_id) throw new Error('murid_id wajib diisi utk LULUS / MUTASI_KELUAR');
        const s = getSumber(ctx.lembaga);
        const scope = s.isAll || ctx.isAll ? '' : ' AND LOWER(m.sumber) = LOWER(?)';
        const args = [Number(data.murid_id)];
        if (scope) args.push(s.sumber);
        const res = await db.execute({
            sql: `SELECT m.*, c.class_name FROM ${s.santriTable} m LEFT JOIN ${s.kelasTable} c ON m.classroom_id = c.id WHERE m.id = ?${scope}`,
            args
        });
        murid = res.rows[0];
        if (!murid) throw new Error('Santri tidak ditemukan / di luar lembaga Anda');
    }

    const statements = [];

    const insertKelulusan = async (kelData) => {
        const result = await db.execute({
            sql: `
                INSERT INTO kelulusan (murid_id, sumber, nim, name, classroom_id, jenjang_id, academic_year_id, kelas_lulus, jenis, tanggal, keterangan, lembaga, dibuat_oleh)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                kelData.murid_id,
                kelData.sumber,
                kelData.nim,
                kelData.name,
                kelData.classroom_id,
                kelData.jenjang_id,
                kelData.academic_year_id,
                kelData.kelas_lulus,
                jenisFinal,
                tanggal,
                kelData.keterangan || null,
                ctx.lembaga,
                actorName || null
            ]
        });
        return Number(result.lastInsertRowid);
    };

    let kelulusanId;

    if (jenisFinal === 'MUTASI_MASUK') {
        const nim = String(data.nim || '').trim();
        const name = String(data.name || '').trim();
        if (!nim || !name) throw new Error('nim & name wajib diisi utk mutasi masuk');
        kelulusanId = await insertKelulusan({
            murid_id: data.murid_id || null,
            sumber: data.sumber || ctx.sumber,
            nim,
            name,
            classroom_id: data.classroom_id || null,
            jenjang_id: data.jenjang_id || null,
            academic_year_id: data.academic_year_id || null,
            kelas_lulus: data.kelas_lulus || null,
            keterangan: data.keterangan
        });
        return { id: kelulusanId };
    }

    // LULUS / MUTASI_KELUAR: nonaktifkan penempatan + catat log + (bila LULUS) buat alumni
    if (jenisFinal === 'LULUS') {
        kelulusanId = await insertKelulusan({
            murid_id: murid.id,
            sumber: murid.sumber,
            nim: murid.nim,
            name: murid.name,
            classroom_id: murid.classroom_id,
            jenjang_id: murid.jenjang_id,
            academic_year_id: murid.academic_year_id,
            kelas_lulus: murid.class_name || null,
            keterangan: data.keterangan
        });

        const tahunLulus = (data.tahun_lulus && String(data.tahun_lulus).trim()) || String(tanggal).slice(0, 4);
        const periksaAlumni = await db.execute({
            sql: "SELECT id FROM alumni WHERE nim = ? AND LOWER(sumber) = LOWER(?) LIMIT 1",
            args: [murid.nim, murid.sumber]
        });
        const alumniPayload = [
            kelulusanId,
            murid.nim,
            murid.name,
            murid.sumber,
            murid.jenis_kelamin || null,
            data.tanggal_lahir || null,
            murid.jenjang_id,
            murid.class_name || null,
            tahunLulus,
            data.no_hp || null,
            data.pekerjaan || null,
            data.alumni_keterangan || data.keterangan || null,
            ctx.lembaga
        ];
        if (periksaAlumni.rows[0]) {
            await db.execute({
                sql: `
                    UPDATE alumni SET kelulusan_id = ?, tahun_lulus = ?, kelas_lulus = ?,
                            no_hp = COALESCE(?, no_hp), pekerjaan = COALESCE(?, pekerjaan), keterangan = COALESCE(?, keterangan),
                            updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND LOWER(sumber) = LOWER(?)
                `,
                args: [kelulusanId, tahunLulus, murid.class_name || null, data.no_hp || null, data.pekerjaan || null, data.alumni_keterangan || data.keterangan || null, periksaAlumni.rows[0].id, murid.sumber]
            });
        } else {
            await db.execute({
                sql: `
                    INSERT INTO alumni (kelulusan_id, nim, name, sumber, jenis_kelamin, tanggal_lahir, jenjang_id, kelas_lulus, tahun_lulus, no_hp, pekerjaan, keterangan, lembaga)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                args: alumniPayload
            });
        }

        statements.push({
            sql: `UPDATE ${getSumber(ctx.lembaga).santriTable} SET status = 0 WHERE id = ?`,
            args: [murid.id]
        });
    } else {
        // MUTASI_KELUAR
        kelulusanId = await insertKelulusan({
            murid_id: murid.id,
            sumber: murid.sumber,
            nim: murid.nim,
            name: murid.name,
            classroom_id: murid.classroom_id,
            jenjang_id: murid.jenjang_id,
            academic_year_id: murid.academic_year_id,
            kelas_lulus: murid.class_name || null,
            keterangan: data.keterangan
        });
        statements.push({
            sql: `UPDATE ${getSumber(ctx.lembaga).santriTable} SET status = 0 WHERE id = ?`,
            args: [murid.id]
        });
    }

    if (statements.length) await db.batch(statements);

    return { id: kelulusanId, jenis: jenisFinal };
};

export const updateKelulusanService = async (id, data, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const s = getSumber(ctx.lembaga);
    const updates = [];
    const args = [];
    const push = (field, value) => { updates.push(`${field} = ?`); args.push(value); };

    if (data.tanggal !== undefined) {
        if (!isValidTanggal(data.tanggal)) throw new Error('Tanggal harus format YYYY-MM-DD');
        push('tanggal', data.tanggal);
    }
    if (data.keterangan !== undefined) push('keterangan', data.keterangan || null);
    if (data.classroom_id !== undefined) push('classroom_id', data.classroom_id || null);
    if (data.jenjang_id !== undefined) push('jenjang_id', data.jenjang_id || null);
    if (data.academic_year_id !== undefined) push('academic_year_id', data.academic_year_id || null);
    if (data.kelas_lulus !== undefined) push('kelas_lulus', data.kelas_lulus || null);

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const scope = scopeClause(ctx, 'k');
    args.push(Number(id));
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE kelulusan k SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE k.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deleteKelulusanService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const s = getSumber(ctx.lembaga);
    const scope = scopeClause(ctx, 'k');
    const args = [Number(id)];
    if (scope) args.push(ctx.lembaga);

    const res = await db.execute({
        sql: `SELECT * FROM kelulusan k WHERE k.id = ?${scope}`,
        args
    });
    const row = res.rows[0];
    if (!row) return false;

    const statements = [];
    if (row.murid_id && ['LULUS', 'MUTASI_KELUAR'].includes(row.jenis)) {
        // Pulihkan status penempatan bila masih ada
        statements.push({
            sql: `UPDATE ${s.santriTable} SET status = 1 WHERE id = ?`,
            args: [row.murid_id]
        });
    }
    if (row.jenis === 'LULUS') {
        statements.push({
            sql: 'DELETE FROM alumni WHERE nim = ? AND LOWER(sumber) = LOWER(?)',
            args: [row.nim, row.sumber || 'madrasah']
        });
    }
    statements.push({ sql: 'DELETE FROM kelulusan WHERE id = ?', args: [Number(id)] });
    await db.batch(statements);
    return true;
};

// ============ ALUMNI ============

export const getAlumniService = async (filters = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (filters.tahun_lulus) {
        conditions.push('a.tahun_lulus = ?');
        args.push(String(filters.tahun_lulus));
    }
    if (filters.jenjang_id) {
        conditions.push('a.jenjang_id = ?');
        args.push(Number(filters.jenjang_id));
    }
    if (filters.search && String(filters.search).trim()) {
        conditions.push('(a.nim LIKE ? OR a.name LIKE ? OR a.pekerjaan LIKE ?)');
        const like = `%${String(filters.search).trim()}%`;
        args.push(like, like, like);
    }
    const scope = scopeClause(ctx, 'a');
    if (scope) args.push(ctx.lembaga);

    const query = `
        SELECT a.*, j.nama_jenjang
        FROM alumni a
        LEFT JOIN jenjang j ON a.jenjang_id = j.id
        WHERE 1=1 ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}${scope}
        ORDER BY a.tahun_lulus DESC, a.name ASC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

export const updateAlumniService = async (id, data, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];
    const push = (field, value) => { updates.push(`${field} = ?`); args.push(value); };

    if (data.name !== undefined) {
        const name = String(data.name || '').trim();
        if (!name) throw new Error('Nama alumni wajib diisi');
        push('name', name);
    }
    if (data.no_hp !== undefined) push('no_hp', data.no_hp || null);
    if (data.pekerjaan !== undefined) push('pekerjaan', data.pekerjaan || null);
    if (data.tahun_lulus !== undefined) push('tahun_lulus', data.tahun_lulus || null);
    if (data.kelas_lulus !== undefined) push('kelas_lulus', data.kelas_lulus || null);
    if (data.jenis_kelamin !== undefined) push('jenis_kelamin', data.jenis_kelamin || null);
    if (data.keterangan !== undefined) push('keterangan', data.keterangan || null);

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const scope = scopeClause(ctx, 'a');
    args.push(Number(id));
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `UPDATE alumni a SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE a.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};

export const deleteAlumniService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scope = scopeClause(ctx, 'a');
    const args = [Number(id)];
    if (scope) args.push(ctx.lembaga);
    const result = await db.execute({
        sql: `DELETE FROM alumni a WHERE a.id = ?${scope}`,
        args
    });
    return result.rowsAffected > 0;
};