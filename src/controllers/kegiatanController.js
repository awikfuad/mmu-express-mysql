import * as kegiatanService from '../services/kegiatanService.js';
import * as muridKelasService from '../services/muridKelasService.js';
import db from '../config/db.js';

// v3.6: validasi payload target peserta & jenjang sasaran
const validateTargetPayload = (body) => {
    if (body.target !== undefined && body.target !== null && body.target !== '') {
        const up = String(body.target).trim().toUpperCase();
        if (!kegiatanService.KEGIATAN_TARGETS.includes(up)) {
            return 'Target peserta tidak valid (gunakan MURID, GURU, atau SEMUA).';
        }
    }
    if (body.target_jenjang !== undefined && body.target_jenjang !== null && body.target_jenjang !== '') {
        const raw = Array.isArray(body.target_jenjang) ? body.target_jenjang : [body.target_jenjang];
        const valid = raw.every((v) => Number.isFinite(parseInt(v, 10)));
        if (!valid) {
            return 'target_jenjang harus berupa daftar id jenjang yang valid.';
        }
    }
    // v3.42: target_kelas opsional — daftar id classes
    if (body.target_kelas !== undefined && body.target_kelas !== null && body.target_kelas !== '') {
        const raw = Array.isArray(body.target_kelas) ? body.target_kelas : [body.target_kelas];
        const valid = raw.every((v) => Number.isFinite(parseInt(v, 10)));
        if (!valid) {
            return 'target_kelas harus berupa daftar id kelas yang valid.';
        }
    }
    // v3.43: repeat_type opsional — ONCE (sekali) atau WEEKLY (mingguan, absensi per tanggal)
    if (body.repeat_type !== undefined && body.repeat_type !== null && body.repeat_type !== '') {
        const up = String(body.repeat_type).trim().toUpperCase();
        if (!kegiatanService.KEGIATAN_REPEAT_TYPES.includes(up)) {
            return 'Frekuensi kegiatan tidak valid (gunakan ONCE atau WEEKLY).';
        }
    }
    return null;
};

