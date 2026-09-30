import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { getAllLembagaService } from './lembagaService.js';

// ============================================================================
// v3.6 — Target peserta kegiatan ('MURID' | 'GURU' | 'SEMUA') + filter jenjang
// target_jenjang disimpan sebagai JSON array id jenjang (mis. '[1,2]'); NULL/kosong = semua jenjang.
// ============================================================================

export const KEGIATAN_TARGETS = ['MURID', 'GURU', 'SEMUA'];
export const KEGIATAN_REPEAT_TYPES = ['ONCE', 'WEEKLY'];

const normalizeTarget = (t) => {
    const up = (t ?? '').toString().trim().toUpperCase();
    return KEGIATAN_TARGETS.includes(up) ? up : 'SEMUA';
};
export { normalizeTarget, normalizeJenjangList, normalizeKelasList };

// v3.43: repeat_type 'ONCE' (sekali) | 'WEEKLY' (mingguan — absensi per tanggal).
const normalizeRepeatType = (r) => {
    const up = (r ?? '').toString().trim().toUpperCase();
    return KEGIATAN_REPEAT_TYPES.includes(up) ? up : 'ONCE';
};

const normalizeIdList = (list) => {
    if (list === undefined || list === null || list === '') return null;
    const raw = Array.isArray(list) ? list : String(list).split(',');
    const ids = [...new Set(raw.map((v) => parseInt(v, 10)).filter((v) => Number.isFinite(v)))];
    return ids.length ? JSON.stringify(ids.sort((a, b) => a - b)) : null;
};

const normalizeJenjangList = (list) => normalizeIdList(list);
const normalizeKelasList = (list) => normalizeIdList(list);

const parseIdSet = (raw) => {
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed) && parsed.length) return new Set(parsed.map(Number));
        if (Array.isArray(parsed)) return new Set(); // array kosong → dianggap tanpa batasan
    } catch (_) {}
    return null;
};

const parseJenjangSet = (raw) => parseIdSet(raw);
const parseKelasSet = (raw) => parseIdSet(raw);

// Ambil 1 kegiatan lengkap dengan kolom target
const getKegiatanById = async (id) => {
    const result = await db.execute({
        sql: 'SELECT id, activity_name, activity_date, description, lembaga, target, target_jenjang, target_kelas, repeat_type, waktu_pelaksanaan, waktu_selesai, toleransi_menit FROM kegiatan WHERE id = ?',
        args: [id]
    });
    return result.rows[0] || null;
};

const jenjangMatch = (row, jenjangId) => {
    const set = parseJenjangSet(row?.target_jenjang);
    if (!set || set.size === 0) return true; // NULL / kosong / invalid → semua jenjang
    if (jenjangId === undefined || jenjangId === null) return true; // tanpa info jenjang → jangan blok list
    return set.has(Number(jenjangId));
};

// Guard absensi santri: tolak bila kegiatan khusus guru, jenjang santri di luar sasaran, atau kelas santri di luar sasaran.
export const assertSantriAllowed = async (activityId, jenjangId, classroomId = null) => {
    const kegiatan = await getKegiatanById(activityId);
    if (!kegiatan) {
        const err = new Error('Kegiatan tidak ditemukan!');
        err.status = 404;
        throw err;
    }
    if (kegiatan.target === 'GURU') {
        const err = new Error('Kegiatan ini khusus guru/asatidz — santri tidak dapat mengisi presensi.');
        err.status = 403;
        throw err;
    }
    const set = parseJenjangSet(kegiatan.target_jenjang);
    if (set && set.size > 0 && !set.has(Number(jenjangId))) {
        const nama = kegiatan.activity_name;
        const err = new Error(`Kegiatan "${nama}" hanya untuk santri pada jenjang tertentu — jenjang Anda tidak termasuk sasaran.`);
        err.status = 403;
        throw err;
    }
    // v3.42: batasi jenjang juga pada kelas sasaran (target_kelas adalah daftar id classes)
    const kelasSet = parseKelasSet(kegiatan.target_kelas);
    if (kelasSet && kelasSet.size > 0 && classroomId != null && !kelasSet.has(Number(classroomId))) {
        const nama = kegiatan.activity_name;
        const err = new Error(`Kegiatan "${nama}" hanya untuk santri pada kelas tertentu — kelas Anda tidak termasuk sasaran.`);
        err.status = 403;
        throw err;
    }
    return kegiatan;
};

