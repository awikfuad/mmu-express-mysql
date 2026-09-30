import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Nama hari DB (day_of_week) sesuai urutan JS getDay() 0=Ahad
export const DAY_NAMES = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

export const JENIS_IZIN_GURU = ['IZIN', 'SAKIT', 'DINAS'];
export const STATUS_IZIN_GURU = ['AKTIF', 'SELESAI'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

const isValidDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    const d = new Date(`${s}T00:00:00`);
    return !isNaN(d.getTime());
};

// Rentang tanggal inklusif → daftar {tanggal, day_name} (aritmetika UTC murni agar
// tidak tergeser zona waktu mesin — toISOString pada objek lokal bisa mundur 1 hari)
const expandDates = (mulai, selesai) => {
    const out = [];
    const toUTC = (s) => {
        const [y, m, d] = s.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    for (let t = toUTC(mulai); t <= toUTC(selesai) && out.length < 400; t += 86400000) {
        const dt = new Date(t);
        out.push({
            tanggal: dt.toISOString().split('T')[0],
            day_name: DAY_NAMES[dt.getUTCDay()]
        });
    }
    return out;
};

// Nama hari dari string tanggal YYYY-MM-DD (konsisten UTC)
const dayNameOf = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

const parsePenggantiDetail = (raw) => {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
};

// Resolve guru + validasi scope lembaga
const resolveTeacher = async (teacherId) => {
    const res = await db.execute({
        sql: 'SELECT id, name, lembaga FROM teachers WHERE id = ?',
        args: [Number(teacherId)]
    });
    return res.rows[0] || null;
};

const teacherInScope = (teacher, ctx) => ctx.isAll || teacher.lembaga === ctx.lembaga;

// List izin guru (filter jenis/status/rentang/cari, terscope lembaga)
export const getIzinGuruListService = async ({ jenis, status, tanggal_from, tanggal_to, search } = {}, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const conditions = [];
    const args = [];

    if (jenis) {
        const jenisFinal = toUpper(jenis);
        if (!JENIS_IZIN_GURU.includes(jenisFinal)) throw Object.assign(new Error(`Jenis tidak valid! Pilih: ${JENIS_IZIN_GURU.join(', ')}`), { status: 400 });
        conditions.push('ig.jenis = ?');
        args.push(jenisFinal);
    }
    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_IZIN_GURU.includes(statusFinal)) throw Object.assign(new Error(`Status tidak valid! Pilih: ${STATUS_IZIN_GURU.join(', ')}`), { status: 400 });
        conditions.push('ig.status = ?');
        args.push(statusFinal);
    }
    if (tanggal_from) {
        if (!isValidDate(tanggal_from)) throw Object.assign(new Error('tanggal_from tidak valid!'), { status: 400 });
        conditions.push('ig.tanggal_selesai >= ?');
        args.push(tanggal_from);
    }
    if (tanggal_to) {
        if (!isValidDate(tanggal_to)) throw Object.assign(new Error('tanggal_to tidak valid!'), { status: 400 });
        conditions.push('ig.tanggal_mulai <= ?');
        args.push(tanggal_to);
    }
    if (search && String(search).trim()) {
        conditions.push('(t.name LIKE ? OR ig.alasan LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like);
    }
    if (!s.isAll) {
        conditions.push('(ig.lembaga = ? OR t.lembaga = ?)');
        args.push(s.lembaga, s.lembaga);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await db.execute({
        sql: `
            SELECT ig.*, t.name AS teacher_name,
                   COALESCE(ig.pengganti_detail, '[]') AS pengganti_detail
            FROM izin_guru ig
            LEFT JOIN teachers t ON ig.teacher_id = t.id
            ${where}
            ORDER BY ig.tanggal_mulai DESC, ig.id DESC
        `,
        args
    });

    return res.rows.map((r) => {
        const detail = parsePenggantiDetail(r.pengganti_detail);
        const { pengganti_detail: _drop, ...rest } = r;
        return { ...rest, pengganti_count: detail.length };
    });
};

// Ambil satu izin (terscope)
export const getIzinGuruByIdService = async (id, lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const res = await db.execute({
        sql: `
            SELECT ig.*, t.name AS teacher_name, t.lembaga AS teacher_lembaga
            FROM izin_guru ig
            LEFT JOIN teachers t ON ig.teacher_id = t.id
            WHERE ig.id = ?
        `,
        args: [Number(id)]
    });
    const row = res.rows[0];
    if (!row) throw Object.assign(new Error('Catatan izin guru tidak ditemukan!'), { status: 404 });
    if (!s.isAll && row.lembaga !== s.lembaga && row.teacher_lembaga !== s.lembaga) {
        throw Object.assign(new Error('Akses ditolak untuk catatan izin ini!'), { status: 403 });
    }
    return { ...row, pengganti_detail: parsePenggantiDetail(row.pengganti_detail) };
};

// Buat catatan izin guru
export const createIzinGuruService = async (payload, userLembaga = 'ALL', userName = '') => {
    const { teacher_id, jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan } = payload;

    if (!teacher_id) throw Object.assign(new Error('Guru wajib dipilih!'), { status: 400 });
    if (!alasan || !String(alasan).trim()) throw Object.assign(new Error('Alasan wajib diisi!'), { status: 400 });
    if (!isValidDate(tanggal_mulai) || !isValidDate(tanggal_selesai)) {
        throw Object.assign(new Error('Tanggal mulai/selesai tidak valid!'), { status: 400 });
    }
    if (tanggal_selesai < tanggal_mulai) {
        throw Object.assign(new Error('Tanggal selesai tidak boleh sebelum tanggal mulai!'), { status: 400 });
    }

    const jenisFinal = toUpper(jenis) || 'IZIN';
    if (!JENIS_IZIN_GURU.includes(jenisFinal)) {
        throw Object.assign(new Error(`Jenis tidak valid! Pilih: ${JENIS_IZIN_GURU.join(', ')}`), { status: 400 });
    }

    const s = getSumber(userLembaga);
    const teacher = await resolveTeacher(teacher_id);
    if (!teacher) throw Object.assign(new Error('Guru tidak ditemukan!'), { status: 404 });
    if (!teacherInScope(teacher, s)) {
        throw Object.assign(new Error('Guru di luar lingkup lembaga Anda!'), { status: 403 });
    }

    // Lembaga catatan mengikuti lembaga efektif pemanggil (scoped) / lembaga guru (super admin)
    const lembagaCatatan = s.isAll ? (teacher.lembaga === 'ALL' ? 'ALL' : teacher.lembaga) : s.lembaga;

    const result = await db.execute({
        sql: `
            INSERT INTO izin_guru (teacher_id, jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan, status, pengganti_detail, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, 'AKTIF', '[]', ?)
        `,
        args: [Number(teacher_id), jenisFinal, String(alasan).trim(), tanggal_mulai, tanggal_selesai, keterangan?.trim() || null, lembagaCatatan]
    });

    return {
        id: Number(result.lastInsertRowid),
        message: `Catatan izin untuk ${teacher.name} berhasil dibuat.${userName ? ` (oleh ${userName})` : ''}`
    };
};

// Ubah catatan izin guru (SET dinamis utk field yang dikirim)
export const updateIzinGuruService = async (id, payload, userLembaga = 'ALL') => {
    const existing = await getIzinGuruByIdService(id, userLembaga);

    const updates = {};
    const errors = [];

    if (payload.jenis !== undefined) {
        const jenisFinal = toUpper(payload.jenis);
        if (!JENIS_IZIN_GURU.includes(jenisFinal)) errors.push(`Jenis tidak valid! Pilih: ${JENIS_IZIN_GURU.join(', ')}`);
        else updates.jenis = jenisFinal;
    }
    if (payload.status !== undefined) {
        const statusFinal = toUpper(payload.status);
        if (!STATUS_IZIN_GURU.includes(statusFinal)) errors.push(`Status tidak valid! Pilih: ${STATUS_IZIN_GURU.join(', ')}`);
        else updates.status = statusFinal;
    }
    if (payload.alasan !== undefined) {
        if (!String(payload.alasan).trim()) errors.push('Alasan tidak boleh kosong!');
        else updates.alasan = String(payload.alasan).trim();
    }
    if (payload.keterangan !== undefined) updates.keterangan = payload.keterangan?.trim() || null;
    if (payload.tanggal_mulai !== undefined) {
        if (!isValidDate(payload.tanggal_mulai)) errors.push('Tanggal mulai tidak valid!');
        else updates.tanggal_mulai = payload.tanggal_mulai;
    }
    if (payload.tanggal_selesai !== undefined) {
        if (!isValidDate(payload.tanggal_selesai)) errors.push('Tanggal selesai tidak valid!');
        else updates.tanggal_selesai = payload.tanggal_selesai;
    }
    if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });

    const finalMulai = updates.tanggal_mulai ?? existing.tanggal_mulai;
    const finalSelesai = updates.tanggal_selesai ?? existing.tanggal_selesai;
    if (finalSelesai < finalMulai) throw Object.assign(new Error('Tanggal selesai tidak boleh sebelum tanggal mulai!'), { status: 400 });

    if (payload.teacher_id !== undefined && Number(payload.teacher_id) !== existing.teacher_id) {
        const s = getSumber(userLembaga);
        const teacher = await resolveTeacher(payload.teacher_id);
        if (!teacher) throw Object.assign(new Error('Guru baru tidak ditemukan!'), { status: 404 });
        if (!teacherInScope(teacher, s)) throw Object.assign(new Error('Guru di luar lingkup lembaga Anda!'), { status: 403 });
        updates.teacher_id = Number(payload.teacher_id);
    }

    const keys = Object.keys(updates);
    if (keys.length) {
        const setClause = keys.map((k) => `${k} = ?`).join(', ');
        await db.execute({
            sql: `UPDATE izin_guru SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            args: [...keys.map((k) => updates[k]), existing.id]
        });
    }

    return { id: existing.id, message: 'Catatan izin guru berhasil diperbarui!' };
};

// Hapus catatan izin guru
export const deleteIzinGuruService = async (id, userLembaga = 'ALL') => {
    const existing = await getIzinGuruByIdService(id, userLembaga);
    await db.execute({ sql: 'DELETE FROM izin_guru WHERE id = ?', args: [existing.id] });
    return { id: existing.id, message: 'Catatan izin guru berhasil dihapus!' };
};

// Jadwal terdampak: expand rentang tanggal izin → jadwal mingguan guru tsb
export const getAffectedSchedulesService = async (id, userLembaga = 'ALL') => {
    const izin = await getIzinGuruByIdService(id, userLembaga);
    const dates = expandDates(izin.tanggal_mulai, izin.tanggal_selesai);
    const dayNames = [...new Set(dates.map((d) => d.day_name))];
    const placeholders = dayNames.map(() => '?').join(', ');

    const res = await db.execute({
        sql: `
            SELECT sc.id AS schedule_id, sc.day_of_week, sc.start_time, sc.end_time, sc.session_name,
                   sc.substitute_teacher_id, sc.classroom_id,
                   sub.subject_name AS subject_name, c.class_name,
                   st.id AS substitute_id, st.name AS substitute_name
            FROM schedules sc
            LEFT JOIN subjects sub ON sc.subject_id = sub.id
            LEFT JOIN classes c ON sc.classroom_id = c.id
            LEFT JOIN teachers st ON sc.substitute_teacher_id = st.id
            WHERE sc.teacher_id = ? AND sc.day_of_week IN (${placeholders})
            ORDER BY CASE sc.day_of_week
                WHEN 'AHAD' THEN 1 WHEN 'SENIN' THEN 2 WHEN 'SELASA' THEN 3 WHEN 'RABU' THEN 4
                WHEN 'KAMIS' THEN 5 WHEN 'JUMAT' THEN 6 ELSE 7 END,
                sc.start_time
        `,
        args: [izin.teacher_id, ...dayNames]
    });

    // Tandai badal yang memang ditugaskan via catatan izin ini (riwayat pengganti_detail)
    const assignedHere = new Set(
        (izin.pengganti_detail || []).map((p) => `${p.schedule_id}|${p.tanggal}`)
    );

    const perDate = [];
    for (const d of dates) {
        for (const sch of res.rows) {
            if (sch.day_of_week !== d.day_name) continue;
            perDate.push({
                tanggal: d.tanggal,
                day_of_week: d.day_name,
                schedule_id: sch.schedule_id,
                subject_name: sch.subject_name || '-',
                class_name: sch.class_name || '-',
                session_name: sch.session_name,
                jam: `${sch.start_time} - ${sch.end_time}`,
                classroom_id: sch.classroom_id,
                substitute_teacher_id: sch.substitute_teacher_id,
                substitute_name: sch.substitute_name || null,
                assigned_via_izin: assignedHere.has(`${sch.schedule_id}|${d.tanggal}`)
            });
        }
    }

    return {
        izin: {
            id: izin.id,
            teacher_id: izin.teacher_id,
            teacher_name: izin.teacher_name,
            jenis: izin.jenis,
            status: izin.status,
            tanggal_mulai: izin.tanggal_mulai,
            tanggal_selesai: izin.tanggal_selesai,
            alasan: izin.alasan
        },
        total_jadwal_terdampak: perDate.length,
        total_sudah_badal: perDate.filter((x) => x.substitute_teacher_id != null).length,
        schedules: perDate
    };
};

// Tunjuk / ganti guru pengganti (badal) utk satu slot jadwal pada tanggal tertentu
export const assignSubstituteService = async (id, { schedule_id, tanggal, substitute_teacher_id }, userLembaga = 'ALL') => {
    const izin = await getIzinGuruByIdService(id, userLembaga);

    if (!schedule_id) throw Object.assign(new Error('schedule_id wajib dikirim!'), { status: 400 });
    if (!isValidDate(tanggal)) throw Object.assign(new Error('tanggal tidak valid (YYYY-MM-DD)!'), { status: 400 });
    if (tanggal < izin.tanggal_mulai || tanggal > izin.tanggal_selesai) {
        throw Object.assign(new Error('tanggal berada di luar periode izin!'), { status: 400 });
    }

    // Jadwal harus milik guru yang izin & hari-nya cocok dengan tanggal
    const dayName = dayNameOf(tanggal);
    const res = await db.execute({
        sql: 'SELECT id, day_of_week FROM schedules WHERE id = ? AND teacher_id = ?',
        args: [Number(schedule_id), izin.teacher_id]
    });
    const schedule = res.rows[0];
    if (!schedule) throw Object.assign(new Error('Jadwal tidak ditemukan / bukan jadwal guru yang bersangkutan!'), { status: 404 });
    if (schedule.day_of_week !== dayName) {
        throw Object.assign(new Error(`Hari jadwal (${schedule.day_of_week}) tidak cocok dengan tanggal tersebut (${dayName})!`), { status: 400 });
    }

    let substituteName = null;
    if (substitute_teacher_id != null && substitute_teacher_id !== '') {
        if (Number(substitute_teacher_id) === izin.teacher_id) {
            throw Object.assign(new Error('Guru pengganti tidak boleh guru yang bersangkutan sendiri!'), { status: 400 });
        }
        const s = getSumber(userLembaga);
        const teacher = await resolveTeacher(substitute_teacher_id);
        if (!teacher) throw Object.assign(new Error('Guru pengganti tidak ditemukan!'), { status: 404 });
        if (!teacherInScope(teacher, s)) throw Object.assign(new Error('Guru pengganti di luar lingkup lembaga Anda!'), { status: 403 });
        substituteName = teacher.name;
    }

    // Tulis badal ke jadwal (NULL = hapus penunjukan)
    await db.execute({
        sql: 'UPDATE schedules SET substitute_teacher_id = ? WHERE id = ?',
        args: [substitute_teacher_id != null && substitute_teacher_id !== '' ? Number(substitute_teacher_id) : null, Number(schedule_id)]
    });

    // Simpan riwayat di pengganti_detail (key schedule_id|tanggal)
    const key = `${schedule_id}|${tanggal}`;
    const detail = (izin.pengganti_detail || []).filter((p) => `${p.schedule_id}|${p.tanggal}` !== key);
    if (substitute_teacher_id != null && substitute_teacher_id !== '') {
        detail.push({
            schedule_id: Number(schedule_id),
            tanggal,
            substitute_teacher_id: Number(substitute_teacher_id),
            substitute_name: substituteName,
            assigned_at: new Date().toISOString()
        });
    }
    await db.execute({
        sql: "UPDATE izin_guru SET pengganti_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [JSON.stringify(detail), izin.id]
    });

    return {
        message: substitute_teacher_id != null && substitute_teacher_id !== ''
            ? `Badal ditetapkan: ${substituteName} menggantikan pada ${tanggal}.`
            : 'Penunjukan badal dihapus.'
    };
};

// Tandai SELESAI + bersihkan semua badal yang ditugaskan via catatan izin ini
export const finishIzinGuruService = async (id, userLembaga = 'ALL') => {
    const izin = await getIzinGuruByIdService(id, userLembaga);
    const detail = izin.pengganti_detail || [];

    // Hanya bersihkan slot yang masih menunjuk guru sama (jangan ganggu badal lain yg diubah manual)
    for (const p of detail) {
        await db.execute({
            sql: 'UPDATE schedules SET substitute_teacher_id = NULL WHERE id = ? AND substitute_teacher_id = ?',
            args: [p.schedule_id, p.substitute_teacher_id]
        });
    }

    await db.execute({
        sql: "UPDATE izin_guru SET status = 'SELESAI', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [izin.id]
    });

    return { message: `Izin ditandai SELESAI. ${detail.length} penunjukan badal dibersihkan.` };
};
