import db from '../config/db.js';
import {
    normalizeTarget as sharedNormalizeTarget,
    normalizeJenjangList as sharedNormalizeJenjangList,
    assertSantriAllowed
} from './kegiatanService.js';

// v3.2: tabel `activities` digabung ke `kegiatan` (sistem aktif utama).
// Fungsi di sini kini membaca/menulis `kegiatan` & `absensi_istighosah` sehingga
// route `/activities/*` tetap berfungsi setelah `activities` di-rename `activities_old`.

const normalizeTarget = (t) => sharedNormalizeTarget(t);
const normalizeJenjangList = (l) => sharedNormalizeJenjangList(l);

// 1. MEMBUAT AGENDA KEGIATAN BARU (Oleh Admin via Web Vue)
export const createActivityService = async (activityData, lembaga = 'ALL') => {
    const { activity_name, activity_date, description } = activityData;
    const l = (lembaga || 'ALL').toUpperCase();
    const target = normalizeTarget(activityData.target);
    const targetJenjang = normalizeJenjangList(activityData.target_jenjang);
    const query = `
        INSERT INTO kegiatan (activity_name, activity_date, description, lembaga, target, target_jenjang)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [activity_name, activity_date, description || null, l, target, targetJenjang]
    });
    return { id: result.lastInsertRowid, activity_name, activity_date, target, target_jenjang: targetJenjang };
};

// 2. MENCATAT ABSENSI KEGIATAN SANTRI (UPSERT ke absensi_istighosah, kunci nim)
//    Route /activities/attendance mengirim student_id -> resolve nim dari students bila nim tak dikirim.
export const recordActivityAttendanceService = async (attendanceData) => {
    const {
        academic_year_id,
        jenjang_id,
        nim,
        tanggal_absensi,
        bulan_hijriah,
        tahun_hijriah,
        activity_id,
        student_id,
        status,
        notes,
        latitude,
        longitude,
        accuracy
    } = attendanceData;

    let finalNim = nim;
    let finalJenjang = jenjang_id || null;
    if (!finalNim && student_id) {
        const s = await db.execute({ sql: 'SELECT nim, jenjang_id FROM students WHERE id = ?', args: [Number(student_id)] });
        if (s.rows.length) {
            finalNim = s.rows[0].nim;
            // v3.6: resolve jenjang dari akun santri bila payload tidak menyertakannya (dipakai guard target)
            if (!finalJenjang) finalJenjang = s.rows[0].jenjang_id ?? null;
        }
    }
    if (!finalNim) throw new Error('NIM santri tidak ditemukan');

    // v3.6: guard target peserta & jenjang (konsisten dengan /kegiatan/attendance)
    const kegiatan = await assertSantriAllowed(activity_id, finalJenjang);

    // v3.43: kegiatan sekali (ONCE) → tanggal_absensi dipin ke tanggal kegiatan agar dengan UNIQUE
    // (activity_id, nim, tanggal_absensi) setiap santri tetap satu baris; kegiatan mingguan (WEEKLY)
    // mencatat absensi per tanggal (fallback hari ini).
    const finalTanggalAbsensi = kegiatan.repeat_type === 'WEEKLY'
        ? (tanggal_absensi || new Date().toISOString().split('T')[0])
        : kegiatan.activity_date;

    const query = `
        INSERT INTO absensi_istighosah (
            academic_year_id, jenjang_id, nim, month, tahun, tanggal_absensi, activity_id, status, notes,
            latitude, longitude, accuracy
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            notes = VALUES(notes),
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            accuracy = VALUES(accuracy),
            created_at = CURRENT_TIMESTAMP
    `;
    await db.execute({
        sql: query,
        args: [
            academic_year_id || null,
            jenjang_id || null,
            finalNim,
            bulan_hijriah || null,
            tahun_hijriah || null,
            finalTanggalAbsensi,
            activity_id,
            status ? status.toUpperCase() : 'HADIR',
            notes || null,
            latitude ?? null,
            longitude ?? null,
            accuracy ?? null
        ]
    });
    return { activity_id, nim: finalNim, status: status ? status.toUpperCase() : 'HADIR' };
};

// 3. MELIHAT REKAP ABSENSI PER KEGIATAN TERTENTU (roster semua santri vs status)
export const getActivityAttendanceReportService = async (activityId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'WHERE s.lembaga = ?';
    const query = `
        SELECT s.id as student_id, s.nim, s.name,
               (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = s.nim LIMIT 1) AS class_name,
               COALESCE(aa.status, 'ALPA') as status, aa.notes
        FROM students s
        LEFT JOIN absensi_istighosah aa ON aa.nim = s.nim AND aa.activity_id = ?
        ${whereLembaga}
        ORDER BY class_name ASC, s.name ASC
    `;
    const args = l === 'ALL' ? [activityId] : [activityId, l];
    const result = await db.execute({
        sql: query,
        args
    });
    return result.rows;
};

export const getAllActivitiesService = async (lembaga = 'ALL', filters = {}) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const conditions = [];
    let args = [];
    if (l !== 'ALL') {
        conditions.push('lembaga IN (?, ?)');
        args.push(l, 'ALL');
    }
    const audience = (filters.audience || '').toString().trim().toUpperCase();
    if (audience === 'MURID' || audience === 'GURU') {
        conditions.push("(target IS NULL OR target IN (?, 'SEMUA'))");
        args.push(audience);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, activity_name, activity_date, description, created_at, lembaga,
                        COALESCE(target, 'SEMUA') AS target, target_jenjang
                 FROM kegiatan 
                 ${whereClause}
                 ORDER BY activity_date DESC`;

    const result = await db.execute({ sql, args });

    let rows = result.rows || result;
    const jenjangFilter = filters.jenjang_id ? Number(filters.jenjang_id) : null;
    if (jenjangFilter) {
        rows = rows.filter((r) => {
            if (!r.target_jenjang) return true;
            try {
                const parsed = typeof r.target_jenjang === 'string' ? JSON.parse(r.target_jenjang) : r.target_jenjang;
                if (!Array.isArray(parsed) || parsed.length === 0) return true;
                return parsed.map(Number).includes(jenjangFilter);
            } catch (_) { return true; }
        });
    }
    return rows;
};

export const getActivityReportService = async (activityId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND s.lembaga = ?';
    const query = `
        SELECT 
            s.id AS student_id, 
            s.nim, 
            s.name AS student_name, 
            (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = s.nim LIMIT 1) AS class_name,
            aa.status, 
            aa.notes
        FROM absensi_istighosah aa
        INNER JOIN students s ON s.nim = aa.nim
        WHERE aa.activity_id = ?
        AND DATE(aa.created_at) = CURDATE()
        ${whereLembaga}
        ORDER BY aa.id DESC
    `;

    const args = l === 'ALL' ? [activityId] : [activityId, l];
    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};
