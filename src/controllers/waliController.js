import {
    getWaliService,
    createWaliService,
    updateWaliService,
    deleteWaliService
} from '../services/waliService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/wali
export const getWali = async (req, res) => {
    try {
        const data = await getWaliService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET WALI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data wali' });
    }
};

// POST /api/wali
export const createWali = async (req, res) => {
    try {
        const result = await createWaliService(req.body, getLembaga(req));
        const message = result.updated ? 'Data wali berhasil diperbarui' : 'Data wali berhasil ditambahkan';
        return res.status(201).json({ success: true, data: result, message });
    } catch (error) {
        console.error('EROR CREATE WALI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan data wali' });
    }
};

// PUT /api/wali/:id
export const updateWali = async (req, res) => {
    try {
        const ok = await updateWaliService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data wali tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data wali berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE WALI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah data wali' });
    }
};

// DELETE /api/wali/:id
export const deleteWali = async (req, res) => {
    try {
        const ok = await deleteWaliService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data wali tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data wali berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE WALI:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus data wali' });
    }
};
