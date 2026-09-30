import * as studentPortalService from '../services/studentPortalService.js';

// Profil santri + info akun (dipakai dashboard mobile santri)
export const getStudentMe = async (req, res) => {
    try {
        const data = await studentPortalService.getStudentMeService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat pembayaran santri
export const getStudentMePayments = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentPaymentsService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Saldo + mutasi tabungan santri
export const getStudentMeSavings = async (req, res) => {
    try {
        const data = await studentPortalService.getStudentSavingsService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Bayar iuran dari saldo tabungan
export const payFromSavings = async (req, res) => {
    const { payment_type, month, amount } = req.body;
    if (!payment_type || !amount) {
        return res.status(400).json({ success: false, message: 'Jenis pembayaran dan nominal wajib diisi!' });
    }
    try {
        const data = await studentPortalService.payFromSavingsService(req.user.id, { payment_type, month, amount });
        return res.status(201).json({
            success: true,
            message: 'Pembayaran berhasil dipotong dari saldo tabungan!',
            data
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat absensi KBM santri
export const getStudentMeKbm = async (req, res) => {
    try {
        const data = await studentPortalService.getStudentKbmService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat absensi kegiatan santri
export const getStudentMeKegiatan = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentKegiatanService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// ============================================================================
// C.10 — Portal Santri Mobile: data akademik milik santri sendiri
// ============================================================================

// Nilai harian santri
export const getStudentMeNilaiHarian = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentNilaiHarianService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Perilaku santri (3 aspek)
export const getStudentMePerilaku = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentPerilakuService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Prestasi & pelanggaran santri
export const getStudentMePrestasi = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentPrestasiService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Jadwal pelajaran kelas santri
export const getStudentMeJadwal = async (req, res) => {
    try {
        const academicYearId = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await studentPortalService.getStudentJadwalService(req.user.id, academicYearId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Kalender pendidikan lembaga santri
export const getStudentMeKalender = async (req, res) => {
    try {
        const data = await studentPortalService.getStudentKalenderService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Ujian / CBT (ONLINE & TERBIT) milik santri
export const getStudentMeUjian = async (req, res) => {
    try {
        const data = await studentPortalService.getStudentUjianListService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
