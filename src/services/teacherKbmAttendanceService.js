import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Absensi guru KBM — kehadiran guru per slot jadwal mengajar per tanggal.
// Mengikuti pola presensi_pimpinan (roster harian + simpan massal UPSERT per slot).

export const PRESENSI_STATUS = ['HADIR', 'SAKIT', 'IZIN', 'ALPA'];

const DAY_OF_WEEK = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll
    };
};

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

const dayNameFromTanggal = (tanggal) => {
    if (!TANGGAL_RE.test(tanggal)) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    const d = new Date(`${tanggal}T12:00:00`);
    if (Number.isNaN(d.getTime())) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    return DAY_OF_WEEK[d.getDay()];
};

// Roster mengajar hari tsb: jadwal guru (jadwal kosong tidak muncul) + status absensi yang sudah tercatat.
// Guru efektif = guru pengganti (badal) bila ditugaskan, selain itu guru utama.
export const getTeacherKbmRosterService = async ({ tanggal } = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const tanggalFinal = String(tanggal || '');
    if (!TANGGAL_RE.test(tanggalFinal)) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    const hari = dayNameFromTanggal(tanggalFinal);

    const conditions = ['sc.day_of_week = ?'];
    const args = [hari];
    if (!ctx.isAll) {
        conditions.push('(sc.lembaga = ? OR sc.lembaga = ?)');
        args.push(ctx.lembaga, 'ALL');
    }

    const query = `
        SELECT sc.id AS schedule_id, sc.classroom_id, sc.teacher_id,
               sc.substitute_teacher_id, sc.session_name, sc.start_time, sc.end_time,
               COALESCE(st.id, sc.teacher_id) AS effective_teacher_id,
               COALESCE(st.name, mt.name) AS teacher_name,
               mt.name AS main_teacher_name, st.name AS substitute_name,
               sub.subject_name, c.class_name,
               tka.status, tka.keterangan, tka.dicatat_oleh
        FROM schedules sc
        LEFT JOIN teachers mt ON mt.id = sc.teacher_id
        LEFT JOIN teachers st ON st.id = sc.substitute_teacher_id
        LEFT JOIN subjects sub ON sub.id = sc.subject_id
        LEFT JOIN classes c ON c.id = sc.classroom_id
        LEFT JOIN teacher_kbm_attendances tka ON tka.schedule_id = sc.id AND tka.tanggal = ?
        WHERE ${conditions.join(' AND ')}
        ORDER BY sc.start_time ASC, c.class_name ASC
    `;
    const result = await db.execute({ sql: query, args: [tanggalFinal, ...args] });

    return {
        tanggal: tanggalFinal,
        hari,
        statuses: PRESENSI_STATUS,
        data: result.rows,
        total: result.rows.length
    };
};