// Guard absensi guru: tolak bila kegiatan khusus murid/santri.
const assertGuruAllowed = async (kegiatanId) => {
    const kegiatan = await getKegiatanById(kegiatanId);
    if (!kegiatan) {
        const err = new Error('Kegiatan tidak ditemukan!');
        err.status = 404;
        throw err;
    }
    if (kegiatan.target === 'MURID') {
        const err = new Error('Kegiatan ini khusus murid/santri — guru tidak dapat mengisi presensi.');
        err.status = 403;
        throw err;
    }
    return kegiatan;
};

// Dekorasi baris list: sertakan target_jenjang & target_kelas ter-parse agar frontend mudah menampilkan label
const parseIdList = (raw) => {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch (_) { return []; }
};

const decorateRow = (row) => ({
    ...row,
    target: row.target || 'SEMUA',
    repeat_type: row.repeat_type || 'ONCE',
    target_jenjang_list: parseIdList(row.target_jenjang),
    target_kelas_list: parseIdList(row.target_kelas)
});

// 1. AMBIL SEMUA KEGIATAN
export const getAllActivitiesService = async (lembaga = 'ALL', filters = {}) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const conditions = [];
    let args = [];

    if (l !== 'ALL') {
        conditions.push('lembaga IN (?, ?)');
        args.push(l, 'ALL');
    }

    // Filter audiens via SQL: 'murid' → MURID+SEMUA, 'guru' → GURU+SEMUA
    const audience = (filters.audience || '').toString().trim().toUpperCase();
    if (audience === 'MURID' || audience === 'GURU') {
        conditions.push("(target IS NULL OR target IN (?, 'SEMUA'))");
        args.push(audience);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT id, activity_name, activity_date, description, created_at, lembaga,
               COALESCE(target, 'SEMUA') AS target, target_jenjang, target_kelas,
               COALESCE(repeat_type, 'ONCE') AS repeat_type
        FROM kegiatan
        ${whereClause}
        ORDER BY activity_date DESC, id DESC
    `;
    const result = await db.execute({ sql: query, args });

    let rows = result.rows.map(decorateRow);

    // Filter jenjang di sisi aplikasi (daftar kegiatan kecil; hindari ketergantungan fungsi JSON)
    const jenjangFilter = filters.jenjang_id ? Number(filters.jenjang_id) : null;
    if (jenjangFilter) {
        rows = rows.filter((r) => jenjangMatch(r, jenjangFilter));
    }
    // v3.42: filter kelas sasaran — kegiatan yang menargetkan kelas tertentu (atau semua kelas)
    const kelasFilter = filters.kelas_id ? Number(filters.kelas_id) : null;
    if (kelasFilter) {
        rows = rows.filter((r) => {
            const set = parseKelasSet(r?.target_kelas);
            if (!set || set.size === 0) return true; // NULL / kosong → semua kelas
            return set.has(kelasFilter);
        });
    }
    return rows;
};

// 2. TAMBAH KEGIATAN BARU
export const createActivityService = async (activityData, lembaga = 'ALL') => {
    const { activity_name, activity_date, description } = activityData;
    const l = (lembaga || 'ALL').toUpperCase();
    const target = normalizeTarget(activityData.target);
    const targetJenjang = normalizeJenjangList(activityData.target_jenjang);
    const targetKelas = normalizeKelasList(activityData.target_kelas);
    const repeatType = normalizeRepeatType(activityData.repeat_typehed);
    const waktuPelaksanaan = normalizeWaktu(activityData.waktu_pelaksanaan);
    const waktuSelesai = normalizeWaktu(activityData.waktu_selesai);
    const toleransiMenit = normalizeToleransi(activityData.toleransi_menit);

    const query = `
        INSERT INTO kegiatan (activity_name, activity_date, description, lembaga, target, target_jenjang, target_kelas, repeat_type, waktu_pelaksanaan, waktu_selesai, toleransi_menit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [activity_name, activity_date, description || null, l, target, targetJenjang, targetKelas, repeatType, waktuPelaksanaan, waktuSelesai, toleransiMenit]
    });

    return {
        id: result.lastInsertRowid || result.insertId,
        activity_name,
        activity_date,
        description,
        lembaga: l,
        target,
        target_jenjang: targetJenjang,
        target_kelas: targetKelas,
        repeat_type: repeatType
    };
};

