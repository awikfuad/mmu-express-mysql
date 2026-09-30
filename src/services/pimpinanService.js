import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Rotasi komisi piket pimpinan — hari kerja Senin s.d. Ahad (Ahad = hari masuk madin/TPQ).
export const HARI_PIKET = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU', 'AHAD'];

const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll
    };
};

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

// ============================================================
// MASTER DATA PIMPINAN
// ============================================================

// Daftar pimpinan (filter cari / status, terscope lembaga).
export const getPimpinanService = async ({ search, aktif }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (aktif !== undefined && aktif !== null && aktif !== '') {
        conditions.push('p.aktif = ?');
        args.push(Number(aktif) ? 1 : 0);
    }
    if (search && String(search).trim()) {
        conditions.push('(p.nama LIKE ? OR p.jabatan LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like);
    }
    if (!ctx.isAll) {
        conditions.push('LOWER(p.lembaga) = LOWER(?)');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT p.id, p.nama, p.jabatan, p.teacher_id, p.aktif, p.lembaga, p.created_at,
               t.name AS teacher_name,
               (SELECT COUNT(*) FROM piket_pimpinan pk WHERE pk.pimpinan_id = p.id) AS piket_count
        FROM pimpinan p
        LEFT JOIN teachers t ON t.id = p.teacher_id
        ${whereClause}
        ORDER BY p.aktif DESC, p.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

const resolveTeacherName = async (teacherId) => {
    const res = await db.execute({
        sql: 'SELECT id, name FROM teachers WHERE id = ?',
        args: [Number(teacherId)]
    });
    return res.rows[0] || null;
};

// Tambah pimpinan. Guru boleh merangkap pimpinan via teacher_id (nama terisi otomatis bila kosong).
export const createPimpinanService = async ({ nama, jabatan, teacher_id, aktif }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

    const jabatanFinal = String(jabatan || '').trim();
    if (!jabatanFinal) throw new Error('Jabatan wajib diisi');

    let teacherFinal = null;
    if (teacher_id !== undefined && teacher_id !== null && teacher_id !== '') {
        teacherFinal = Number(teacher_id);
        if (!Number.isInteger(teacherFinal) || teacherFinal <= 0) throw new Error('Guru tidak valid');
        const teacher = await resolveTeacherName(teacherFinal);
        if (!teacher) throw new Error('Guru tidak ditemukan');
    }

    let namaFinal = String(nama || '').trim();
    if (!namaFinal) {
        if (teacherFinal) {
            const teacher = await resolveTeacherName(teacherFinal);
            namaFinal = teacher.name;
        } else {
            throw new Error('Nama wajib diisi (atau pilih guru yang merangkap pimpinan)');
        }
    }

    // Satu guru hanya boleh merangkap sekali per lembaga.
    if (teacherFinal) {
        const dup = await db.execute({
            sql: ctx.isAll
                ? 'SELECT id FROM pimpinan WHERE teacher_id = ? AND id != 0'
                : 'SELECT id FROM pimpinan WHERE teacher_id = ? AND LOWER(lembaga) = LOWER(?)',
            args: ctx.isAll ? [teacherFinal] : [teacherFinal, ctx.lembaga]
        });
        if (dup.rows.length > 0) throw new Error('Guru tersebut sudah terdaftar sebagai pimpinan');
    }

    const result = await db.execute({
        sql: `
            INSERT INTO pimpinan (nama, jabatan, teacher_id, aktif, lembaga)
            VALUES (?, ?, ?, ?, ?)
        `,
        args: [
            namaFinal,
            jabatanFinal,
            teacherFinal,
            aktif !== undefined && Number(aktif) === 0 ? 0 : 1,
            ctx.lembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah pimpinan (SET dinamis, terscope lembaga).
export const updatePimpinanService = async (id, { nama, jabatan, teacher_id, aktif }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scopeId = await findOwnedPimpinan(Number(id), ctx);
    if (!scopeId) throw new Error('Pimpinan tidak ditemukan');

    const updates = [];
    const args = [];

    if (nama !== undefined) {
        const namaFinal = String(nama || '').trim();
        if (!namaFinal) throw new Error('Nama wajib diisi');
        updates.push('nama = ?');
        args.push(namaFinal);
    }
    if (jabatan !== undefined) {
        const jabatanFinal = String(jabatan || '').trim();
        if (!jabatanFinal) throw new Error('Jabatan wajib diisi');
        updates.push('jabatan = ?');
        args.push(jabatanFinal);
    }
    if (teacher_id !== undefined) {
        const teacherFinal = (teacher_id !== null && teacher_id !== '') ? Number(teacher_id) : null;
        if (teacherFinal !== null) {
            const teacher = await resolveTeacherName(teacherFinal);
            if (!teacher) throw new Error('Guru tidak ditemukan');
            const dup = await db.execute({
                sql: ctx.isAll
                    ? 'SELECT id FROM pimpinan WHERE teacher_id = ? AND id != ?'
                    : 'SELECT id FROM pimpinan WHERE teacher_id = ? AND LOWER(lembaga) = LOWER(?) AND id != ?',
                args: ctx.isAll ? [teacherFinal, Number(id)] : [teacherFinal, ctx.lembaga, Number(id)]
            });
            if (dup.rows.length > 0) throw new Error('Guru tersebut sudah terdaftar sebagai pimpinan');
        }
        updates.push('teacher_id = ?');
        args.push(teacherFinal);
    }
    if (aktif !== undefined) {
        updates.push('aktif = ?');
        args.push(Number(aktif) ? 1 : 0);
    }
    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const result = await db.execute({
        sql: `UPDATE pimpinan SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [...args, Number(id)]
    });
    return result.rowsAffected > 0;
};

// Hapus pimpinan + baris piket terkait (terscope lembaga).
export const deletePimpinanService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const scopeId = await findOwnedPimpinan(Number(id), ctx);
    if (!scopeId) return false;

    await db.execute({
        sql: 'DELETE FROM piket_pimpinan WHERE pimpinan_id = ?',
        args: [Number(id)]
    });
    const result = await db.execute({
        sql: 'DELETE FROM pimpinan WHERE id = ?',
        args: [Number(id)]
    });
    return result.rowsAffected > 0;
};

const findOwnedPimpinan = async (id, ctx) => {
    const res = await db.execute({
        sql: ctx.isAll
            ? 'SELECT id FROM pimpinan WHERE id = ?'
            : 'SELECT id FROM pimpinan WHERE id = ? AND LOWER(lembaga) = LOWER(?)',
        args: ctx.isAll ? [id] : [id, ctx.lembaga]
    });
    return res.rows[0]?.id ?? null;
};

// ============================================================
// ROTASI PIKET (SENIN-SABTU)
// ============================================================

// Roster piket pimpinan ter-group per hari (filter `hari` opsional), terscope lembaga.
export const getPiketPimpinanService = async ({ hari } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (hari) {
        const hariFinal = toUpper(hari);
        if (!HARI_PIKET.includes(hariFinal)) throw new Error(`Hari tidak valid! Pilih: ${HARI_PIKET.join(', ')}`);
        conditions.push('pp.hari = ?');
        args.push(hariFinal);
    }
    if (!ctx.isAll) {
        conditions.push('LOWER(pp.lembaga) = LOWER(?)');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT pp.id, pp.pimpinan_id, pp.hari, pp.urutan, pp.created_at,
               p.nama, p.jabatan, p.teacher_id, p.aktif,
               t.name AS teacher_name
        FROM piket_pimpinan pp
        JOIN pimpinan p ON p.id = pp.pimpinan_id
        LEFT JOIN teachers t ON t.id = p.teacher_id
        ${whereClause}
        ORDER BY pp.hari, pp.urutan ASC, pp.id ASC
    `;
    const result = await db.execute({ sql: query, args });

    const grouped = {};
    HARI_PIKET.forEach(h => { grouped[h] = []; });
    result.rows.forEach(row => {
        if (!grouped[row.hari]) grouped[row.hari] = [];
        grouped[row.hari].push(row);
    });

    return {
        hari: HARI_PIKET,
        data: grouped,
        total: result.rows.length,
        total_terisi: HARI_PIKET.filter(h => grouped[h].length > 0).length
    };
};

// Tugaskan pimpinan piket pada satu hari (boleh lebih dari satu pimpinan per hari).
export const assignPiketPimpinanService = async ({ pimpinan_id, hari, urutan } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

    const hariFinal = toUpper(hari);
    if (!HARI_PIKET.includes(hariFinal)) throw new Error(`Hari tidak valid! Pilih: ${HARI_PIKET.join(', ')}`);

    const pimpinanId = Number(pimpinan_id);
    if (!Number.isInteger(pimpinanId) || pimpinanId <= 0) throw new Error('Pimpinan tidak valid');
    const owned = await findOwnedPimpinan(pimpinanId, ctx);
    if (!owned) throw new Error('Pimpinan tidak ditemukan');

    const dup = await db.execute({
        sql: 'SELECT id FROM piket_pimpinan WHERE pimpinan_id = ? AND hari = ?',
        args: [pimpinanId, hariFinal]
    });
    if (dup.rows.length > 0) throw new Error('Pimpinan tersebut sudah terjadwal pada hari tersebut');

    const urutanFinal = (urutan !== undefined && urutan !== null && urutan !== '') ? Number(urutan) : 0;

    const result = await db.execute({
        sql: `
            INSERT INTO piket_pimpinan (pimpinan_id, hari, urutan, lembaga)
            VALUES (?, ?, ?, ?)
        `,
        args: [pimpinanId, hariFinal, urutanFinal, ctx.lembaga]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Hapus penugasan piket (terscope lembaga).
export const removePiketPimpinanService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM piket_pimpinan WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// ============================================================
// PRESENSI PIMPINAN (kehadiran piket per tanggal)
// ============================================================

export const PRESENSI_STATUS = ['HADIR', 'SAKIT', 'IZIN', 'ALPA'];

const DAY_OF_WEEK = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

// Nama hari Indonesia dari tanggal (lokal, aman zona waktu via tengah hari).
const dayNameFromTanggal = (tanggal) => {
    if (!TANGGAL_RE.test(tanggal)) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    const d = new Date(`${tanggal}T12:00:00`);
    if (Number.isNaN(d.getTime())) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    return DAY_OF_WEEK[d.getDay()];
};

// Roster piket pimpinan hari tsb + status presensi yang sudah tercatat (kunjungan harian).
export const getPresensiPimpinanService = async ({ tanggal } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tanggalFinal = String(tanggal || '');
    const hari = dayNameFromTanggal(tanggalFinal);

    const conditions = ['pp.hari = ?'];
    const args = [tanggalFinal, hari];
    if (!ctx.isAll) {
        conditions.push('LOWER(pp.lembaga) = LOWER(?)');
        args.push(ctx.lembaga);
    }

    const query = `
        SELECT pp.id AS piket_id, pp.pimpinan_id, pp.hari AS piket_hari, pp.urutan,
               p.nama, p.jabatan, p.teacher_id, p.aktif,
               t.name AS teacher_name,
               ps.status, ps.keterangan
        FROM piket_pimpinan pp
        JOIN pimpinan p ON p.id = pp.pimpinan_id
        LEFT JOIN teachers t ON t.id = p.teacher_id
        LEFT JOIN presensi_pimpinan ps ON ps.pimpinan_id = pp.pimpinan_id AND ps.tanggal = ?
        WHERE ${conditions.join(' AND ')}
        ORDER BY pp.urutan ASC, pp.id ASC
    `;
    const result = await db.execute({ sql: query, args });

    return {
        tanggal: tanggalFinal,
        hari,
        statuses: PRESENSI_STATUS,
        data: result.rows,
        total: result.rows.length
    };
};

// Simpan presensi pimpinan massal per tanggal (UPSERT atomik per pimpinan).
// items: [{ pimpinan_id, status?, keterangan? }] — status default 'HADIR'.
export const savePresensiPimpinanService = async ({ tanggal, items } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tanggalFinal = String(tanggal || '');
    const hari = dayNameFromTanggal(tanggalFinal);

    if (!Array.isArray(items) || items.length === 0) throw new Error('Data presensi kosong (wajib kirim items)');

    const ops = [];
    for (const item of items) {
        const pimpinanId = Number(item?.pimpinan_id);
        if (!Number.isInteger(pimpinanId) || pimpinanId <= 0) throw new Error('Pimpinan tidak valid');
        const owned = await findOwnedPimpinan(pimpinanId, ctx);
        if (!owned) throw new Error('Pimpinan tidak ditemukan');

        // Lembaga catatan = lembaga pemilik pimpinan (bukan yang merekam), agar riwayat
        // tetap tampil bagi admin lembaga mana pun yang berwenang atas pimpinan tersebut.
        const pm = await db.execute({ sql: 'SELECT lembaga FROM pimpinan WHERE id = ?', args: [pimpinanId] });
        const targetLembaga = pm.rows[0]?.lembaga || ctx.lembaga;

        const statusFinal = toUpper(item.status) || 'HADIR';
        if (!PRESENSI_STATUS.includes(statusFinal)) {
            throw new Error(`Status tidak valid! Pilih: ${PRESENSI_STATUS.join(', ')}`);
        }

        ops.push({
            sql: `
                INSERT INTO presensi_pimpinan (pimpinan_id, hari, tanggal, status, keterangan, lembaga)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    keterangan = VALUES(keterangan),
                    updated_at = CURRENT_TIMESTAMP
            `,
            args: [
                pimpinanId,
                hari,
                tanggalFinal,
                statusFinal,
                item.keterangan !== undefined && item.keterangan !== null ? String(item.keterangan) : null,
                targetLembaga
            ]
        });
    }

    await db.batch(ops, 'write');

    return { tanggal: tanggalFinal, hari, count: ops.length };
};

// Riwayat presensi pimpinan (filter rentang tanggal/status/pimpinan, terscope lembaga).
export const getPresensiPimpinanHistoryService = async ({
    tanggal_from, tanggal_to, status, pimpinan_id, limit, offset
} = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (tanggal_from) {
        if (!TANGGAL_RE.test(String(tanggal_from))) throw new Error('tanggal_from tidak valid (harus YYYY-MM-DD)');
        conditions.push('ps.tanggal >= ?');
        args.push(String(tanggal_from));
    }
    if (tanggal_to) {
        if (!TANGGAL_RE.test(String(tanggal_to))) throw new Error('tanggal_to tidak valid (harus YYYY-MM-DD)');
        conditions.push('ps.tanggal <= ?');
        args.push(String(tanggal_to));
    }
    if (status) {
        const statusFinal = toUpper(status);
        if (!PRESENSI_STATUS.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${PRESENSI_STATUS.join(', ')}`);
        conditions.push('ps.status = ?');
        args.push(statusFinal);
    }
    if (pimpinan_id) {
        conditions.push('ps.pimpinan_id = ?');
        args.push(Number(pimpinan_id));
    }
    if (!ctx.isAll) {
        // Scope riwayat mengikuti lembaga PEMILIK pimpinan (bukan yang merekam),
        // agar catatan lama yang tersimpan di bawah scope lain tetap terlihat.
        conditions.push('LOWER(p.lembaga) = LOWER(?)');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitFinal = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offsetFinal = Math.max(Number(offset) || 0, 0);

    const query = `
        SELECT ps.id, ps.pimpinan_id, ps.hari, ps.tanggal, ps.status, ps.keterangan,
               p.nama, p.jabatan, p.teacher_id
        FROM presensi_pimpinan ps
        JOIN pimpinan p ON p.id = ps.pimpinan_id
        ${whereClause}
        ORDER BY ps.tanggal DESC, ps.id DESC
        LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM presensi_pimpinan ps JOIN pimpinan p ON p.id = ps.pimpinan_id ${whereClause}`;

    const [result, countRes] = await Promise.all([
        db.execute({ sql: query, args: [...args, limitFinal, offsetFinal] }),
        db.execute({ sql: countQuery, args })
    ]);

    return {
        data: result.rows,
        total: Number(countRes.rows[0]?.total || 0),
        filter: { tanggal_from: tanggal_from || null, tanggal_to: tanggal_to || null, status: status || null, pimpinan_id: pimpinan_id || null }
    };
};