import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

export const getAllSiswiHaidService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scopeFilter = s.isAll ? '' : `AND sh.nim IN (SELECT nim FROM ${s.santriTable} WHERE ${s.sumberFilter})`;
    const result = await db.execute({
        sql: `SELECT sh.*,
                     (SELECT jenis_kelamin FROM santri_penempatan sp WHERE sp.nim = sh.nim LIMIT 1) AS jenis_kelamin
              FROM siswi_haid sh
              WHERE 1 = 1 ${scopeFilter}
              ORDER BY sh.tanggal_mulai_haid DESC`
    });
    return result.rows;
};

export const getSiswiHaidByIdService = async (id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const scopeFilter = s.isAll ? '' : `AND sh.nim IN (SELECT nim FROM ${s.santriTable} WHERE ${s.sumberFilter})`;
    const result = await db.execute({
        sql: `SELECT sh.*,
                     (SELECT jenis_kelamin FROM santri_penempatan sp WHERE sp.nim = sh.nim LIMIT 1) AS jenis_kelamin
              FROM siswi_haid sh
              WHERE sh.id = ? ${scopeFilter}`,
        args: [id]
    });
    return result.rows[0];
};

export const createSiswiHaidService = async (data) => {
    const { nim, nama, kelas, adat, tanggal_mulai_haid } = data;
    const result = await db.execute({
        sql: 'INSERT INTO siswi_haid (nim, nama, kelas, adat, tanggal_mulai_haid) VALUES (?, ?, ?, ?, ?)',
        args: [nim, nama, kelas, adat, tanggal_mulai_haid]
    });
    return { id: result.lastInsertRowid, nim, nama, kelas, adat, tanggal_mulai_haid };
};

export const updateSiswiHaidService = async (id, data) => {
    const { nim, nama, kelas, adat, tanggal_mulai_haid } = data;
    await db.execute({
        sql: 'UPDATE siswi_haid SET nim = ?, nama = ?, kelas = ?, adat = ?, tanggal_mulai_haid = ? WHERE id = ?',
        args: [nim, nama, kelas, adat, tanggal_mulai_haid, id]
    });
    return { id, nim, nama, kelas, adat, tanggal_mulai_haid };
};

export const deleteSiswiHaidService = async (id) => {
    await db.execute({
        sql: 'DELETE FROM siswi_haid WHERE id = ?',
        args: [id]
    });
    return { id };
};