// Simpan absensi guru KBM massal per tanggal (UPSERT atomik per slot jadwal).
// items: [{ schedule_id, status?, keterangan? }] — status default 'HADIR'.
export const saveTeacherKbmAttendanceService = async ({ tanggal, items } = {}, lembaga = 'ALL', actorName = null) => {
    const ctx = getContext(lembaga);
    const tanggalFinal = String(tanggal || '');
    if (!TANGGAL_RE.test(tanggalFinal)) throw new Error('Tanggal tidak valid (harus YYYY-MM-DD)');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Data absensi kosong (wajib kirim items)');

    const hari = dayNameFromTanggal(tanggalFinal);
    const ops = [];

    for (const item of items) {
        const scheduleId = Number(item?.schedule_id);
        if (!Number.isInteger(scheduleId) || scheduleId <= 0) throw new Error('Salat jadwal tidak valid');

        const scheduleRes = await db.execute({
            sql: `SELECT id, classroom_id, teacher_id, substitute_teacher_id, session_name, lembaga
                  FROM schedules WHERE id = ?`,
            args: [scheduleId]
        });
        const schedule = scheduleRes.rows[0];
        if (!schedule) throw new Error('Jadwal tidak ditemukan');
        if (!ctx.isAll && schedule.lembaga !== 'ALL' && schedule.lembaga !== ctx.lembaga) {
            throw new Error('Jadwal di luar lingkup lembaga Anda');
        }

        const statusFinal = toUpper(item.status) || 'HADIR';
        if (!PRESENSI_STATUS.includes(statusFinal)) {
            throw new Error(`Status tidak valid! Pilih: ${PRESENSI_STATUS.join(', ')}`);
        }

        const effectiveTeacherId = schedule.substitute_teacher_id ?? schedule.teacher_id;

        ops.push({
            sql: `
                INSERT INTO teacher_kbm_attendances
                    (schedule_id, classroom_id, teacher_id, hari, tanggal, session_name, status, keterangan, lembaga, dicatat_oleh)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    teacher_id = VALUES(teacher_id),
                    hari = VALUES(hari),
                    status = VALUES(status),
                    keterangan = VALUES(keterangan),
                    dicatat_oleh = VALUES(dicatat_oleh),
                    updated_at = CURRENT_TIMESTAMP
            `,
            args: [
                scheduleId,
                schedule.classroom_id,
                effectiveTeacherId,
                hari,
                tanggalFinal,
                schedule.session_name || null,
                statusFinal,
                item.keterangan !== undefined && item.keterangan !== null ? String(item.keterangan) : null,
                ctx.lembaga,
                actorName || null
            ]
        });
    }

    await db.batch(ops, 'write');

    return { tanggal: tanggalFinal, hari, count: ops.length };
};

// Riwayat absensi guru KBM (filter rentang tanggal/status/guru, terscope lembaga).
export const getTeacherKbmAttendanceHistoryService = async ({
    tanggal_from, tanggal_to, status, teacher_id, limit, offset
} = {}, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (tanggal_from) {
        if (!TANGGAL_RE.test(String(tanggal_from))) throw new Error('tanggal_from tidak valid (harus YYYY-MM-DD)');
        conditions.push('tka.tanggal >= ?');
        args.push(String(tanggal_from));
    }
    if (tanggal_to) {
        if (!TANGGAL_RE.test(String(tanggal_to))) throw new Error('tanggal_to tidak valid (harus YYYY-MM-DD)');
        conditions.push('tka.tanggal <= ?');
        args.push(String(tanggal_to));
    }
    if (status) {
        const statusFinal = toUpper(status);
        if (!PRESENSI_STATUS.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${PRESENSI_STATUS.join(', ')}`);
        conditions.push('tka.status = ?');
        args.push(statusFinal);
    }
    if (teacher_id) {
        conditions.push('tka.teacher_id = ?');
        args.push(Number(teacher_id));
    }
    if (!ctx.isAll) {
        conditions.push('tka.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitFinal = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const offsetFinal = Math.max(Number(offset) || 0, 0);

    const query = `
        SELECT tka.id, tka.schedule_id, tka.classroom_id, tka.teacher_id, tka.hari,
               tka.tanggal, tka.session_name, tka.status, tka.keterangan, tka.dicatat_oleh,
               t.name AS teacher_name, sub.subject_name, c.class_name,
               sc.start_time, sc.end_time
        FROM teacher_kbm_attendances tka
        LEFT JOIN teachers t ON t.id = tka.teacher_id
        LEFT JOIN schedules sc ON sc.id = tka.schedule_id
        LEFT JOIN subjects sub ON sub.id = sc.subject_id
        LEFT JOIN classes c ON c.id = tka.classroom_id
        ${whereClause}
        ORDER BY tka.tanggal DESC, sc.start_time ASC
        LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM teacher_kbm_attendances tka ${whereClause}`;

    const [result, countRes] = await Promise.all([
        db.execute({ sql: query, args: [...args, limitFinal, offsetFinal] }),
        db.execute({ sql: countQuery, args })
    ]);

    return {
        data: result.rows,
        total: Number(countRes.rows[0]?.total || 0),
        statuses: PRESENSI_STATUS,
        filter: {
            tanggal_from: tanggal_from || null,
            tanggal_to: tanggal_to || null,
            status: status || null,
            teacher_id: teacher_id || null
        }
    };
};