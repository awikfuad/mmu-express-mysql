import * as studentService from '../services/studentService.js';
import db from '../config/db.js';

export const getStudents = async (req, res) => {
    try {
        const data = await studentService.getAllStudentsService(req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const addStudent = async (req, res) => {
    const { nim, name } = req.body;
    if (!nim || !name) {
        return res.status(400).json({ success: false, message: 'NIM dan Nama Santri wajib diisi!' });
    }

    try {
        // Super admin (ALL) bebas memilih lembaga dari form; scoped admin dipaksa ke lembaganya sendiri
        const userLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const lembagaTarget = userLembaga === 'ALL' && req.body.lembaga ? req.body.lembaga.toUpperCase() : userLembaga;
        const data = await studentService.createStudentService(req.body, lembagaTarget);
        return res.status(201).json({ success: true, message: 'Santri berhasil ditambahkan!', data });
    } catch (error) {
        // Antisipasi jika NIM kembar (Unique Constraint Error)
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, message: 'NIM sudah terdaftar di sistem!' });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const editStudent = async (req, res) => {
    try {
        const userLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const lembagaTarget = userLembaga === 'ALL' && req.body.lembaga ? req.body.lembaga.toUpperCase() : userLembaga;
        const data = await studentService.updateStudentService(req.params.id, req.body, lembagaTarget);
        return res.json({ success: true, message: 'Data santri berhasil diperbarui!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const updateStatus = async (req, res) => {
   try {
        const { id } = req.params;
        const { status } = req.body;

        // Validasi input status agar tipe datanya aman
        if (status !== 0 && status !== 1 && status !== '0' && status !== '1') {
            return res.status(400).json({
                success: false,
                message: "Status tidak valid! Hanya menerima nilai 1 (Aktif) atau 0 (Tidak Aktif)."
            });
        }

        await studentService.updateStudentStatusService(id, { status: Number(status) }, req.user?.lembaga);

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
        await studentService.deleteStudentService(req.params.id, req.user?.lembaga);
        return res.json({ success: true, message: 'Santri berhasil dihapus dari sistem.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};