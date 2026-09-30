import * as classroomService from '../services/classroomService.js';
import db from '../config/db.js';

export const getClassrooms = async (req, res) => {
    try {
        const data = await classroomService.getAllClassroomsService(req.user?.lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const addClassroom = async (req, res) => {
    const { class_name } = req.body;
    if (!class_name) {
        return res.status(400).json({ success: false, message: 'Nama Kelas wajib diisi!' });
    }

    try {
        const data = await classroomService.createClassroomService(req.body, req.user?.lembaga);
        return res.status(201).json({ success: true, message: 'Kelas baru berhasil ditambahkan!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const editClassroom = async (req, res) => {
    const { class_name } = req.body;
    if (!class_name) {
        return res.status(400).json({ success: false, message: 'Nama Kelas wajib diisi!' });
    }

    try {
        const data = await classroomService.updateClassroomService(req.params.id, req.body, req.user?.lembaga);
        return res.json({ success: true, message: 'Data kelas berhasil diperbarui!', data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const removeClassroom = async (req, res) => {
    try {
        await classroomService.deleteClassroomService(req.params.id, req.user?.lembaga);
        return res.json({ success: true, message: 'Kelas berhasil dihapus dari sistem.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ENDPOINT TAMBAHAN: Mengambil opsi dropdown relasi untuk Form Input Vue
export const getClassroomFilterOptions = async (req, res) => {
    try {
        const s = ((req.user?.lembaga) || 'ALL').toUpperCase();
        let jenjangSql = "SELECT id, nama_jenjang FROM jenjang ORDER BY nama_jenjang ASC";
        const jenjangArgs = [];
        if (s !== 'ALL') {
            jenjangSql = "SELECT id, nama_jenjang FROM jenjang WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all' ORDER BY nama_jenjang ASC";
            jenjangArgs.push(s);
        }

        const resAcademic = await db.execute({ sql: "SELECT id, year_name FROM academic_years ORDER BY id DESC" });
        const resJenjang = await db.execute({ sql: jenjangSql, args: jenjangArgs });

        return res.json({
            success: true,
            academicYears: resAcademic.rows,
            jenjangs: resJenjang.rows
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};