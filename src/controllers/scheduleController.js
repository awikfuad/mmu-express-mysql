import * as scheduleService from '../services/scheduleService.js';
import { ScheduleConflictError } from '../services/scheduleService.js';
import db from '../config/db.js';

const handleConflict = (error, res) => {
    if (error instanceof ScheduleConflictError) {
        return res.status(409).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
};

// Nama hari bahasa Indonesia (index = new Date().getDay(): 0 = Minggu/AHAD)
const DAY_NAMES = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

// Resolve nama hari dari tanggal YYYY-MM-DD (memakai parse lokal agar aman zona waktu).
// Mengembalikan null bila tanggal tidak valid/gagal parse.
const dayNameFromDate = (dateStr) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return null;
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return DAY_NAMES[dt.getDay()];
};

// Controller untuk Guru melihat jadwal mengajarnya (hari ini, atau tanggal yang dipilih via ?date=)
export const getMyScheduleToday = async (req, res) => {
    const teacherId = req.user.id; // Ambil ID dari token guru yang sedang login
    const date = req.query?.date ? String(req.query.date).trim() : null;
    const todayName = dayNameFromDate(date) || DAY_NAMES[new Date().getDay()];

    try {
        const data = await scheduleService.getTeacherScheduleTodayService(teacherId, todayName, req.user?.lembaga);
        return res.json({
            success: true,
            message: `Jadwal mengajar Anda pada hari ${todayName} berhasil diambil.`,
            date: date || new Date().toISOString().split('T')[0],
            count: data.length,
            data
        });
    } catch (error) {
        return handleConflict(error, res);
    }
};

