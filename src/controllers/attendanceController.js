import * as attendanceService from '../services/attendanceService.js';
import db from '../config/db.js';

// Helper zona waktu lokal (WIB/Local) YYYY-MM-DD
const todayLocalISO = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().split('T')[0];
};

const isValidDateStr = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// 1. MENCATAT PRESENSI SANTRI
export const logAttendance = async (req, res) => {
    const { student_id, session_name, status, notes, schedule_id, latitude, longitude, accuracy, date } = req.body;

    if (!student_id || !session_name || !status || !schedule_id) {
        return res.status(400).json({ success: false, message: 'Data kurang lengkap! Pastikan menyertakan ID Jadwal.' });
    }

    let targetDate = todayLocalISO();
    if (date !== undefined && date !== null && date !== '') {
        if (!isValidDateStr(String(date))) {
            return res.status(400).json({ success: false, message: 'Format tanggal tidak valid! Gunakan YYYY-MM-DD.' });
        }
        if (targetDate < String(date)) {
            return res.status(400).json({ success: false, message: 'Tidak dapat mengisi presensi untuk tanggal yang akan datang.' });
        }
        targetDate = String(date);
    }

    try {
        const currentUserId = Number(req.user.id);
        const currentUserRole = req.user.role;
        const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const isScoped = callerLembaga !== 'ALL';

        // Ambil jadwal untuk otorisasi & atribusi guru pengajar
        const checkSchedule = await db.execute({
            sql: "SELECT teacher_id, substitute_teacher_id, lembaga FROM schedules WHERE id = ?",
            args: [schedule_id]
        });

        if (checkSchedule.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Jadwal pelajaran tidak ditemukan!' });
        }

        const { teacher_id, substitute_teacher_id, lembaga: scheduleLembaga } = checkSchedule.rows[0];
        const mainTeacherId = Number(teacher_id);
        const subTeacherId = substitute_teacher_id ? Number(substitute_teacher_id) : null;

        // Validasi Otorisasi jika role adalah Teacher
        if (currentUserRole === 'teacher') {
            const isMainTeacher = currentUserId === mainTeacherId;
            const isSubstituteTeacher = currentUserId === subTeacherId;

            if (!isMainTeacher && !isSubstituteTeacher) {
                return res.status(403).json({
                    success: false,
                    message: 'Akses Ditolak! Anda bukan Guru Utama maupun Guru Piket yang ditugaskan di kelas ini pada jam ini.'
                });
            }
        }

        // Validasi lembaga jadwal: scoped admin/guru hanya boleh mengabsen kelas lembaganya sendiri
        if (isScoped) {
            const sLembaga = (scheduleLembaga || 'ALL').toUpperCase();
            if (sLembaga !== 'ALL' && sLembaga !== callerLembaga) {
                return res.status(403).json({ success: false, message: 'Akses Ditolak! Jadwal tersebut milik lembaga lain.' });
            }
        }

        // Validasi santri: scoped admin/guru hanya boleh mengabsen murid lembaganya sendiri
        const studentRow = await db.execute({
            sql: 'SELECT id, lembaga FROM students WHERE id = ? LIMIT 1',
            args: [student_id]
        });
        if (studentRow.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Murid tidak ditemukan!' });
        }
        if (isScoped) {
            const stLembaga = (studentRow.rows[0]?.lembaga || 'ALL').toUpperCase();
            if (stLembaga !== 'ALL' && stLembaga !== callerLembaga) {
                return res.status(403).json({ success: false, message: 'Akses Ditolak! Murid tersebut milik lembaga lain.' });
            }
        }

        // Atribusi Guru yang mencatat / ditugaskan
        const effectiveTeacherId = currentUserRole === 'teacher'
            ? currentUserId
            : (subTeacherId ?? mainTeacherId);

        const normalizedStatus = String(status).toUpperCase().replace('ALFA', 'ALPA');

        // Cek status sebelumnya
        const prev = await db.execute({
            sql: 'SELECT status FROM attendances WHERE student_id = ? AND date = ? AND session_name = ? LIMIT 1',
            args: [student_id, targetDate, session_name.toUpperCase()]
        });
        const previousStatus = prev.rows[0]?.status || null;
        const isUpdate = !!previousStatus;

        // Delegasikan penyimpanan ke Service Layer
        await attendanceService.recordAttendanceService({
            student_id,
            session_name,
            status: normalizedStatus,
            notes,
            teacher_id: effectiveTeacherId,
            date: targetDate,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            accuracy: accuracy ?? null
        });

        return res.json({
            success: true,
            message: 'Presensi santri berhasil dicatat oleh ' + req.user.name,
            updated: isUpdate,
            previousStatus,
            status: normalizedStatus,
            date: targetDate,
            session_name: session_name.toUpperCase()
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 2. REKAP ABSENSI KELAS
export const getClassAttendance = async (req, res) => {
    const { classroom_id } = req.params;
    const { session, date, session_name } = req.query;
    const targetSession = session || session_name || 'PAGI';
    const targetDate = date || todayLocalISO();

    if (!classroom_id) {
        return res.status(400).json({ success: false, message: 'ID Kelas wajib disertakan!' });
    }

    try {
        const data = await attendanceService.getClassAttendanceService(classroom_id, targetSession, targetDate, req.user?.lembaga);

        const summary = { hadir: 0, sakit: 0, izin: 0, alpa: 0, belum: 0, total: data.length };
        for (const r of data) {
            const s = (r.status || '').toUpperCase();
            if (!r.status) summary.belum++;
            else if (s === 'HADIR') summary.hadir++;
            else if (s === 'SAKIT') summary.sakit++;
            else if (s === 'IZIN') summary.izin++;
            else if (s === 'ALPA') summary.alpa++;
            else summary.belum++;
        }
        const sudah = summary.hadir + summary.sakit + summary.izin + summary.alpa;

        return res.json({
            success: true,
            message: `Data absensi tatap muka berhasil ditarik!`,
            count: data.length,
            summary: { ...summary, sudah },
            session_name: targetSession.toUpperCase(),
            date: targetDate,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 3. RIWAYAT MENGAJAR GURU
export const getTeacherHistory = async (req, res) => {
    const teacherId = Number(req.params.teacher_id);

    if (!teacherId || !Number.isFinite(teacherId)) {
        return res.status(400).json({ success: false, message: 'ID Guru wajib disertakan!' });
    }

    if (req.user?.role === 'teacher' && Number(req.user.id) !== teacherId) {
        return res.status(403).json({ success: false, message: 'Anda hanya dapat melihat riwayat mengajar sendiri!' });
    }

    try {
        const data = await attendanceService.getTeacherTeachingHistoryService(teacherId, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Riwayat mengajar guru berhasil dimuat.',
            total_all: data.length,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 4. RIWAYAT ABSENSI SANTRI
export const getStudentKbmHistory = async (req, res) => {
    const studentId = Number(req.params.student_id);

    if (!studentId || !Number.isFinite(studentId)) {
        return res.status(400).json({ success: false, message: 'ID Murid wajib disertakan!' });
    }

    try {
        const data = await attendanceService.getStudentKbmHistoryService(studentId, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Riwayat absensi KBM murid berhasil dimuat.',
            total_all: data.length,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};