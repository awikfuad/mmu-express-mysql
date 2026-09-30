import db from '../config/db.js';

// Helper untuk mendapatkan tanggal hari ini format YYYY-MM-DD sesuai zona waktu lokal (Asia/Jakarta)
const getTodayDateString = () => {
    const d = new Date();
    // Menyesuaikan offset UTC+7 (WIB)
    const wibDate = new Date(d.getTime() + (7 * 60 * 60 * 1000));
    return wibDate.toISOString().split('T')[0];
};

// 1. MENCATAT ATAU MEMPERBARUI ABSENSI PER TATAP MUKA (Single Student)
export const recordAttendanceService = async (attendanceData) => {
    const { student_id, teacher_id, session_name, status, notes, date, latitude, longitude, accuracy } = attendanceData;
    
    const query = `
        INSERT INTO attendances (student_id, teacher_id, session_name, status, notes, date, latitude, longitude, accuracy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            teacher_id = VALUES(teacher_id),
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
            student_id, teacher_id || null, session_name.toUpperCase(), 
            status.toUpperCase(), notes || null, date,
            latitude || null, longitude || null, accuracy || null
        ]
    });
};

// 2. MELIHAT REKAP ABSENSI KELAS BERDASARKAN TANGGAL DAN SESI TATAP MUKA TERTENTU
export const getClassAttendanceService = async (classroomId, sessionName, date, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const targetDate = date || getTodayDateString();
    const targetSession = sessionName ? sessionName.toUpperCase() : 'PAGI';

    // Scoped admin/guru hanya boleh membuka roster kelas lembaganya sendiri (sumber sama)
    const scope = l === 'ALL' ? '' : 'AND sp.sumber = ?';
    const scopeArgs = l === 'ALL' ? '' : l === 'TPQ' ? 'tpq' : 'madrasah';

    const query = `
        SELECT sp.id AS placement_id,
               sp.nim,
               sp.name AS student_name,
               st.id AS student_id,
               c.class_name,
               ? AS session_name,
               a.status,
               a.notes,
               a.date,
               a.teacher_id,
               CASE WHEN a.student_id IS NOT NULL THEN 1 ELSE 0 END AS already_absen
        FROM santri_penempatan sp
        LEFT JOIN students st ON st.nim = sp.nim
        LEFT JOIN classes c ON sp.classroom_id = c.id
        LEFT JOIN attendances a ON a.student_id = st.id
                                 AND a.date = ? AND a.session_name = ?
        WHERE sp.classroom_id = ? AND (sp.status IS NULL OR sp.status = 1) ${scope}
        ORDER BY sp.name ASC
    `;

    const args = scopeArgs === ''
        ? [targetSession, targetDate, targetSession, classroomId]
        : [targetSession, targetDate, targetSession, classroomId, scopeArgs];

    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};

// 3. RIWAYAT MENGAJAR (KBM) SEORANG GURU
export const getTeacherTeachingHistoryService = async (teacherId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();

    // Query dioptimalkan dengan correlated join / subquery sederhana
    const whereLembagaSchedules = l === 'ALL' ? '' : 'AND s.lembaga IN (?, ?)';

    const query = `
        SELECT a.date, a.session_name,
               COUNT(*) AS total,
               SUM(CASE WHEN a.status = 'HADIR' THEN 1 ELSE 0 END) AS hadir,
               SUM(CASE WHEN a.status = 'SAKIT' THEN 1 ELSE 0 END) AS sakit,
               SUM(CASE WHEN a.status = 'IZIN' THEN 1 ELSE 0 END) AS izin,
               SUM(CASE WHEN a.status = 'ALPA' THEN 1 ELSE 0 END) AS alpa,
               COALESCE((
                   SELECT GROUP_CONCAT(sub.subject_name, ', ')
                   FROM schedules s
                   INNER JOIN subjects sub ON s.subject_id = sub.id
                   WHERE (s.teacher_id = a.teacher_id OR s.substitute_teacher_id = a.teacher_id)
                     AND s.session_name = a.session_name
                     ${whereLembagaSchedules}
               ), '-') AS subject_names,
               COALESCE((
                   SELECT GROUP_CONCAT(c.class_name, ', ')
                   FROM schedules s
                   LEFT JOIN classes c ON s.classroom_id = c.id
                   WHERE (s.teacher_id = a.teacher_id OR s.substitute_teacher_id = a.teacher_id)
                     AND s.session_name = a.session_name
                     ${whereLembagaSchedules}
               ), '-') AS class_names
        FROM attendances a
        WHERE a.teacher_id = ?
        GROUP BY a.date, a.session_name
        ORDER BY a.date DESC, a.session_name DESC
    `;

    let args = [];
    if (l === 'ALL') {
        args = [teacherId];
    } else {
        // Urutan parameter sesuai urutan tanda tanya (?) di subquery + main query
        args = [l, 'ALL', l, 'ALL', teacherId];
    }

    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// 4. RIWAYAT ABSENSI KBM SEORANG MURID (per tanggal + sesi)
export const getStudentKbmHistoryService = async (studentId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();

    // Scoped admin hanya boleh melihat riwayat murid lembaganya sendiri
    // (murid legacy 'ALL' yang belum ditandai tetap bisa dilihat — akan diadopsi lembaganya).
    const scope = l === 'ALL'
        ? 'a.student_id = ?'
        : 'a.student_id = ? AND st.lembaga IN (?, ?)';
    const args = l === 'ALL'
        ? [studentId]
        : [studentId, l, 'ALL'];

    const query = `
        SELECT a.date, a.session_name, a.status, a.notes,
               t.name AS teacher_name
        FROM attendances a
        LEFT JOIN students st ON a.student_id = st.id
        LEFT JOIN teachers t ON a.teacher_id = t.id
        WHERE ${scope}
        ORDER BY a.date DESC, a.session_name DESC
    `;

    const result = await db.execute({ sql: query, args });
    return result.rows;
};