import {
    getIzinSakitService,
    createIzinSakitService,
    updateIzinSakitService,
    deleteIzinSakitService
} from '../services/izinSakitService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/izin-sakit
export const getIzinSakit = async (req, res) => {
    try {
        const data = await getIzinSakitService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR DAFTAR IZIN/SAKIT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data izin/sakit' });
    }
};

// POST /api/izin-sakit
export const createIzinSakit = async (req, res) => {
    try {
        const { id } = await createIzinSakitService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, id, message: 'Catatan izin/sakit berhasil disimpan' });
    } catch (error) {
        console.error('EROR SIMPAN IZIN/SAKIT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan catatan izin/sakit' });
    }
};

// PUT /api/izin-sakit/:id
export const updateIzinSakit = async (req, res) => {
    try {
        const updated = await updateIzinSakitService(req.params.id, req.body, getLembaga(req), req.user?.name || null);
        if (!updated) return res.status(404).json({ success: false, message: 'Catatan izin/sakit tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Catatan izin/sakit berhasil diperbarui' });
    } catch (error) {
        console.error('EROR UBAH IZIN/SAKIT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memperbarui catatan izin/sakit' });
    }
};

// DELETE /api/izin-sakit/:id
export const deleteIzinSakit = async (req, res) => {
    try {
        const deleted = await deleteIzinSakitService(req.params.id, getLembaga(req));
        if (!deleted) return res.status(404).json({ success: false, message: 'Catatan izin/sakit tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Catatan izin/sakit berhasil dihapus' });
    } catch (error) {
        console.error('EROR HAPUS IZIN/SAKIT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghapus catatan izin/sakit' });
    }
};
