// AMBIL TAHUN AJARAN YANG SEDANG AKTIF

import db from '../config/db.js';
import { getLembagaByKodeService } from '../services/lembagaService.js';

export const getActiveAcademicYear = async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT id, year_name, semester FROM academic_years WHERE is_active = 1 LIMIT 1"
        });

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Belum ada Tahun Ajaran yang diaktifkan.' });
        }

        return res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error("EROR GET ACADEMIC YEAR:", error);
        return res.status(500).json({ success: false, message: 'Server error internal' });
    }
};

// AMBIL SEMUA TAHUN AJARAN (untuk dropdown filter — semua role terotentikasi)
export const listAcademicYears = async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT id, year_name, semester, is_active FROM academic_years ORDER BY id DESC"
        });
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error("EROR GET ALL ACADEMIC YEARS:", error);
        return res.status(500).json({ success: false, message: 'Server error internal' });
    }
};

// AMBIL DATA MASTER JENJANG DAN ROMBEL UNTUK FILTER FRONTEND
export const getFilterMasterData = async (req, res) => {
    try {
        const callerLembaga = String(req.user?.lembaga || 'ALL').toUpperCase();
        let targetLembaga = callerLembaga;

        // Super Admin (callerLembaga === 'ALL') dapat memilih scope lembaga via ?lembaga=<kode>
        if (callerLembaga === 'ALL' && req.query.lembaga) {
            const requestedLembaga = String(req.query.lembaga).toUpperCase().trim();
            if (requestedLembaga === 'ALL') {
                targetLembaga = 'ALL';
            } else {
                const found = await getLembagaByKodeService(requestedLembaga);
                if (found && Number(found.aktif) !== 0) {
                    targetLembaga = requestedLembaga;
                }
            }
        }

        const isAll = targetLembaga === 'ALL';

        // 1. Ambil tahun ajaran aktif & list tahun ajaran
        const academicYearResult = await db.execute({
            sql: "SELECT id, year_name, semester FROM academic_years WHERE is_active = 1 LIMIT 1"
        });
        const academicYearList = await db.execute({
            sql: "SELECT * FROM academic_years ORDER BY id DESC"
        });

        // 2. Filter Jenjang berdasarkan Lembaga
        const jenjangSql = isAll
            ? "SELECT * FROM jenjang ORDER BY id ASC"
            : "SELECT * FROM jenjang WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all' ORDER BY id ASC";
        const jenjangArgs = isAll ? [] : [targetLembaga];
        const jenjangResult = await db.execute({ sql: jenjangSql, args: jenjangArgs });

        // 3. Filter Classes & Rombels secara dinamis berdasarkan kolom sumber / lembaga
        const scopeFilter = isAll 
            ? "" 
            : "WHERE LOWER(sumber) = LOWER(?) OR LOWER(sumber) = 'all' OR sumber IS NULL OR sumber = ''";
        const scopeArgs = isAll ? [] : [targetLembaga];

        const classRoomResult = await db.execute({ 
            sql: `SELECT * FROM classes ${scopeFilter} ORDER BY id ASC`,
            args: scopeArgs
        });

        const rombelResult = await db.execute({ 
            sql: `SELECT * FROM rombels ${scopeFilter} ORDER BY id ASC`,
            args: scopeArgs
        });

        // 4. Filter Guru berdasarkan Lembaga
        const guruResult = await db.execute({
            sql: isAll
                ? "SELECT * FROM teachers ORDER BY id ASC"
                : "SELECT * FROM teachers WHERE LOWER(lembaga) IN (LOWER(?), 'all') ORDER BY id ASC",
            args: isAll ? [] : [targetLembaga]
        });

        // 5. Filter Mapel berdasarkan Lembaga
        const mapelResult = await db.execute({
            sql: isAll
                ? "SELECT * FROM subjects ORDER BY id ASC"
                : "SELECT * FROM subjects WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = 'all' ORDER BY id ASC",
            args: isAll ? [] : [targetLembaga]
        });

        return res.status(200).json({
            success: true,
            lembaga: targetLembaga,
            jenjang: jenjangResult.rows,
            kelas: classRoomResult.rows,
            tahun: academicYearResult.rows[0] || null,
            list_tahun: academicYearList.rows,
            rombel: rombelResult.rows,
            mapel: mapelResult.rows,
            guru: guruResult.rows
        });
    } catch (error) {
        console.error("ERROR GET FILTER MASTER:", error);
        return res.status(500).json({ success: false, message: 'Gagal memuat data filter master' });
    }
};