// 3. UPDATE DATA KEGIATAN
export const updateActivityService = async (id, activityData) => {
    const { activity_name, activity_date, description } = activityData;
    const target = normalizeTarget(activityData.target);
    const targetJenjang = normalizeJenjangList(activityData.target_jenjang);
    const targetKelas = normalizeKelasList(activityData.target_kelas);
    const repeatType = normalizeRepeatType(activityData.repeat_type);
    const waktuPelaksanaan = normalizeWaktu(activityData.waktu_pelaksanaan);
    const waktuSelesai = normalizeWaktu(activityData.waktu_selesai);
    const toleransiMenit = normalizeToleransi(activityData.toleransi_menit);

    const query = `
        UPDATE kegiatan 
        SET activity_name = ?, activity_date = ?, description = ?, target = ?, target_jenjang = ?, target_kelas = ?, repeat_type = ?, waktu_pelaksanaan = ?, waktu_selesai = ?, toleransi_menit = ?
        WHERE id = ?
    `;
    const result = await db.execute({
        sql: query,
        args: [activity_name, activity_date, description || null, target, targetJenjang, targetKelas, repeatType, waktuPelaksanaan, waktuSelesai, toleransiMenit, id]
    });

    return { id, activity_name, activity_date, description, target, target_jenjang: targetJenjang, target_kelas: targetKelas, repeat_type: repeatType };
};

// 4. HAPUS KEGIATAN
export const deleteActivityService = async (id) => {
    // Catatan: Jika ada relasi foreign key di tabel activity_attendances, 
    // pastikan di db diset ON DELETE CASCADE atau hapus presensinya dulu secara manual.
    await db.execute({
        sql: "DELETE FROM kegiatan WHERE id = ?",
        args: [id]
    });
    return { id };
};

