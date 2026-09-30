import { getAllLembagaService, createLembagaService, updateLembagaService, deleteLembagaService } from '../services/lembagaService.js';

const isSuperAdmin = (req) => ((req.user?.lembaga || 'ALL').toUpperCase() === 'ALL');

// GET /api/lembaga — daftar master lembaga (admin/teacher).
export const getLembagas = async (req, res) => {
    try {
        const data = await getAllLembagaService(req.query);
        return res.status(200).json({ success: true, message: 'Berhasil memuat daftar lembaga', data });
    } catch (error) {
        console.error('LOG EROR GET LEMBAGA:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar lembaga karena gangguan server internal' });
    }
};

// GET /api/public/lembaga — daftar master lembaga UTK KIOSK (tanpa token).
// Hanya field publik (id, kode, nama, sumber, aktif) — cukup utk dropdown pilih
// lembaga di Dashboard Harian Publik tanpa membuat kiosk kena 401/terlempar ke login.
export const getPublicLembagas = async (req, res) => {
    try {
        const data = await getAllLembagaService(req.query);
        const safe = (data || []).map((l) => ({
            id: Number(l.id),
            kode: l.kode,
            nama: l.nama,
            sumber: l.sumber || '',
            aktif: Number(l.aktif) === 1
        }));
        return res.status(200).json({ success: true, data: safe });
    } catch (error) {
        console.error('LOG EROR GET PUBLIC LEMBAGA:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar lembaga karena gangguan server internal' });
    }
};

// POST /api/lembaga — tambah lembaga (hanya Super Admin).
export const createLembaga = async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat menambah lembaga.' });
    }
    try {
        const id = await createLembagaService(req.body);
        return res.status(200).json({ success: true, message: 'Lembaga berhasil ditambahkan.', id });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// PUT /api/lembaga/:id — ubah lembaga (hanya Super Admin).
export const updateLembaga = async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat mengubah lembaga.' });
    }
    try {
        await updateLembagaService(req.params.id, req.body);
        return res.status(200).json({ success: true, message: 'Lembaga berhasil diubah.' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// DELETE /api/lembaga/:id — hapus lembaga (hanya Super Admin).
export const removeLembaga = async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat menghapus lembaga.' });
    }
    try {
        await deleteLembagaService(req.params.id);
        return res.status(200).json({ success: true, message: 'Lembaga berhasil dihapus.' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};