import db from '../config/db.js';

// 1. MEMBUAT AGENDA KEGIATAN BARU (Oleh Admin via Web Vue)
export const createActivityService = async (activityData) => {
    const { activity_name, activity_date, description } = activityData;
    const query = `
        INSERT INTO activities (activity_name, activity_date, description)
        VALUES (?, ?, ?)
    `;
    const result = await db.execute({
        sql: query,
        args: [activity_name, activity_date, description || null]
    });
    return { id: result.lastInsertRowid, activity_name, activity_date };
};

// 2. MENCATAT ABSENSI KEGIATAN SANTRI (UPSERT)
export const recordActivityAttendanceService = async (attendanceData) => {
    const { academic_year_id, jenjang_id, nim, tanggal_absensi, activity_id, student_id, status, notes } = attendanceData;

    const query = `
        INSERT INTO activity_attendances (academic_year_id, jenjang_id, nim, tanggal_absensi, activity_id, student_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            notes = VALUES(notes),
            created_at = CURRENT_TIMESTAMP
    `;
    await db.execute({
        sql: query,
        args: [academic_year_id, jenjang_id, nim, tanggal_absensi, activity_id, student_id, status.toUpperCase(), notes || null]
    });
    return { activity_id, student_id, status };
};

// 3. MELIHAT REKAP ABSENSI PER KEGIATAN TERTENTU
export const getActivityAttendanceReportService = async (activityId) => {
    const query = `
        SELECT s.id as student_id, s.nim, s.name,
               (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = s.nim LIMIT 1) AS class_name,
               COALESCE(aa.status, 'ALPA') as status, aa.notes
        FROM students s
        LEFT JOIN activity_attendances aa ON s.id = aa.student_id AND aa.activity_id = ?
        ORDER BY class_name ASC, s.name ASC
    `;
    const result = await db.execute({
        sql: query,
        args: [activityId]
    });
    return result.rows;
};

export const getAllActivitiesService = async () => {
    const sql = `SELECT id, activity_name, activity_date, description, created_at 
                 FROM activities 
                 ORDER BY activity_date DESC`;
    
    // Menembak langsung menggunakan execute (biasanya mengembalikan { rows: [...] } atau langsung array)
    const result = await db.execute(sql);
    
    // Jika result berbentuk objek yang membungkus rows, kembalikan result.rows, jika tidak langsung result   
    return result.rows || result;
};

export const getActivityReportService = async (activityId) => {
    // Kueri diperbaiki: Utama dari activity_attendances, lalu join ke students
    const query = `
        SELECT 
            aa.student_id, 
            s.nim, 
            s.name AS student_name, 
            (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = s.nim LIMIT 1) AS class_name,
            aa.status, 
            aa.notes
        FROM activity_attendances aa
        INNER JOIN students s ON aa.student_id = s.id
        WHERE aa.activity_id = ?
        AND DATE(aa.created_at) = CURDATE()
        ORDER BY aa.id DESC
    `;
    
    const result = await db.execute({
        sql: query,
        args: [activityId]
    });
    
    return result.rows;
};