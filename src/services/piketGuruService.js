import db from '../config/db.js';

// Hari piket guru — Senin s.d. Ahad (Ahad = hari masuk madin/TPQ).
export const HARI_PIKET_GURU = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'AHAD'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

// Urutan pekan utk pengurutan (SENIN → AHAD)
const WEEKDAY_ORDER_CASE = `
    CASE p.day_of_week
        WHEN 'SENIN' THEN 0 WHEN 'SELASA' THEN 1 WHEN 'RABU' THEN 2 WHEN 'KAMIS' THEN 3
        WHEN 'JUMAT' THEN 4 WHEN 'SABTU' THEN 5 WHEN 'AHAD' THEN 6
    ELSE 7 END`;

const isValidTime = (v) => {
    if (!v || typeof v !== 'string') return false;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
};

// Daftar semua baris jadwal piket guru (terscope lembaga: lembaga sendiri + ALL).
export const getPiketGuruService = async (lembaga = 'ALL') => {
    const l = toUpper(lembaga) || 'ALL';
    const whereLembaga = l === 'ALL' ? '' : 'AND p.lembaga IN (?, ?)';
    const args = l === 'ALL' ? [] : [l, 'ALL'];

    const query = `
        SELECT p.id, p.day_of_week, p.start_time, p.end_time, p.teacher_id,
               t.name AS teacher_name, p.lembaga, p.created_at
        FROM piket_guru p
        LEFT JOIN teachers t ON p.teacher_id = t.id
        WHERE 1 = 1
        ${whereLembaga}
        ORDER BY ${WEEKDAY_ORDER_CASE}, p.start_time ASC, t.name ASC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan SALT slot (hari + jam): hapus seluruh baris lama untuk slot tsb lalu insert
// satu baris per guru piket yang dipilih (multi-select). Atomik via db.batch.
// teacher_ids kosong = bersihkan slot (hapus semua guru di slot tsb).
// payload.original ({day_of_week, start_time, end_time}) = slot lama saat EDIT (navigasi hari/jam).
export const savePiketGuruSlotService = async (payload, lembaga = 'ALL') => {
    const l = toUpper(lembaga) || 'ALL';
    const day = toUpper(payload?.day_of_week);
    const start_time = payload?.start_time;
    const end_time = payload?.end_time;

    if (!HARI_PIKET_GURU.includes(day)) {
        throw Object.assign(new Error('Hari piket tidak valid. Pilih Senin–Ahad.'), { status: 400 });
    }
    if (!isValidTime(start_time) || !isValidTime(end_time)) {
        throw Object.assign(new Error('Waktu mulai/selesai harus berformat HH:MM.'), { status: 400 });
    }
    if (start_time >= end_time) {
        throw Object.assign(new Error('Waktu selesai harus lebih besar dari waktu mulai.'), { status: 400 });
    }

    const rawTeachers = Array.isArray(payload?.teacher_ids) ? payload.teacher_ids : [];
    const teacherIds = [...new Set(rawTeachers.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];

    // Validasi guru: harus ada & terscope lembaga (lembaga sendiri + ALL)
    if (teacherIds.length > 0) {
        const scoles = l === 'ALL' ? '' : 'AND LOWER(lembaga) IN (LOWER(?), \'all\')';
        const scArgs = l === 'ALL' ? [] : [l];
        const placeholders = teacherIds.map(() => '?').join(',');
        const tRes = await db.execute({
            sql: `SELECT id FROM teachers WHERE id IN (${placeholders}) ${scoles}`,
            args: [...teacherIds, ...scArgs]
        });
        if (tRes.rows.length !== teacherIds.length) {
            throw Object.assign(new Error('Salah satu guru piket tidak ditemukan / di luar lembaga Anda.'), { status: 400 });
        }
    }

    // Slots yang dihapus: slot target (baru) + slot lama bila edit (original)
    const orig = payload?.original;
    const delKeys = new Set([`${day}|${start_time}|${end_time}`]);
    if (orig && toUpper(orig.day_of_week) && isValidTime(orig.start_time) && isValidTime(orig.end_time)) {
        delKeys.add(`${toUpper(orig.day_of_week)}|${orig.start_time}|${orig.end_time}`);
    }

    const ops = [];
    for (const key of delKeys) {
        const [d, st, et] = key.split('|');
        ops.push({
            sql: 'DELETE FROM piket_guru WHERE day_of_week = ? AND start_time = ? AND end_time = ? AND lembaga IN (?, ?)',
            args: [d, st, et, l, 'ALL']
        });
    }
    for (const tid of teacherIds) {
        ops.push({
            sql: 'INSERT INTO piket_guru (day_of_week, start_time, end_time, teacher_id, lembaga) VALUES (?, ?, ?, ?, ?)',
            args: [day, start_time, end_time, tid, l]
        });
    }
    await db.batch(ops, 'write');

    return { day_of_week: day, start_time, end_time, teacher_ids: teacherIds, count: teacherIds.length };
};

// Hapus satu baris (satu guru dari sebuah slot). Terscope lembaga.
export const deletePiketGuruService = async (id, lembaga = 'ALL') => {
    const l = toUpper(lembaga) || 'ALL';
    const rowId = Number(id);
    if (!Number.isInteger(rowId) || rowId <= 0) return false;

    const whereLembaga = l === 'ALL' ? '' : 'AND lembaga IN (?, ?)';
    const args = l === 'ALL' ? [rowId] : [rowId, l, 'ALL'];
    const result = await db.execute({
        sql: `DELETE FROM piket_guru WHERE id = ? ${whereLembaga}`,
        args
    });
    return Number(result.rowsAffected) > 0;
};