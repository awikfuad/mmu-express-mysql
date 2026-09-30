import {
    getArsipSoalanService,
    createArsipSoalanService,
    updateArsipSoalanService,
    deleteArsipSoalanService,
    IMDA_AR_SIP
} from '../services/arsipSoalanService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/arsip-soalan
export const getArsipSoalan = async (req, res) => {
    try {
        const data = await getArsipSoalanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET ARSIP SOALAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat arsip soal' });
    }
};

// POST /api/arsip-soalan — uploadPdf.single('file')
export const createArsipSoalan = async (req, res) => {
    try {
        const result = await createArsipSoalanService(req.body, req.file || null, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Arsip soal berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE ARSIP SOALAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan arsip soal' });
    }
};

// PUT /api/arsip-soalan/:id — uploadPdf.single('file') opsional
export const updateArsipSoalan = async (req, res) => {
    try {
        const ok = await updateArsipSoalanService(req.params.id, req.body, req.file || null, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Arsip soal tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Arsip soal berhasil diubah' });
    } catch (error) {
        if (error.message === 'NOT_FOUND') return res.status(404).json({ success: false, message: 'Arsip soal tidak ditemukan' });
        console.error('EROR UPDATE ARSIP SOALAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah arsip soal' });
    }
};

// DELETE /api/arsip-soalan/:id
export const deleteArsipSoalan = async (req, res) => {
    try {
        const ok = await deleteArsipSoalanService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Arsip soal tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Arsip soal berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE ARSIP SOALAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus arsip soal' });
    }
};

export { IMDA_AR_SIP };