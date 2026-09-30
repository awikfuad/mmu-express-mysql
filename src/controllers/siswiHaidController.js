import * as siswiHaidService from '../services/siswiHaidService.js';

export const getAllSiswiHaid = async (req, res) => {
    try {
        const data = await siswiHaidService.getAllSiswiHaidService(req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Gagal mengambil data siswi haid: " + error.message });
    }
};

export const getSiswiHaidById = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await siswiHaidService.getSiswiHaidByIdService(id, req.user?.lembaga);
        if (!data) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const addSiswiHaid = async (req, res) => {
    const { nim, nama, kelas, adat, tanggal_mulai_haid } = req.body;
    if (!nim || !nama || !kelas || !adat || !tanggal_mulai_haid) {
        return res.status(400).json({ success: false, message: 'Semua kolom wajib diisi!' });
    }
    try {
        const data = await siswiHaidService.createSiswiHaidService(req.body);
        return res.status(201).json({ success: true, message: 'Data siswi haid berhasil ditambahkan!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const editSiswiHaid = async (req, res) => {
    const { id } = req.params;
    try {
        const data = await siswiHaidService.updateSiswiHaidService(id, req.body);
        return res.json({ success: true, message: 'Data siswi haid berhasil diperbarui!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const removeSiswiHaid = async (req, res) => {
    const { id } = req.params;
    try {
        await siswiHaidService.deleteSiswiHaidService(id);
        return res.json({ success: true, message: 'Data siswi haid berhasil dihapus.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
