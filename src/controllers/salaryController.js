import {
    getSalaryTariffsService,
    upsertSalaryTariffService,
    deleteSalaryTariffService,
    getTeachersListService,
    computeTeacherSalaryService,
    computeAllTeachersSalaryService,
    getSalarySlipsService,
    getMySalarySlipsService,
    saveSalarySlipService,
    updateSalarySlipService,
    deleteSalarySlipService
} from '../services/salaryService.js';
import { getLembaga } from '../utils/lembagaHelper.js';

const lembaga = (req) => getLembaga(req);

// GET /api/salary/tariffs
export const getSalaryTariffs = async (req, res) => {
    try {
        const data = await getSalaryTariffsService(lembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET TARIF GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat tarif gaji' });
    }
};

// POST /api/salary/tariffs (upsert per jenjang)
export const upsertSalaryTariff = async (req, res) => {
    try {
        const result = await upsertSalaryTariffService(req.body, lembaga(req));
        return res.status(200).json({ success: true, data: result, message: 'Tarif gaji berhasil disimpan' });
    } catch (error) {
        console.error('EROR UPSERT TARIF GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan tarif gaji' });
    }
};

// DELETE /api/salary/tariffs/:id
export const deleteSalaryTariff = async (req, res) => {
    try {
        const ok = await deleteSalaryTariffService(req.params.id, lembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Tarif tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Tarif gaji berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE TARIF GAJI:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus tarif gaji' });
    }
};

// GET /api/salary/teachers — daftar guru untuk input slip
export const getSalaryTeachers = async (req, res) => {
    try {
        const data = await getTeachersListService(lembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET GURU GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat daftar guru' });
    }
};

// POST /api/salary/slips/compute — hitung jam mengajar & subtotal (preview)
export const computeSalarySlip = async (req, res) => {
    try {
        const { period, teacher_id, tanggal_mulai, tanggal_selesai } = req.body;
        const data = teacher_id
            ? await computeTeacherSalaryService({ teacherId: teacher_id, period, tanggal_mulai, tanggal_selesai }, lembaga(req))
            : await computeAllTeachersSalaryService({ period, tanggal_mulai, tanggal_selesai }, lembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR COMPUTE GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghitung gaji' });
    }
};

// GET /api/salary/slips
export const getSalarySlips = async (req, res) => {
    try {
        const data = await getSalarySlipsService(req.query, lembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET SLIP GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat slip gaji' });
    }
};

// POST /api/salary/slips — simpan slip (create/update per guru+periode)
export const saveSalarySlip = async (req, res) => {
    try {
        const result = await saveSalarySlipService(req.body, lembaga(req));
        return res.status(200).json({ success: true, data: result, message: 'Slip gaji berhasil disimpan' });
    } catch (error) {
        console.error('EROR SAVE SLIP GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan slip gaji' });
    }
};

// PUT /api/salary/slips/:id
export const updateSalarySlip = async (req, res) => {
    try {
        const ok = await updateSalarySlipService(req.params.id, req.body, lembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Slip gaji tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Slip gaji berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE SLIP GAJI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah slip gaji' });
    }
};

// DELETE /api/salary/slips/:id
export const deleteSalarySlip = async (req, res) => {
    try {
        const ok = await deleteSalarySlipService(req.params.id, lembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Slip gaji tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Slip gaji berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE SLIP GAJI:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus slip gaji' });
    }
};

// GET /api/salary/me — riwayat gaji guru sendiri (self-service)
export const getMySalarySlips = async (req, res) => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const period = req.query.period || null;
        const data = await getMySalarySlipsService(teacherId, { period });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET SLIP GAJI SAYA:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat riwayat gaji' });
    }
};
