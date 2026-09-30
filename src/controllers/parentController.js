import * as parentService from '../services/parentService.js';

// ============================================================================
// Portal Orang Tua — controller
// ============================================================================

// Profil parent
export const getParentMe = async (req, res) => {
    try {
        const data = await parentService.getParentMeService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Daftar anak
export const getParentChildren = async (req, res) => {
    try {
        const data = await parentService.getParentChildrenService(req.user.id);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Profil detail anak
export const getParentChildProfile = async (req, res) => {
    try {
        const data = await parentService.getParentChildProfileService(req.user.id, req.params.nim);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Absensi KBM anak
export const getParentChildKbm = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildKbmService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Absensi kegiatan anak
export const getParentChildKegiatan = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildKegiatanService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Nilai harian anak
export const getParentChildNilai = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildNilaiService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Perilaku anak
export const getParentChildPerilaku = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildPerilakuService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Prestasi & pelanggaran anak
export const getParentChildPrestasi = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildPrestasiService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Jadwal pelajaran anak
export const getParentChildJadwal = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildJadwalService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat pembayaran anak
export const getParentChildPembayaran = async (req, res) => {
    try {
        const ayid = req.query.academic_year_id ? Number(req.query.academic_year_id) : undefined;
        const data = await parentService.getParentChildPembayaranService(req.user.id, req.params.nim, ayid);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Saldo tabungan anak
export const getParentChildTabungan = async (req, res) => {
    try {
        const data = await parentService.getParentChildTabunganService(req.user.id, req.params.nim);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Bayar iuran anak dari saldo tabungan (atomik)
export const payChildFromSavings = async (req, res) => {
    const { payment_type, month, amount } = req.body;
    if (!payment_type || !amount) {
        return res.status(400).json({ success: false, message: 'Jenis pembayaran dan nominal wajib diisi' });
    }
    try {
        const data = await parentService.payChildFromSavingsService(req.user.id, req.params.nim, { payment_type, month, amount });
        return res.status(201).json({ success: true, message: 'Pembayaran berhasil dari saldo tabungan anak!', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Riwayat izin/sakit anak
export const getParentChildIzinSakit = async (req, res) => {
    try {
        const data = await parentService.getParentChildIzinSakitService(req.user.id, req.params.nim);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Ajukan izin/sakit baru
export const submitChildIzinSakit = async (req, res) => {
    const { jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan } = req.body;
    if (!jenis || !alasan || !tanggal_mulai || !tanggal_selesai) {
        return res.status(400).json({ success: false, message: 'Jenis, alasan, tanggal mulai, dan tanggal selesai wajib diisi' });
    }
    try {
        const data = await parentService.submitChildIzinSakitService(req.user.id, req.params.nim, { jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan });
        return res.status(201).json({ success: true, message: 'Pengajuan izin/sakit berhasil dikirim!', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// ─── Pengajuan Pembayaran dari Tabungan (orang tua) ───

export const submitPaymentRequest = async (req, res) => {
    const { payment_type, month, amount } = req.body;
    if (!payment_type || !amount) {
        return res.status(400).json({ success: false, message: 'Jenis pembayaran dan nominal wajib diisi' });
    }
    try {
        const data = await parentService.submitPaymentRequestService(req.user.id, req.params.nim, { payment_type, month, amount });
        return res.status(201).json({ success: true, message: 'Pengajuan pembayaran berhasil dikirim! Menunggu persetujuan admin.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const getParentChildPaymentRequests = async (req, res) => {
    try {
        const data = await parentService.getParentChildPaymentRequestsService(req.user.id, req.params.nim);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// ─── Admin: Pengajuan Pembayaran ───

export const getPaymentRequests = async (req, res) => {
    try {
        const lembaga = (req.user.lembaga || 'ALL').toUpperCase();
        const data = await parentService.getPaymentRequestsService(lembaga, req.query);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const approvePaymentRequest = async (req, res) => {
    try {
        const data = await parentService.approvePaymentRequestService(req.params.id, req.user.name || 'Admin');
        return res.json({ success: true, message: 'Pengajuan disetujui! Pembayaran telah dieksekusi.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const rejectPaymentRequest = async (req, res) => {
    try {
        const { admin_notes } = req.body || {};
        const data = await parentService.rejectPaymentRequestService(req.params.id, req.user.name || 'Admin', admin_notes);
        return res.json({ success: true, message: 'Pengajuan ditolak.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// ============================================================================
// Admin CRUD — Kelola akun parent
// ============================================================================

export const getParents = async (req, res) => {
    try {
        const lembaga = req.user.lembaga || 'ALL';
        const data = await parentService.getParentsService(lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const createParent = async (req, res) => {
    try {
        const { phone, password, name, lembaga, children } = req.body;
        if (!phone || !password || !name) {
            return res.status(400).json({ success: false, message: 'No HP, password, dan nama wajib diisi' });
        }
        const data = await parentService.createParentService({ phone, password, name, lembaga, children });
        return res.status(201).json({ success: true, message: 'Akun orang tua berhasil dibuat', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const updateParent = async (req, res) => {
    try {
        const data = await parentService.updateParentService(req.params.id, req.body);
        return res.json({ success: true, message: 'Akun orang tua berhasil diubah', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const deleteParent = async (req, res) => {
    try {
        await parentService.deleteParentService(req.params.id);
        return res.json({ success: true, message: 'Akun orang tua berhasil dihapus' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const addChildLink = async (req, res) => {
    try {
        const { nim, sumber, hubungan } = req.body;
        if (!nim) return res.status(400).json({ success: false, message: 'NIM anak wajib diisi' });
        const data = await parentService.addChildLinkService(req.params.id, { nim, sumber, hubungan });
        return res.status(201).json({ success: true, message: 'Anak berhasil dihubungkan', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const removeChildLink = async (req, res) => {
    try {
        await parentService.removeChildLinkService(req.params.id, req.params.linkId);
        return res.json({ success: true, message: 'Link anak berhasil dihapus' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// ─── Keluarga berbasis KK (virtual grouping) ───

export const previewFamilyByKK = async (req, res) => {
    try {
        const { nim, sumber } = req.query;
        if (!nim) return res.status(400).json({ success: false, message: 'Parameter nim wajib diisi' });
        const data = await parentService.previewFamilyByNimService(nim, sumber || null);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

export const linkFamilyByKK = async (req, res) => {
    try {
        const { nim, sumber, hubungan } = req.body || {};
        if (!nim) return res.status(400).json({ success: false, message: 'NIM acuan keluarga wajib diisi' });
        const data = await parentService.linkFamilyByKKService(req.params.id, { nim, sumber, hubungan });
        return res.json({ success: true, message: `Berhasil menghubungkan ${data.linked} anak dari ${data.total} anggota keluarga (KK ${data.kk}). ${data.alreadyLinked} sudah terhubung sebelumnya.`, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