export const getKegiatan = async (req, res) => {
    try {
        const filters = {
            audience: req.query.target || req.query.audience,
            jenjang_id: req.query.jenjang_id,
            kelas_id: req.query.kelas_id
        };
        const data = await kegiatanService.getAllActivitiesService(req.user?.lembaga, filters);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const buatKegiatan = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    
    if (!activity_name || !activity_date) {
        return res.status(400).json({ 
            success: false, 
            message: 'Nama Kegiatan dan Tanggal Pelaksanaan wajib diisi!' 
        });
    }

    const targetError = validateTargetPayload(req.body);
    if (targetError) {
        return res.status(400).json({ success: false, message: targetError });
    }

    try {
        const data = await kegiatanService.createActivityService(req.body, req.user?.lembaga);
        return res.status(201).json({ 
            success: true, 
            message: 'Agenda kegiatan berhasil didaftarkan!', 
            data 
        });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

export const editKegiatan = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    
    if (!activity_name || !activity_date) {
        return res.status(400).json({ 
            success: false, 
            message: 'Nama Kegiatan dan Tanggal Pelaksanaan tidak boleh kosong!' 
        });
    }

    const targetError = validateTargetPayload(req.body);
    if (targetError) {
        return res.status(400).json({ success: false, message: targetError });
    }

    try {
        const data = await kegiatanService.updateActivityService(req.params.id, req.body);
        return res.json({ 
            success: true, 
            message: 'Informasi kegiatan berhasil diperbarui!', 
            data 
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const removeKegiatan = async (req, res) => {
    try {
        await kegiatanService.deleteActivityService(req.params.id);
        return res.json({ 
            success: true, 
            message: 'Kegiatan berhasil dihapus dari sistem.' 
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Mengabsen Santri di Kegiatan
export const logKegiatanAttendance = async (req, res) => {
    // 1. Ambil payload dan perbaiki typo acaademic_year_id menjadi academic_year_id
    const { activity_id, nim, status, notes, bulan_hijriah, tahun_hijriah, academic_year_id, latitude, longitude, accuracy, tanggal_absensi } = req.body;

    // 2. Validasi data wajib di awal sebelum menembak database (Best Practice)
    if (!activity_id || !nim || !status) {
        return res.status(400).json({ 
            success: false, 
            message: 'ID Kegiatan, NIM Santri, dan Status Absen wajib diisi!' 
        });
    }

    try {
        // 3. Gunakan 'let' agar nilai jenjang_id bisa diubah secara dinamis
        let jenjang_id = null; 

        // Ambil data murid berdasarkan NIM (madrasah: murid_kelas, TPQ: santri_kelas, fallback: students)
        const jenjang = await muridKelasService.getSiswaByNimService(nim, academic_year_id, req.user?.lembaga);
        if (jenjang) {
            // Dukung beberapa penamaan kolom agar tahan banting
            jenjang_id = jenjang.jenjang_id || jenjang.id || null;
        } else {
            return res.status(404).json({ 
                success: false, 
                message: 'Santri dengan NIM tersebut tidak ditemukan pada tahun akademik aktif ini!' 
            });
        }

        // 4. Kirim data ke service utama untuk insert ke tabel absensi kegiatan
        // Disarankan menyusun ulang objeknya agar strukturnya bersih terprediksi
        const payloadData = {
            activity_id,
            nim,
            status,
            notes: notes || 'Presensi via system dashboard',
            bulan_hijriah,
            tahun_hijriah,
            academic_year_id,
            jenjang_id,
            classroom_id: jenjang?.classroom_id ?? null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            accuracy: accuracy ?? null,
            tanggal_absensi: tanggal_absensi ?? null
        };

        const data = await kegiatanService.logKegiatanAttendanceService(payloadData);
        
        return res.json({ 
            success: true, 
            message: 'Presensi kegiatan santri berhasil disimpan!', 
            data 
        });

    } catch (error) {
        console.error("Error pada logKegiatanAttendance:", error);
        // v3.6: guard target/jenjang melempar error berstatus (403/404) — teruskan apa adanya
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};
export const logKegiatan = async (req, res) => {
    const { activity_name, activity_date } = req.body;
    if (!activity_name || !activity_date) {
        return res.status(400).json({ success: false, message: 'Nama dan Tanggal Kegiatan wajib diisi!' });
    }

    try {
        const data = await kegiatanService.createActivityService(req.body);
        return res.json({ success: true, message: 'Presensi kegiatan santri berhasil disimpan!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Pengelompokan (Grouping) data santri berdasarkan Jenjang
const groupRekapJenjang = (rawData) => {
    const groupedData = {
        TPQ: [],
        Sifir: [],
        Ibtidaiyah: [],
        Tsanawiyah: [],
        Lainnya: [] // Antisipasi jika ada jenjang di luar kategori utama
    };

    // Looping untuk memisahkan data ke kelompok masing-masing
    rawData.forEach(student => {
        // Standardisasi pencocokan string nama kelas / nama jenjang (case-insensitive)
        const className = (student.class_name || '').toUpperCase();
        const jenjangName = (student.nama_jenjang || '').toUpperCase();

        if (className.includes('TPQ') || jenjangName.includes('TPQ')) {
            groupedData.TPQ.push(student);
        } else if (className.includes('SIFIR') || jenjangName.includes('SIFIR')) {
            groupedData.Sifir.push(student);
        } else if (className.includes('IBTIDAIYAH') || className.includes('MI') || jenjangName.includes('IBTIDAIYAH')) {
            groupedData.Ibtidaiyah.push(student);
        } else if (className.includes('TSANAWIYAH') || className.includes('MTS') || jenjangName.includes('TSANAWIYAH')) {
            groupedData.Tsanawiyah.push(student);
        } else {
            groupedData.Lainnya.push(student);
        }
    });

    return groupedData;
};

const formatRekapResponse = (rawData) => {
    const groupedData = groupRekapJenjang(rawData);

    return {
        success: true,
        total_all: rawData.length,
        // Statistik ringkas jumlah kehadiran per jenjang untuk dashboard info-box
        summary_count: {
            tpq: groupedData.TPQ.length,
            sifir: groupedData.Sifir.length,
            ibtidaiyah: groupedData.Ibtidaiyah.length,
            tsanawiyah: groupedData.Tsanawiyah.length,
            lainnya: groupedData.Lainnya.length
        },
        // Mengirimkan objek yang sudah terbagi rapi
        data: groupedData,
        // Opsional: Tetap kirim data flat mentah jika v-data-table frontend membutuhkannya secara langsung
        raw_data: rawData
    };
};

// Mengabsen Guru / Asatidz di Kegiatan
export const logKegiatanTeacherAttendance = async (req, res) => {
    const { kegiatan_id, teacher_id, status, notes, latitude, longitude, accuracy } = req.body;

    // Validasi data wajib
    if (!kegiatan_id || !teacher_id || !status) {
        return res.status(400).json({
            success: false,
            message: 'ID Kegiatan, ID Guru, dan Status Absen wajib diisi!'
        });
    }

    try {
        // Pastikan kegiatan & guru benar-benar ada di database
        const cekKegiatan = await db.execute({
            sql: "SELECT id FROM kegiatan WHERE id = ?",
            args: [kegiatan_id]
        });
        if (cekKegiatan.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Kegiatan tidak ditemukan!' });
        }

        const cekGuru = await db.execute({
            sql: "SELECT id FROM teachers WHERE id = ?",
            args: [teacher_id]
        });
        if (cekGuru.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Guru tidak ditemukan!' });
        }

        const data = await kegiatanService.logKegiatanTeacherAttendanceService(
            kegiatan_id,
            teacher_id,
            status,
            notes || 'Presensi via system',
            latitude ?? null,
            longitude ?? null,
            accuracy ?? null
        );

        return res.json({
            success: true,
            message: 'Presensi kehadiran guru berhasil disimpan!',
            data
        });
    } catch (error) {
        console.error("Error pada logKegiatanTeacherAttendance:", error);
        // v3.6: guard target peserta melempar error berstatus (403/404) — teruskan apa adanya
        if (error.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Melihat Rekap Kehadiran Guru di Kegiatan (roster lengkap guru)
export const getKegiatanTeacherReport = async (req, res) => {
    const kegiatan_id = req.params.activity_id || req.params.kegiatan_id || req.params.id;

    if (!kegiatan_id) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan wajib disertakan!' });
    }

    try {
        const rawData = await kegiatanService.getKegiatanTeacherReportService(kegiatan_id, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Rekap kehadiran guru berhasil dimuat.',
            total_all: rawData.length,
            data: rawData
        });
    } catch (error) {
        console.error("Error pada getKegiatanTeacherReport:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Riwayat absensi seorang guru di semua kegiatan
export const getTeacherAttendanceHistory = async (req, res) => {
    const teacherId = Number(req.params.teacher_id);

    if (!teacherId || !Number.isFinite(teacherId)) {
        return res.status(400).json({ success: false, message: 'ID Guru wajib disertakan!' });
    }

    // Guru hanya boleh melihat riwayatnya sendiri
    if (req.user?.role === 'teacher' && req.user.id !== teacherId) {
        return res.status(403).json({ success: false, message: 'Anda hanya dapat melihat riwayat absensi sendiri!' });
    }

    try {
        const rawData = await kegiatanService.getTeacherAttendanceHistoryService(teacherId, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Riwayat absensi guru berhasil dimuat.',
            total_all: rawData.length,
            data: rawData
        });
    } catch (error) {
        console.error("Error pada getTeacherAttendanceHistory:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Riwayat absensi kegiatan (istighosah) seorang murid
export const getStudentKegiatanHistory = async (req, res) => {
    const nim = (req.params.nim || '').toString().trim();

    if (!nim) {
        return res.status(400).json({ success: false, message: 'NIM murid wajib disertakan!' });
    }

    try {
        const rawData = await kegiatanService.getStudentKegiatanHistoryService(nim, req.user?.lembaga);
        return res.json({
            success: true,
            message: 'Riwayat absensi kegiatan murid berhasil dimuat.',
            total_all: rawData.length,
            data: rawData
        });
    } catch (error) {
        console.error("Error pada getStudentKegiatanHistory:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Melihat Rekap Kehadiran Acara / Live Log Scanner
export const getKegiatanReport = async (req, res) => {
    // Sesuai dengan route parameter frontend: /kegiatan/report/:id
    const kegiatan_id = req.params.activity_id || req.params.kegiatan_id || req.params.id;
    
    if (!kegiatan_id) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan wajib disertakan!' });
    }

    try {
        // 1. Ambil data mentah log absensi dari service database (mingguan: filter tanggal opsional ?tanggal=)
        const rawData = await kegiatanService.getKegiatanReportService(kegiatan_id, req.user?.lembaga, req.query.tanggal || null);
        
        // 2. Format respons dengan pengelompokan per jenjang
        return res.json(formatRekapResponse(rawData));

    } catch (error) {
        console.error("Error pada getKegiatanReport:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Rekap lengkap untuk Export PDF (membandingkan data hadir dengan data_murid & data_santri)
export const getKegiatanExportReport = async (req, res) => {
    const kegiatan_id = req.params.activity_id || req.params.kegiatan_id || req.params.id;

    if (!kegiatan_id) {
        return res.status(400).json({ success: false, message: 'ID Kegiatan wajib disertakan!' });
    }

    try {
        // 1. Ambil roster lengkap murid & santri + status kehadirannya (ALPA jika tanpa record)
        //    Mingguan: filter tanggal opsional ?tanggal= agar rekap per pekan akurat.
        const rawData = await kegiatanService.getKegiatanExportReportService(kegiatan_id, req.user?.lembaga, req.query.tanggal || null);

        // 2. Format respons dengan pengelompokan per jenjang
        return res.json(formatRekapResponse(rawData));

    } catch (error) {
        console.error("Error pada getKegiatanExportReport:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};