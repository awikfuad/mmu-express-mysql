import {
    getInventarisService,
    createInventarisService,
    updateInventarisService,
    deleteInventarisService,
    KATEGORI_INVENTARIS,
    KONDISI_INVENTARIS
} from '../services/inventarisService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/inventaris
export const getInventaris = async (req, res) => {
    try {
        const data = await getInventarisService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET INVENTARIS:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data inventaris' });
    }
};

// POST /api/inventaris
export const createInventaris = async (req, res) => {
    try {
        const result = await createInventarisService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Aset berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE INVENTARIS:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan aset' });
    }
};

// PUT /api/inventaris/:id
export const updateInventaris = async (req, res) => {
    try {
        const ok = await updateInventarisService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Aset tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Aset berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE INVENTARIS:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah aset' });
    }
};

// DELETE /api/inventaris/:id
export const deleteInventaris = async (req, res) => {
    try {
        const ok = await deleteInventarisService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Aset tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Aset berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE INVENTARIS:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus aset' });
    }
};

export { KATEGORI_INVENTARIS, KONDISI_INVENTARIS };
