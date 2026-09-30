import {
    getBankSoalService,
    createBankSoalService,
    updateBankSoalService,
    deleteBankSoalService,
    getUjianService,
    getUjianDetailService,
    createUjianService,
    updateUjianService,
    deleteUjianService,
    setUjianSoalService,
    getUjianPesertaService,
    addUjianPesertaService,
    removeUjianPesertaService,
    gradeUjianPesertaService,
    startUjianService,
    submitUjianService,
    saveUjianService,
    buildBankSoalTemplateService,
    previewImportBankSoalService,
    commitImportBankSoalService,
    TIPE_SOAL,
    JENIS_UJIAN,
    MODE_UJIAN,
    STATUS_UJIAN,
    STATUS_PESERTA
} from '../services/ujianService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();
const getActor = (req) => (req.user?.name || req.user?.username || '');

// ============ BANK SOAL ============

export const getBankSoal = async (req, res) => {
    try {
        const data = await getBankSoalService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat bank soal' });
    }
};

export const createBankSoal = async (req, res) => {
    try {
        const result = await createBankSoalService(req.body, getLembaga(req), getActor(req));
        return res.status(201).json({ success: true, data: result, message: 'Soal berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan soal' });
    }
};

export const updateBankSoal = async (req, res) => {
    try {
        const ok = await updateBankSoalService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Soal berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah soal' });
    }
};

export const deleteBankSoal = async (req, res) => {
    try {
        const ok = await deleteBankSoalService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Soal tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Soal berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE BANK SOAL:', error.message);
        return res.status(500).json({ success: false, message: 'Gagal menghapus soal' });
    }
};

export const downloadBankSoalTemplate = async (req, res) => {
    try {
        const buffer = buildBankSoalTemplateService();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="template-bank-soal.xlsx"');
        return res.send(buffer);
    } catch (error) {
        console.error('EROR TEMPLATE BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal membuat template' });
    }
};

export const previewImportBankSoal = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel wajib diunggah' });
        const data = await previewImportBankSoalService(req.file.buffer, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR PREVIEW BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal membaca file soal' });
    }
};

export const commitImportBankSoal = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File Excel wajib diunggah' });
        const rowIndices = Array.isArray(req.body.row_indices)
            ? req.body.row_indices.map((n) => Number(n))
            : null;
        const data = await commitImportBankSoalService(req.file.buffer, getLembaga(req), rowIndices);
        return res.status(200).json({ success: true, data, message: `${data.imported ?? 0} soal berhasil diimport` });
    } catch (error) {
        console.error('EROR COMMIT IMPORT BANK SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengimport soal' });
    }
};

// ============ UJIAN ============

export const getUjian = async (req, res) => {
    try {
        const data = await getUjianService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat ujian' });
    }
};

export const getUjianDetail = async (req, res) => {
    try {
        const data = await getUjianDetailService(req.params.id, getLembaga(req));
        if (!data) return res.status(404).json({ success: false, message: 'Ujian tidak ditemukan' });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET UJIAN DETAIL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat detail ujian' });
    }
};

export const createUjian = async (req, res) => {
    try {
        const result = await createUjianService(req.body, getLembaga(req), getActor(req));
        return res.status(201).json({ success: true, data: result, message: 'Ujian berhasil dibuat' });
    } catch (error) {
        console.error('EROR CREATE UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal membuat ujian' });
    }
};

export const updateUjian = async (req, res) => {
    try {
        const ok = await updateUjianService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Ujian tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Ujian berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah ujian' });
    }
};

export const deleteUjian = async (req, res) => {
    try {
        const ok = await deleteUjianService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Ujian tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Ujian berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE UJIAN:', error.message);
        return res.status(500).json({ success: false, message: 'Gagal menghapus ujian' });
    }
};

export const setUjianSoal = async (req, res) => {
    try {
        const result = await setUjianSoalService(req.params.id, req.body.soal_ids, getLembaga(req));
        return res.status(200).json({ success: true, data: result, message: 'Daftar soal ujian disimpan' });
    } catch (error) {
        console.error('EROR SET UJIAN SOAL:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan soal ujian' });
    }
};

export const getUjianPeserta = async (req, res) => {
    try {
        const data = await getUjianPesertaService(req.params.id, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET UJIAN PESERTA:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat peserta ujian' });
    }
};

export const addUjianPeserta = async (req, res) => {
    try {
        const result = await addUjianPesertaService(req.params.id, req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Peserta ujian ditambahkan' });
    } catch (error) {
        console.error('EROR ADD UJIAN PESERTA:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan peserta' });
    }
};

export const removeUjianPeserta = async (req, res) => {
    try {
        const ok = await removeUjianPesertaService(req.params.id, req.params.pesertaId, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Peserta dihapus' });
    } catch (error) {
        console.error('EROR REMOVE UJIAN PESERTA:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghapus peserta' });
    }
};

export const gradeUjianPeserta = async (req, res) => {
    try {
        const ok = await gradeUjianPesertaService(req.params.id, req.params.pesertaId, req.body, getLembaga(req), getActor(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Nilai berhasil disimpan' });
    } catch (error) {
        console.error('EROR GRADE UJIAN PESERTA:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan nilai' });
    }
};

// ============ CBT ONLINE (publik) ============

export const startUjian = async (req, res) => {
    try {
        const data = await startUjianService(req.body);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR START UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memulai ujian' });
    }
};

export const submitUjian = async (req, res) => {
    try {
        const data = await submitUjianService(req.body);
        return res.status(200).json({ success: true, data, message: 'Jawaban berhasil dikumpulkan' });
    } catch (error) {
        console.error('EROR SUBMIT UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengumpulkan jawaban' });
    }
};

export const saveUjian = async (req, res) => {
    try {
        const data = await saveUjianService(req.body);
        return res.status(200).json({ success: true, data, message: 'Jawaban tersimpan' });
    } catch (error) {
        console.error('EROR SAVE UJIAN:', error.message);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan jawaban' });
    }
};

export { TIPE_SOAL, JENIS_UJIAN, MODE_UJIAN, STATUS_UJIAN, STATUS_PESERTA };