// 2. MENCATAT ABSENSI KEGIATAN SANTRI (UPSERT)
export const logKegiatanAttendanceService = async (attendanceData) => {
    // Ambil semua properti dari 1 parameter objek utuh (sinkron dengan controller)
    const { 
        academic_year_id, 
        jenjang_id, 
        classroom_id,
        nim, 
        tanggal_absensi, 
        bulan_hijriah, 
        tahun_hijriah, 
        activity_id, 
        status, 
        notes,
        latitude,
        longitude,
        accuracy
    } = attendanceData;

    console.log("LOG KEGIATAN ATTENDANCE SERVICE - INPUT DATA:", attendanceData);

    // v3.6/v3.42: guard target peserta, jenjang, & kelas — tolak santri di luar sasaran
    const kegiatan = await assertSantriAllowed(activity_id, jenjang_id, classroom_id ?? null);

    // v3.43: kegiatan mingguan (WEEKLY) mencatat absensi per tanggal — tanggal_absensi WAJIB diisi.
    // Kegiatan sekali (ONCE): tanggal_absensi dijepret ke tanggal kegiatan agar dengan UNIQUE baru
    // (activity_id, nim, tanggal_absensi) setiap santri tetap hanya 1 baris (rekap tidak dobel).
    let finalTanggalAbsensi;
    if (kegiatan.repeat_type === 'WEEKLY') {
        finalTanggalAbsensi = tanggal_absensi || new Date().toISOString().split('T')[0];
    } else {
        finalTanggalAbsensi = kegiatan.activity_date || tanggal_absensi || new Date().toISOString().split('T')[0];
    }

    // v3.44: jendela presensi — santri hanya boleh absen dalam [buka − toleransi, tutup + toleransi]
    assertDalamJendelaPresensiHelper(kegiatan, finalTanggalAbsensi);

    // Pastikan nama tabel Anda sesuai, di sini disesuaikan jadi 'absensi_istighosah'
    const query = `
        INSERT INTO absensi_istighosah (
            academic_year_id, 
            jenjang_id, 
            nim, 
            month, 
            tahun, 
            tanggal_absensi, 
            activity_id, 
            status, 
            notes,
            latitude,
            longitude,
            accuracy
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
            nim, 
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

    // Perbaikan: kembalikan 'nim' (bukan student_id yang asalnya tidak ada/undefined)
    return { 
        activity_id, 
        nim, 
        status: status ? status.toUpperCase() : 'HADIR' 
    };
};

// 3. MELIHAT REKAP ABSENSI PER KEGIATAN TERTENTU (roster via students)
export const getKegiatanExportReportService = async (kegiatan_id, lembaga = 'ALL', tanggal = null) => {
    // Roster lengkap murid & santri aktif, dibandingkan dengan data absensi istighosah.
    // Murid tanpa record absen otomatis dianggap ALPA (tidak hadir).
    // v3.40: sumber escope dari master lembaga (bukan hardcode madrasah/tpq) — lembaga
    // kustom (mis. mmu44 dgn sumber 'mmu44') ikut ter-resolve.
    const s = getSumber(lembaga);

    // v3.6: kegiatan khusus guru → roster murid kosong
    const kegiatan = await getKegiatanById(kegiatan_id);
    if (!kegiatan) return [];
    if (kegiatan.target === 'GURU') return [];

    // v3.6: batasi roster hanya jenjang sasaran kegiatan (target_jenjang diset)
    const jenjangSet = parseJenjangSet(kegiatan.target_jenjang);
    const allowedIds = jenjangSet && jenjangSet.size > 0 ? [...jenjangSet] : null;
    // v3.42: batasi roster hanya kelas sasaran kegiatan (target_kelas diset)
    const kelasSet = parseKelasSet(kegiatan.target_kelas);
    const allowedKelas = kelasSet && kelasSet.size > 0 ? [...kelasSet] : null;
    // v3.43: rekap mingguan dibatasi ke tanggal tertentu bila dikirim (baris JOIN difilter tanggal_absensi)
    const tanggalClause = tanggal ? ' AND aa.tanggal_absensi = ?' : '';

    // Sumber yang diikutsertakan: ALL → seluruh sumber unik dari master lembaga; scoped → lembaganya.
    let sources;
    if (s.isAll) {
        sources = [];
        for (const lem of await getAllLembagaService()) {
            const src = String(lem.sumber || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (src && !sources.includes(src)) sources.push(src);
        }
        if (!sources.length) sources = ['madrasah', 'tpq'];
    } else {
        sources = [s.sumber];
    }

    const labelSumber = (src) => (src === 'madrasah' ? 'MURID' : (src === 'tpq' ? 'SANTRI' : src.toUpperCase()));

    const parts = sources.map((src) => {
        const jenjangClause = allowedIds ? ` AND m.jenjang_id IN (${allowedIds.join(',')})` : '';
        const kelasClause = allowedKelas ? ` AND m.classroom_id IN (${allowedKelas.join(',')})` : '';
        return `
        SELECT
            '${labelSumber(src)}' AS sumber,
            m.nim,
            COALESCE(m.name, dm.nama) AS student_name,
            COALESCE(c.class_name, dm.kelas, 'Tanpa Kelas') AS class_name,
            COALESCE(j.nama_jenjang, 'Lainnya') AS nama_jenjang,
            COALESCE(aa.status, 'ALPA') AS status,
            aa.notes
        FROM santri_penempatan m
        LEFT JOIN classes c ON m.classroom_id = c.id AND c.sumber = '${src}'
        LEFT JOIN jenjang j ON m.jenjang_id = j.id
        LEFT JOIN santri_biodata dm ON m.nim = dm.nim AND dm.sumber = '${src}'
        LEFT JOIN absensi_istighosah aa ON aa.nim = m.nim AND aa.activity_id = ?${tanggalClause}
        WHERE m.sumber = '${src}' AND m.status = 1${jenjangClause}${kelasClause}
    `;
    });

    const query = parts.join('\n\nUNION ALL\n\n') + `\nORDER BY nama_jenjang ASC, class_name ASC, student_name ASC`;
    const args = parts.flatMap(() => tanggal ? [kegiatan_id, tanggal] : [kegiatan_id]);

    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// 6b. RIWAYAT ABSENSI KEGIATAN (ISTIGHOSAH) SEORANG MURID
export const getStudentKegiatanHistoryService = async (nim, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    // v3.6: sembunyikan kegiatan khusus guru dari riwayat santri
    const scopeClause = l === 'ALL'
        ? "WHERE (k.target IS NULL OR k.target <> 'GURU')"
        : "WHERE k.lembaga IN (?, ?) AND (k.target IS NULL OR k.target <> 'GURU')";
    const args = l === 'ALL' ? [nim] : [nim, l, 'ALL'];

    const query = `
        SELECT k.id AS kegiatan_id, k.activity_name, k.activity_date,
               COALESCE(latest.status, 'ALPA') AS status,
               latest.notes, latest.tanggal_absensi
        FROM kegiatan k
        LEFT JOIN (
            SELECT a.activity_id, a.nim, a.status, a.notes, a.tanggal_absensi
            FROM absensi_istighosah a
            WHERE a.tanggal_absensi = (
                SELECT MAX(b.tanggal_absensi) FROM absensi_istighosah b
                WHERE b.activity_id = a.activity_id AND b.nim = a.nim
            )
        ) latest ON latest.activity_id = k.id AND latest.nim = ?
        ${scopeClause}
        ORDER BY k.activity_date DESC, k.id DESC
    `;

    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};

// 6. RIWAYAT ABSENSI SEORANG GURU DI SEMUA KEGIATAN
// Semua kegiatan ditampilkan; kegiatan tanpa record absen dianggap ALPA.
export const getTeacherAttendanceHistoryService = async (teacherId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    // v3.6: sembunyikan kegiatan khusus murid/santri dari riwayat guru
    const scopeClause = l === 'ALL'
        ? "WHERE (k.target IS NULL OR k.target <> 'MURID')"
        : "WHERE k.lembaga IN (?, ?) AND (k.target IS NULL OR k.target <> 'MURID')";
    const args = l === 'ALL' ? [teacherId] : [teacherId, l, 'ALL'];

    const query = `
        SELECT k.id AS kegiatan_id, k.activity_name, k.activity_date,
               COALESCE(kta.status, 'ALPA') AS status,
               kta.notes, kta.created_at
        FROM kegiatan k
        LEFT JOIN kegiatan_teacher_attendances kta
               ON kta.kegiatan_id = k.id AND kta.teacher_id = ?
        ${scopeClause}
        ORDER BY k.activity_date DESC, k.id DESC
    `;

    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};

export const getKegiatanReportService = async (kegiatan_id, lembaga = 'ALL', tanggal = null) => {
    // Sumber data gabungan: santri_penempatan (madrasah + tpq), fallback students
    // Lembaga membatasi data sesuai sumber lembaganya.
    const l = (lembaga || 'ALL').toUpperCase();
    const jenjangFilter = l === 'TPQ'
        ? "AND aa.jenjang_id = 100"
        : l === 'MADRASAH'
            ? "AND aa.jenjang_id IN (1,2,3)"
            : "";
    // v3.43: rekap live kegiatan mingguan bisa dibatasi ke tanggal tertentu (opsional)
    const tanggalFilter = tanggal ? "AND aa.tanggal_absensi = ?" : "";

    const query = `
        SELECT 
            aa.nim,
            COALESCE(
                (SELECT name FROM santri_penempatan WHERE nim = aa.nim LIMIT 1),
                (SELECT name FROM students WHERE nim = aa.nim LIMIT 1)
            ) AS student_name,
            (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = aa.nim LIMIT 1) AS class_name,
            COALESCE(
                (SELECT j.nama_jenjang FROM santri_penempatan sp JOIN jenjang j ON sp.jenjang_id = j.id WHERE sp.nim = aa.nim LIMIT 1),
                (SELECT j.nama_jenjang FROM students st JOIN jenjang j ON st.jenjang_id = j.id WHERE st.nim = aa.nim LIMIT 1)
            ) AS nama_jenjang,
            aa.status, 
            aa.notes
        FROM absensi_istighosah aa
        WHERE aa.activity_id = ?
        ${jenjangFilter}
        ${tanggalFilter}
        ORDER BY aa.id DESC
    `;

    const result = await db.execute({
        sql: query,
        args: tanggal ? [kegiatan_id, tanggal] : [kegiatan_id]
    });

    return result.rows;
};

// 4. MENCATAT ABSENSI KEGIATAN GURU / ASATIDZ (UPSERT)
export const logKegiatanTeacherAttendanceService = async (kegiatan_id, teacher_id, status, notes, latitude, longitude, accuracy) => {
    // v3.6: guard target peserta — tolak guru di kegiatan khusus murid/santri
    const kegiatan = await assertGuruAllowed(kegiatan_id);

    // v3.44: jendela presensi guru — anchor = tanggal kegiatan (skip utk WEEKLY yg tak punya tanggal per pertemuan).
    if (kegiatan?.repeat_type !== 'WEEKLY') {
        assertDalamJendelaPresensiHelper(kegiatan, kegiatan?.activity_date);
    }

    const query = `
        INSERT INTO kegiatan_teacher_attendances (kegiatan_id, teacher_id, status, notes, latitude, longitude, accuracy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
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
            kegiatan_id,
            teacher_id,
            status ? status.toUpperCase() : 'HADIR',
            notes || null,
            latitude ?? null,
            longitude ?? null,
            accuracy ?? null
        ]
    });

    return {
        kegiatan_id,
        teacher_id,
        status: status ? status.toUpperCase() : 'HADIR'
    };
};

// 5. ROSTER GURU LENGKAP + STATUS KEHADIRAN DI KEGIATAN TERTENTU
// Murid/Guru tanpa record absen otomatis dianggap ALPA (tidak hadir).
export const getKegiatanTeacherReportService = async (kegiatan_id, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();

    // v3.6: kegiatan khusus murid/santri → roster guru kosong
    const kegiatan = await getKegiatanById(kegiatan_id);
    if (!kegiatan || kegiatan.target === 'MURID') return [];

    const whereClause = l === 'ALL' ? '' : 'WHERE t.lembaga IN (?, ?)';
    const args = l === 'ALL' ? [kegiatan_id] : [kegiatan_id, l, 'ALL'];

    const query = `
        SELECT t.id AS teacher_id, t.username, t.name,
               COALESCE(kta.status, 'ALPA') AS status,
               kta.notes
        FROM teachers t
        LEFT JOIN kegiatan_teacher_attendances kta ON kta.teacher_id = t.id AND kta.kegiatan_id = ?
        ${whereClause}
        ORDER BY t.name ASC
    `;

    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};