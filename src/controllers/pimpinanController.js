import {
    getPimpinanService,
    createPimpinanService,
    updatePimpinanService,
    deletePimpinanService,
    getPiketPimpinanService,
    assignPiketPimpinanService,
    removePiketPimpinanService,
    getPresensiPimpinanService,
    savePresensiPimpinanService,
    getPresensiPimpinanHistoryService,
    HARI_PIKET
} from '../services/pimpinanService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// GET /api/pimpinan
export const getPimpinan = async (req, res) => {
    try {
        const data = await getPimpinanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data pimpinan' });
    }
};

// POST /api/pimpinan
export const createPimpinan = async (req, res) => {
    try {
        const result = await createPimpinanService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Pimpinan berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan pimpinan' });
    }
};

// PUT /api/pimpinan/:id
export const updatePimpinan = async (req, res) => {
    try {
        await updatePimpinanService(req.params.id, req.body, getLembaga(req));
        return res.status(200).json({ success: true, message: 'Pimpinan berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE PIMPINAN:', error);
        const status = error.message === 'Pimpinan tidak ditemukan' ? 404 : 400;
        return res.status(status).json({ success: false, message: error.message || 'Gagal mengubah pimpinan' });
    }
};

// DELETE /api/pimpinan/:id
export const deletePimpinan = async (req, res) => {
    try {
        const ok = await deletePimpinanService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Pimpinan tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Pimpinan berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE PIMPINAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus pimpinan' });
    }
};

// GET /api/piket-pimpinan
export const getPiketPimpinan = async (req, res) => {
    try {
        const data = await getPiketPimpinanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PIKET PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat jadwal piket pimpinan' });
    }
};

// POST /api/piket-pimpinan
export const assignPiketPimpinan = async (req, res) => {
    try {
        const result = await assignPiketPimpinanService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Piket pimpinan ditambahkan' });
    } catch (error) {
        console.error('EROR ASSIGN PIKET PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan piket' });
    }
};

// DELETE /api/piket-pimpinan/:id
export const removePiketPimpinan = async (req, res) => {
    try {
        const ok = await removePiketPimpinanService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Jadwal piket tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Jadwal piket dihapus' });
    } catch (error) {
        console.error('EROR REMOVE PIKET PIMPINAN:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus jadwal piket' });
    }
};

export { HARI_PIKET };

// GET /api/piket-pimpinan/presensi?tanggal=YYYY-MM-DD
export const getPresensiPimpinan = async (req, res) => {
    try {
        const data = await getPresensiPimpinanService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PRESENSI PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat presensi pimpinan' });
    }
};

// POST /api/piket-pimpinan/presensi — simpan presensi massal {tanggal, items:[{pimpinan_id,status,keterangan}]}
export const savePresensiPimpinan = async (req, res) => {
    try {
        const result = await savePresensiPimpinanService(req.body, getLembaga(req));
        return res.status(200).json({ success: true, data: result, message: 'Presensi pimpinan disimpan' });
    } catch (error) {
        console.error('EROR SAVE PRESENSI PIMPINAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan presensi pimpinan' });
    }
};

// GET /api/piket-pimpinan/presensi/history
export const getPresensiPimpinanHistory = async (req, res) => {
    try {
        const data = await getPresensiPimpinanHistoryService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET PRESENSI PIMPINAN HISTORY:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat riwayat presensi pimpinan' });
    }
};