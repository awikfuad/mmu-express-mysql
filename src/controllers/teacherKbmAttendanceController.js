import {
    getTeacherKbmRosterService,
    saveTeacherKbmAttendanceService,
    getTeacherKbmAttendanceHistoryService
} from '../services/teacherKbmAttendanceService.js';

const handleError = (res, error) => {
    const status = error.status || 400;
    if (status === 500) console.error('❌ teacherKbmAttendanceController:', error);
    res.status(status).json({ success: false, message: error.message || 'Terjadi kesalahan pada server.' });
};

// GET /teacher-kbm-attendance?tanggal=YYYY-MM-DD — roster mengajar guru hari tsb + status absensi
export const getTeacherKbmRoster = async (req, res) => {
    try {
        const data = await getTeacherKbmRosterService(req.query || {}, req.user?.lembaga);
        res.json({ success: true, ...data });
    } catch (error) {
        handleError(res, error);
    }
};

// POST /teacher-kbm-attendance { tanggal, items: [{ schedule_id, status?, keterangan? }] }
export const saveTeacherKbmAttendance = async (req, res) => {
    try {
        const result = await saveTeacherKbmAttendanceService(req.body, req.user?.lembaga, req.user?.name || null);
        res.json({ success: true, message: `${result.count} absensi guru KBM berhasil disimpan.`, ...result });
    } catch (error) {
        handleError(res, error);
    }
};

// GET /teacher-kbm-attendance/history — riwayat absensi guru KBM (filter tanggal/status/guru)
export const getTeacherKbmHistory = async (req, res) => {
    try {
        const data = await getTeacherKbmAttendanceHistoryService(req.query || {}, req.user?.lembaga);
        res.json({ success: true, ...data });
    } catch (error) {
        handleError(res, error);
    }
};