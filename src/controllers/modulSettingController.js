import {
    getAllModulSettingsService,
    updateModulSettingService,
    getActiveModulKeysService
} from '../services/modulSettingService.js';
import { getAllLembagaService } from '../services/lembagaService.js';

const isSuperAdmin = (req) => ((req.user?.lembaga || 'ALL').toUpperCase() === 'ALL');

// GET /api/modul-settings — daftar seluruh pengaturan modul + opsi lembaga (Super Admin saja).
export const getModulSettings = async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat mengakses pengaturan modul.' });
    }
    try {
        const settings = await getAllModulSettingsService();
        const lembaga = (await getAllLembagaService()).map((l) => ({ kode: l.kode, nama: l.nama }));
        return res.status(200).json({ success: true, message: 'Berhasil memuat pengaturan modul', data: settings, lembaga });
    } catch (error) {
        console.error('LOG EROR GET MODUL SETTINGS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat pengaturan modul karena gangguan server internal' });
    }
};

// PUT /api/modul-settings/:key — perbarui is_active / lembaga_access satu modul (Super Admin saja).
export const updateModulSetting = async (req, res) => {
    if (!isSuperAdmin(req)) {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat mengubah pengaturan modul.' });
    }
    try {
        await updateModulSettingService(req.params.key, req.body);
        return res.status(200).json({ success: true, message: 'Pengaturan modul berhasil diperbarui.' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// GET /api/modul-settings/active — daftar modul yang boleh tampil utk lembaga user
// (dipakai sidebar Dashboard utk filter menu; admin & guru sama-sama dapat).
export const getActiveModuls = async (req, res) => {
    try {
        const data = await getActiveModulKeysService(req.user?.lembaga);
        return res.status(200).json({ success: true, message: 'Berhasil memuat modul aktif', data });
    } catch (error) {
        console.error('LOG EROR GET ACTIVE MODULS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat modul aktif karena gangguan server internal' });
    }
};