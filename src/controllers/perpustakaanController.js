import {
    getKatalogService,
    getBukuOptionsService,
    createKatalogService,
    updateKatalogService,
    deleteKatalogService,
    getSirkulasiService,
    createSirkulasiService,
    updateSirkulasiService,
    kembalikanService,
    deleteSirkulasiService,
    getDendaService,
    bayarDendaService,
    getPerpusSettingsService,
    updatePerpusSettingsService,
    KATEGORI_BUKU,
    ANGGOTA_TYPE,
    STATUS_SIRKULASI,
    STATUS_DENDA
} from '../services/perpustakaanService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();

// ==================== KATALOG BUKU / KITAB ====================

// GET /api/perpustakaan/katalog
export const getKatalog = async (req, res) => {
    try {
        const result = await getKatalogService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data: result.data, summary: result.summary });
    } catch (error) {
        console.error('EROR GET KATALOG BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat katalog buku' });
    }
};

// GET /api/perpustakaan/katalog/options
export const getBukuOptions = async (req, res) => {
    try {
        const data = await getBukuOptionsService(getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET OPSI BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat opsi buku' });
    }
};

// POST /api/perpustakaan/katalog
export const createKatalog = async (req, res) => {
    try {
        const result = await createKatalogService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Buku berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE KATALOG BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan buku' });
    }
};

// PUT /api/perpustakaan/katalog/:id
export const updateKatalog = async (req, res) => {
    try {
        const ok = await updateKatalogService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Buku tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Buku berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE KATALOG BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah buku' });
    }
};

// DELETE /api/perpustakaan/katalog/:id
export const deleteKatalog = async (req, res) => {
    try {
        const ok = await deleteKatalogService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Buku tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Buku berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE KATALOG BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghapus buku' });
    }
};

// ==================== SIRKULASI PEMINJAMAN & PENGEMBALIAN ====================

// GET /api/perpustakaan/sirkulasi
export const getSirkulasi = async (req, res) => {
    try {
        const result = await getSirkulasiService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data: result.data, summary: result.summary });
    } catch (error) {
        console.error('EROR GET SIRKULASI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data sirkulasi' });
    }
};

// POST /api/perpustakaan/sirkulasi
export const createSirkulasi = async (req, res) => {
    try {
        const result = await createSirkulasiService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data: result, message: 'Peminjaman berhasil dicatat' });
    } catch (error) {
        console.error('EROR CREATE SIRKULASI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mencatat peminjaman' });
    }
};

// PUT /api/perpustakaan/sirkulasi/:id
export const updateSirkulasi = async (req, res) => {
    try {
        const ok = await updateSirkulasiService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Peminjaman tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Peminjaman berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE SIRKULASI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah peminjaman' });
    }
};

// POST /api/perpustakaan/sirkulasi/:id/kembalikan
export const kembalikan = async (req, res) => {
    try {
        const result = await kembalikanService(req.params.id, req.body, getLembaga(req));
        let message = 'Buku berhasil dikembalikan';
        if (result.denda) message = `Buku dikembalikan. Denda ${result.denda.jumlah_hari} hari x Rp ${result.denda.tarif_per_hari} = Rp ${result.denda.total}`;
        return res.status(200).json({ success: true, data: result, message });
    } catch (error) {
        console.error('EROR KEMBALIKAN BUKU:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengembalikan buku' });
    }
};

// DELETE /api/perpustakaan/sirkulasi/:id
export const deleteSirkulasi = async (req, res) => {
    try {
        const ok = await deleteSirkulasiService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Peminjaman tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Peminjaman berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE SIRKULASI:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghapus peminjaman' });
    }
};

// ==================== DENDA & KETERLAMBATAN ====================

// GET /api/perpustakaan/denda
export const getDenda = async (req, res) => {
    try {
        const result = await getDendaService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data: result.data, summary: result.summary });
    } catch (error) {
        console.error('EROR GET DENDA:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat data denda' });
    }
};

// PUT /api/perpustakaan/denda/:id/bayar
export const bayarDenda = async (req, res) => {
    try {
        const ok = await bayarDendaService(req.params.id, req.body, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Denda tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Denda berhasil dilunasi' });
    } catch (error) {
        console.error('EROR BAYAR DENDA:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal melunasi denda' });
    }
};

// ==================== SETTING PERPUSTAKAAN ====================

// GET /api/perpustakaan/settings
export const getPerpusSettings = async (req, res) => {
    try {
        const data = await getPerpusSettingsService(getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET SETTING PERPUSTAKAAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal memuat setting perpustakaan' });
    }
};

// PUT /api/perpustakaan/settings
export const updatePerpusSettings = async (req, res) => {
    try {
        const data = await updatePerpusSettingsService(req.body, getLembaga(req));
        return res.status(200).json({ success: true, data, message: 'Setting perpustakaan berhasil disimpan' });
    } catch (error) {
        console.error('EROR UPDATE SETTING PERPUSTAKAAN:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menyimpan setting perpustakaan' });
    }
};

export { KATEGORI_BUKU, ANGGOTA_TYPE, STATUS_SIRKULASI, STATUS_DENDA };