// Controller untuk Guru melihat jadwal mengajarnya SEMINGGU (SENIN–AHAD, utama + piket/badal)
export const getMyScheduleWeekly = async (req, res) => {
    const teacherId = req.user.id;
    try {
        const data = await scheduleService.getTeacherScheduleWeeklyService(teacherId, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Jadwal mengajar sepekan berhasil diambil.',
            count: data.length,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Controller untuk Admin melihat SEMUA jadwal seminggu (opsional filter ?teacher_id= utk jadwal per guru)
export const getAllWeekSchedules = async (req, res) => {
    const teacherId = req.query?.teacher_id ? Number(req.query.teacher_id) : null;
    try {
        const data = await scheduleService.getAllWeekSchedulesService(req.user?.lembaga, teacherId);
        return res.json({
            success: true,
            message: teacherId
                ? 'Jadwal sepekan guru berhasil diambil.'
                : 'Semua jadwal sepekan berhasil diambil.',
            count: data.length,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Controller untuk Admin memasang Guru Piket jika Guru Utama berhalangan
export const assignSubstitute = async (req, res) => {
    // Dukung dua bentuk: PUT /schedules/:schedule_id/piket (params) & POST /schedules/assign-piket (body)
    const schedule_id = req.params.schedule_id ?? req.body?.schedule_id;
    const substitute_teacher_id = req.body?.substitute_teacher_id ?? req.params?.substitute_teacher_id;

    if (!schedule_id) {
        return res.status(400).json({ success: false, message: 'ID Jadwal (schedule_id) wajib diisi!' });
    }

    try {
        const data = await scheduleService.assignSubstituteTeacherService(schedule_id, substitute_teacher_id);
        return res.json({
            success: true,
            message: substitute_teacher_id 
                ? 'Guru pengganti/piket berhasil ditugaskan untuk jadwal ini!' 
                : 'Jadwal dikembalikan ke Guru Utama.',
            data
        });
    } catch (error) {
        return handleConflict(error, res);
    }
};

// Controller untuk Guru "Ambil Alih Piket" (badal) kelas yang guru utamanya berhalangan
export const claimPiket = async (req, res) => {
    const schedule_id = Number(req.params.schedule_id) || Number(req.body?.schedule_id);

    if (!schedule_id || !Number.isFinite(schedule_id)) {
        return res.status(400).json({ success: false, message: 'ID Jadwal (schedule_id) wajib diisi!' });
    }

    try {
        const check = await db.execute({
            sql: "SELECT teacher_id, substitute_teacher_id FROM schedules WHERE id = ?",
            args: [schedule_id]
        });

        if (check.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Jadwal pelajaran tidak ditemukan!' });
        }

        const { teacher_id } = check.rows[0];

        let substituteTeacherId;
        if (req.user?.role === 'admin' && req.body?.teacher_id) {
            // Admin bebas menugaskan guru piket tertentu
            substituteTeacherId = Number(req.body.teacher_id);
        } else if (req.user?.role === 'teacher') {
            // Guru mengambil alih piket untuk dirinya sendiri
            substituteTeacherId = req.user.id;

            if (req.user.id === teacher_id) {
                return res.status(400).json({ success: false, message: 'Anda adalah Guru Utama di kelas ini, tidak perlu badal.' });
            }
        } else {
            return res.status(400).json({ success: false, message: 'ID guru piket wajib ditentukan.' });
        }

        if (!substituteTeacherId || !Number.isFinite(substituteTeacherId)) {
            return res.status(400).json({ success: false, message: 'ID guru piket tidak valid.' });
        }

        const data = await scheduleService.assignSubstituteTeacherService(schedule_id, substituteTeacherId);
        return res.json({
            success: true,
            message: 'Guru piket berhasil mengambil alih kelas ini.',
            data
        });
    } catch (error) {
        return handleConflict(error, res);
    }
};

// ==========================================
// 1. CONTROLLER (scheduleController.js)
// ==========================================
export const createSchedule = async (req, res) => {
  try {
    const { 
      academic_year_id, 
      jenjang_id, 
      rombel_id,       
      classroom_id, 
      subject_id, 
      day_of_week, 
      start_time, 
      end_time, 
      main_teacher_id,
      jp
    } = req.body;

    // VALIDASI INPUT WAJIB: Sertakan academic_year_id!
    if (!academic_year_id || !classroom_id || !subject_id || !day_of_week || !start_time || !end_time || !main_teacher_id) {
      return res.status(400).json({
        success: false,
        message: "Semua kolom jadwal wajib diisi (Termasuk Tahun Akademik)!"
      });
    }

    // Panggil Service Layer
    const data = await scheduleService.createNewScheduleService({
      academic_year_id, 
      jenjang_id, 
      rombel_id,       
      classroom_id, 
      subject_id, 
      day_of_week, 
      start_time, 
      end_time, 
      main_teacher_id,
      jp
    }, req.user?.lembaga);

    return res.status(201).json({
      success: true,
      message: "🎉 Jadwal pelajaran baru berhasil didaftarkan!",
      data
    });

  } catch (error) {
    console.error("Error pada createSchedule backend:", error);

    // Tangani jika error merupakan bentrok jadwal
    if (error instanceof ScheduleConflictError || error.message.includes('bentrok') || error.message.includes('Conflict')) {
      return res.status(409).json({ 
        success: false, 
        message: error.message 
      });
    }

    return res.status(500).json({
      success: false,
      message: "Gagal menyimpan jadwal ke database server.",
      error: error.message
    });
  }
};



// Controller untuk Admin memperbarui jadwal pelajaran
export const updateSchedule = async (req, res) => {
  const { schedule_id } = req.params;

  try {
    const data = await scheduleService.updateScheduleService(schedule_id, req.body, req.user?.lembaga);
    return res.json({
      success: true,
      message: "🎉 Jadwal pelajaran berhasil diperbarui!",
      data
    });
  } catch (error) {
    console.error("Error pada updateSchedule backend:", error);
    if (error instanceof ScheduleConflictError) {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.message === 'Jadwal pelajaran tidak ditemukan.' || error.message === 'ID jadwal tidak valid.') {
      return res.status(404).json({ success: false, message: error.message });
    }
    return res.status(400).json({ success: false, message: error.message });
  }
};
// Controller untuk Admin melihat SEMUA jadwal (hari ini, atau tanggal yang dipilih via ?date=)
export const getAllTodaySchedules = async (req, res) => {
    const date = req.query?.date ? String(req.query.date).trim() : null;
    const todayName = dayNameFromDate(date) || DAY_NAMES[new Date().getDay()];

    try {
        const data = await scheduleService.getAllTodaySchedulesService(todayName, req.user?.lembaga);
        return res.json({
            success: true,
            date: date || new Date().toISOString().split('T')[0],
            day: todayName,
            count: data.length,
            data
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getSchedules = async (req, res) => {
    const { tahun } = req.params;
    try {
        const data = await scheduleService.getSchedules(tahun, null, req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}

// Scan semua jadwal untuk menemukan bentrok (kelas/guru di jam sama) — T3.7
export const getScheduleConflicts = async (req, res) => {
    const { tahun } = req.params;
    try {
        const data = await scheduleService.detectScheduleConflictsService(tahun, req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        console.error('EROR SCAN BENTROK JADWAL:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
}
