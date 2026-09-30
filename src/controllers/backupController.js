import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    listBackupsService,
    createBackupService,
    restoreBackupService,
    deleteBackupService,
    getBackupConfigService,
    restoreFromUploadedFileService
} from '../services/backupService.js';

export const getBackups = async (req, res) => {
    try {
        const backups = await listBackupsService();
        const config = getBackupConfigService();
        res.json({ success: true, data: backups, config });
    } catch (error) {
        console.error('GET /backups error:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat daftar backup', error: error.message });
    }
};

export const createBackup = async (req, res) => {
    try {
        const { type } = req.body;
        const result = await createBackupService({ type });
        res.status(201).json({ success: true, message: 'Backup berhasil dibuat', data: result });
    } catch (error) {
        console.error('POST /backups error:', error);
        res.status(500).json({ success: false, message: error.message || 'Gagal membuat backup' });
    }
};

export const restoreBackup = async (req, res) => {
    try {
        const { filename } = req.params;
        if (!filename) return res.status(400).json({ success: false, message: 'Filename wajib diisi' });
        const result = await restoreBackupService(filename);
        res.json({ success: true, message: result.message, data: result });
    } catch (error) {
        console.error('POST /backups/restore error:', error);
        res.status(500).json({ success: false, message: error.message || 'Gagal restore backup' });
    }
};

export const deleteBackup = async (req, res) => {
    try {
        const { filename } = req.params;
        if (!filename) return res.status(400).json({ success: false, message: 'Filename wajib diisi' });
        const result = await deleteBackupService(filename);
        res.json({ success: true, message: result.message });
    } catch (error) {
        console.error('DELETE /backups error:', error);
        res.status(500).json({ success: false, message: error.message || 'Gagal hapus backup' });
    }
};

export const downloadBackup = async (req, res) => {
    try {
        const { filename } = req.params;
        if (!filename) return res.status(400).json({ success: false, message: 'Filename wajib diisi' });
        
        const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'mmu44-backups');
        const filePath = path.join(BACKUP_DIR, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'File backup tidak ditemukan' });
        }
        
        res.download(filePath, filename);
    } catch (error) {
        console.error('GET /backups/download error:', error);
        res.status(500).json({ success: false, message: 'Gagal download backup' });
    }
};

export const getBackupConfig = async (req, res) => {
    try {
        const config = getBackupConfigService();
        res.json({ success: true, data: config });
    } catch (error) {
        console.error('GET /backups/config error:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat konfigurasi backup' });
    }
};

export const uploadRestore = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File backup wajib diunggah (field: file, ekstensi .db/.sqlite/.sql)' });
        }
        const result = await restoreFromUploadedFileService(req.file);
        res.json({ success: true, message: result.message, data: result });
    } catch (error) {
        console.error('POST /backups/upload-restore error:', error);
        // 400 untuk validasi format / Turso .db, 500 untuk eksekusi SQL gagal
        const isValidation = /Format file|tidak didukung|kosong|wajib/i.test(error.message);
        res.status(isValidation ? 400 : 500).json({ success: false, message: error.message || 'Gagal restore dari file upload' });
    }
};