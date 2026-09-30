import * as muridKelasService from '../services/muridKelasService.js';
import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { saveLocalUpload } from '../config/upload.js';

export const getMuridKelas = async (req, res) => {
    try {
        const data = await muridKelasService.getAllMuridKelasService(req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getMuridPerempuan = async (req, res) => {
    try {
        const rawData = await muridKelasService.getAllMuridKelasService(req.user?.lembaga);
        
        // Memfilter data murid perempuan (mencakup 'P', 'PEREMPUAN', atau 'p')
        const data = rawData.filter((murid) => {
            if (!murid.jenis_kelamin) return false;
            const jk = String(murid.jenis_kelamin).toUpperCase().trim();
            return jk === 'P' || jk === 'PEREMPUAN';
        });

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getMuridKelasByNim = async (req, res) => {
    const { nim } = req.params;
    const { academic_year_id } = req.query;
    try {
        const data = await muridKelasService.getMuridKelasByNimService(nim, academic_year_id, req.user?.lembaga);
        if (!data) {
            return res.status(404).json({ success: false, message: 'Santri tidak ditemukan' });
        }
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const addMuridKelas = async (req, res) => {
    const { nim, name } = req.body;
    if (!nim || !name) {
        return res.status(400).json({ success: false, message: 'NIM dan Nama Santri wajib diisi!' });
    }

    try {
        let fotoPath = req.body.foto || null;
        if (req.file) {
            fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-santri');
        }
        const payload = { ...req.body, ...(fotoPath ? { foto: fotoPath } : {}) };
        const data = await muridKelasService.createMuridKelasService(payload, req.user?.lembaga);
        return res.status(201).json({ success: true, message: 'Santri berhasil ditambahkan!', data });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, message: 'NIM sudah terdaftar di sistem!' });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const editMuridKelas = async (req, res) => {
    try {
        let fotoPath = req.body.foto;
        if (req.file) {
            fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-santri');
        }
        const payload = { ...req.body, ...(fotoPath !== undefined ? { foto: fotoPath } : {}) };
        if (req.file && fotoPath) payload.foto = fotoPath;
        const data = await muridKelasService.updateMuridKelasService(req.params.id, payload, req.user?.lembaga);
        return res.json({ success: true, message: 'Data santri berhasil diperbarui!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateStatusMuridKelas = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (status !== 0 && status !== 1 && status !== '0' && status !== '1') {
            return res.status(400).json({
                success: false,
                message: "Status tidak valid! Hanya menerima nilai 1 (Aktif) atau 0 (Tidak Aktif)."
            });
        }

        const s = getSumber(req.user?.lembaga);
        const scopedClause = s.isAll ? '' : ' AND LOWER(sumber) = LOWER(?)';
        const scopedArgs = s.isAll ? [] : [s.sumber];
        const sql = `UPDATE ${s.santriTable} SET status = ? WHERE id = ?${scopedClause}`;
        
        const result = await db.execute({
            sql: sql,
            args: [Number(status), id, ...scopedArgs]
        });

        if (result.rowsAffected === 0) {
            return res.status(404).json({
                success: false,
                message: `Santri dengan ID ${id} tidak ditemukan.`
            });
        }

        return res.status(200).json({
            success: true,
            message: `Status santri berhasil diubah menjadi ${Number(status) === 1 ? 'Aktif' : 'Tidak Aktif'}.`
        });

    } catch (error) {
        console.error("Error pada updateStatus Controller:", error);
        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan internal pada server.",
            error: error.message
        });
    }
};

export const removeStudent = async (req, res) => {
    try {
        await muridKelasService.deleteMuridKelasService(req.params.id, req.user?.lembaga);
        return res.json({ success: true, message: 'Santri berhasil dihapus dari sistem.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};