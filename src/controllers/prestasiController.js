import {
    getPrestasiPelanggaranService,
    createPrestasiPelanggaranService,
    updatePrestasiPelanggaranService,
    deletePrestasiPelanggaranService,
    TIPE_PRESTASI,
    KATEGORI_PRESTASI,
    KATEGORI_PELANGGARAN
} from '../services/prestasiService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/prestasi-pelanggaran
export const getPrestasiPelanggaran = async (req, res) => {
    try {
        const data = await getPrestasiPelanggaranService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PRESTASI & PELANGGARAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data prestasi & pelanggaran' });
    }
};

// POST /api/prestasi-pelanggaran
export const createPrestasiPelanggaran = async (req, res) => {
    try {
        const result = await createPrestasiPelanggaranService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Catatan prestasi/pelanggaran berhasil disimpan' });
    } catch (error) {
        console.error('EROR CREATE PRESTASI & PELANGGARAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan catatan prestasi/pelanggaran' });
    }
};

// PUT /api/prestasi-pelanggaran/:id
export const updatePrestasiPelanggaran = async (req, res) => {
    try {
        const ok = await updatePrestasiPelanggaranService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data prestasi/pelanggaran tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data prestasi/pelanggaran berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE PRESTASI & PELANGGARAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah data prestasi/pelanggaran' });
    }
};

// DELETE /api/prestasi-pelanggaran/:id
export const deletePrestasiPelanggaran = async (req, res) => {
    try {
        const ok = await deletePrestasiPelanggaranService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Data prestasi/pelanggaran tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Data prestasi/pelanggaran berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE PRESTASI & PELANGGARAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus data prestasi/pelanggaran' });
    }
};

export { TIPE_PRESTASI, KATEGORI_PRESTASI, KATEGORI_PELANGGARAN };
