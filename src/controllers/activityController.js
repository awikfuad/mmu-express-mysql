import * as activityService from '../services/activityService.js';
 import db from '../config/db.js';

// Membuat Acara Baru
export const addActivity = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    if (!activity_name || !activity_date) {
        return res.status(400).json({ success: false, message: 'Nama dan Tanggal Kegiatan wajib diisi!' });
    }
    try {
        const data = await activityService.createActivityService(req.body, req.user?.lembaga);
        return res.status(201).json({ success: true, message: 'Agenda kegiatan berhasil dibuat!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Mengabsen Santri di Kegiatan
export const logActivityAttendance = async (req, res) => {
    const { activity_id, student_id, status, latitude, longitude, accuracy } = req.body;
    if (!activity_id || !student_id || !status) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan, ID Santri, dan Status Absen wajib diisi!' });
    }

    try {
        const data = await activityService.recordActivityAttendanceService({
            ...req.body,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            accuracy: accuracy ?? null
        });
        return res.json({ success: true, message: 'Presensi kegiatan santri berhasil disimpan!', data });
    } catch (error) {
        // v3.6: guard target/jenjang melempar error berstatus (403/404) — teruskan apa adanya
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Mengambil Semua Agenda Kegiatan (Controller)
export const getActivities = async (req, res) => {
    try {
        // Memanggil fungsi dari service dengan await (v3.6: + filter target/jenjang)
        const filters = {
            audience: req.query.target || req.query.audience,
            jenjang_id: req.query.jenjang_id
        };
        const data = await activityService.getAllActivitiesService(req.user?.lembaga, filters);
        
        return res.status(200).json({ 
            success: true, 
            count: data.length,
            data: data 
        });
    } catch (error) {
        // Menangkap error jika database bermasalah atau query salah
        return res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};



// Melihat Rekap Kehadiran Acara / Live Log Scanner
export const getActivityReport = async (req, res) => {
    const { activity_id } = req.params;
    
    if (!activity_id) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan wajib disertakan!' });
    }

    try {
        // Memanggil fungsi service yang sudah kita perbaiki di atas
        const data = await activityService.getActivityReportService(activity_id, req.user?.lembaga);
        
        return res.json({ 
            success: true, 
            count: data.length, 
            data: data // Mengembalikan array berisi { student_id, student_name, status, class_name }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};