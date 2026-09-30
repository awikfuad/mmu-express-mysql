import * as istghosahService from '../services/istighosahService.js';
 import db from '../config/db.js';

// Membuat Acara Baru
export const addKegiatan = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    if (!activity_name || !activity_date) {
        return res.status(400).json({ success: false, message: 'Nama dan Tanggal Kegiatan wajib diisi!' });
    }
    try {
        const data = await istghosahService.createActivityService(req.body);
        return res.status(201).json({ success: true, message: 'Agenda kegiatan berhasil dibuat!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Mengabsen Santri di Kegiatan
export const logKegiatanAttendance = async (req, res) => {
    const { activity_id, student_id, status } = req.body;
    if (!activity_id || !student_id || !status) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan, ID Santri, dan Status Absen wajib diisi!' });
    }

    try {
        const data = await istghosahService.recordActivityAttendanceService(req.body);
        return res.json({ success: true, message: 'Presensi kegiatan santri berhasil disimpan!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
export const logKegiatan = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    if (!activity_name || !activity_date) {
        return res.status(400).json({ success: false, message: 'Nama dan Tanggal Kegiatan wajib diisi!' });
    }

    try {
        const data = await istghosahService.createActivityService(req.body);
        return res.json({ success: true, message: 'Presensi kegiatan santri berhasil disimpan!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Melihat Rekap Kehadiran Acara
export const getAllKegiatanService = async () => {
    const sql = `SELECT id, activity_name, activity_date, description, created_at 
                 FROM activities 
                 ORDER BY activity_date DESC`;
    
    // Menembak langsung menggunakan execute (biasanya mengembalikan { rows: [...] } atau langsung array)
    const result = await db.execute(sql);
    
    // Jika result berbentuk objek yang membungkus rows, kembalikan result.rows, jika tidak langsung result
    return result.rows || result;
};

// Mengambil Semua Agenda Kegiatan (Controller)
export const getKegiatan = async (req, res) => {
    try {
        // Memanggil fungsi dari service dengan await
        const data = await istghosahService.getAllActivitiesService();
        
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
export const getKegiatanReport = async (req, res) => {
    const { activity_id } = req.params;
    
    if (!activity_id) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan wajib disertakan!' });
    }

    try {
        // Memanggil fungsi service yang sudah kita perbaiki di atas
        const data = await istghosahService.getActivityReportService(activity_id);
        
        return res.json({ 
            success: true, 
            count: data.length, 
            data: data // Mengembalikan array berisi { student_id, student_name, status, class_name }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};