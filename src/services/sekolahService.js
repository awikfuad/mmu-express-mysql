import db from '../config/db.js';
import fs from 'fs';
import path from 'path';

const DEFAULT_SETTINGS = {
    id: 1,
    lembaga: 'ALL',
    nama_sekolah: 'MMU A-44',
    alamat: '',
    telepon: '',
    email: '',
    website: '',
    logo_path: null,
    footer_text: 'Terima kasih atas pembayarannya',
    latitude: null,
    longitude: null,
    geofence_radius: 100,
    geofence_enabled: 0
};

// Pastikan ada baris sekolah_settings utk lembaga tertentu (upsert on demand).
const ensureRow = async (lembaga) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const existing = await db.execute({
        sql: 'SELECT id FROM sekolah_settings WHERE lembaga = ? LIMIT 1',
        args: [l]
    });
    if (existing.rows[0]) return existing.rows[0].id;

    // Id eksplisit — kolom id bertipe INTEGER PRIMARY KEY DEFAULT 1 (bukan AUTOINCREMENT),
    // sehingga omitting id akan selalu memakai DEFAULT 1 dan berbenturan dgn baris ALL.
    const maxId = await db.execute({
        sql: 'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sekolah_settings',
        args: []
    });
    const nextId = Number(maxId.rows[0]?.next_id || 1);
    await db.execute({
        sql: `INSERT INTO sekolah_settings (id, lembaga, nama_sekolah, footer_text)
              VALUES (?, ?, 'MMU A-44', 'Terima kasih atas pembayarannya')`,
        args: [nextId, l]
    });
    return nextId;
};

export const getSekolahSettingsService = async (lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const result = await db.execute({
        sql: 'SELECT * FROM sekolah_settings WHERE lembaga = ? LIMIT 1',
        args: [l]
    });
    if (result.rows[0]) return result.rows[0];

    // Belum ada baris utk lembaga tsb → jatuh ke pengaturan lembaga ALL (default global)
    const all = await db.execute({
        sql: 'SELECT * FROM sekolah_settings WHERE lembaga = ? LIMIT 1',
        args: ['ALL']
    });
    if (all.rows[0]) return { ...all.rows[0], id: DEFAULT_SETTINGS.id, lembaga: l };
    return { ...DEFAULT_SETTINGS, lembaga: l };
};

export const updateSekolahSettingsService = async (data = {}, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const rowId = await ensureRow(l);

    const {
        nama_sekolah,
        alamat,
        telepon,
        email,
        website,
        logo_path,
        footer_text,
        remove_logo,
        latitude,
        longitude,
        geofence_radius,
        geofence_enabled
    } = data;

    const updates = [];
    const args = [];

    if (nama_sekolah !== undefined) {
        updates.push('nama_sekolah = ?');
        args.push(nama_sekolah);
    }
    if (alamat !== undefined) {
        updates.push('alamat = ?');
        args.push(alamat);
    }
    if (telepon !== undefined) {
        updates.push('telepon = ?');
        args.push(telepon);
    }
    if (email !== undefined) {
        updates.push('email = ?');
        args.push(email);
    }
    if (website !== undefined) {
        updates.push('website = ?');
        args.push(website);
    }
    if (remove_logo) {
        const current = await db.execute({ sql: 'SELECT logo_path FROM sekolah_settings WHERE id = ?', args: [rowId] });
        if (current.rows[0]?.logo_path) {
            const oldPath = path.join(process.cwd(), 'public', current.rows[0].logo_path);
            if (fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch (e) { /* abaikan */ }
            }
        }
        updates.push('logo_path = ?');
        args.push(null);
    } else if (logo_path !== undefined) {
        updates.push('logo_path = ?');
        args.push(logo_path);
    }
    if (footer_text !== undefined) {
        updates.push('footer_text = ?');
        args.push(footer_text);
    }
    if (latitude !== undefined) {
        updates.push('latitude = ?');
        args.push(latitude);
    }
    if (longitude !== undefined) {
        updates.push('longitude = ?');
        args.push(longitude);
    }
    if (geofence_radius !== undefined) {
        updates.push('geofence_radius = ?');
        args.push(geofence_radius);
    }
    if (geofence_enabled !== undefined) {
        updates.push('geofence_enabled = ?');
        args.push(geofence_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
        return { success: true, message: 'Tidak ada data yang diubah' };
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    args.push(rowId);

    await db.execute({
        sql: `UPDATE sekolah_settings SET ${updates.join(', ')} WHERE id = ?`,
        args
    });

    return { success: true, message: 'Pengaturan sekolah berhasil diperbarui' };
};