import { getSekolahSettingsService, updateSekolahSettingsService } from '../services/sekolahService.js';
import path from 'path';
import fs from 'fs';

const LOGO_DIR = path.join(process.cwd(), 'public', 'uploads', 'sekolah');

if (!fs.existsSync(LOGO_DIR)) {
    fs.mkdirSync(LOGO_DIR, { recursive: true });
}

// Super admin boleh memilih lembaga; admin/guru scoped ke lembaganya sendiri
const resolveLembaga = (req) => {
    const userL = (req.user?.lembaga || 'ALL').toUpperCase();
    const requested = (req.query?.lembaga || req.body?.lembaga || 'ALL').toUpperCase();
    return userL === 'ALL' ? requested || 'ALL' : userL;
};

export const getSekolahSettings = async (req, res) => {
    try {
        const lembaga = resolveLembaga(req);
        const settings = await getSekolahSettingsService(lembaga);
        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('GET /sekolah-settings error:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat pengaturan sekolah', error: error.message });
    }
};

export const updateSekolahSettings = async (req, res) => {
    try {
        const lembaga = resolveLembaga(req);

        let logoPath = undefined;
        let removeLogo = false;

        // Handle file upload (multer puts file in req.file)
        if (req.file) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
                return res.status(400).json({ success: false, message: 'Format logo harus PNG/JPG' });
            }
            const filename = `logo-${lembaga.toLowerCase()}-${Date.now()}${ext}`;
            const filepath = path.join(LOGO_DIR, filename);
            fs.writeFileSync(filepath, req.file.buffer);
            logoPath = `/uploads/sekolah/${filename}`;
        }

        // Handle remove logo flag
        if (req.body.remove_logo === 'true') {
            removeLogo = true;
        }

        // Prepare data for service
        const parseNum = (v) => {
            if (v === undefined || v === null || v === '') return null;
            const n = Number(v);
            return isNaN(n) ? null : n;
        };
        const parseBool = (v) => v === '1' || v === 1 || v === true;

        const updateData = {
            nama_sekolah: req.body.nama_sekolah,
            alamat: req.body.alamat,
            telepon: req.body.telepon,
            email: req.body.email,
            website: req.body.website,
            footer_text: req.body.footer_text,
            logo_path: logoPath,
            remove_logo: removeLogo,
            latitude: req.body.latitude !== undefined ? parseNum(req.body.latitude) : undefined,
            longitude: req.body.longitude !== undefined ? parseNum(req.body.longitude) : undefined,
            geofence_radius: req.body.geofence_radius !== undefined ? parseNum(req.body.geofence_radius) : undefined,
            geofence_enabled: req.body.geofence_enabled !== undefined ? parseBool(req.body.geofence_enabled) : undefined
        };

        const result = await updateSekolahSettingsService(updateData, lembaga);
        res.json(result);
    } catch (error) {
        console.error('PUT /sekolah-settings error:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui pengaturan sekolah', error: error.message });
    }
};