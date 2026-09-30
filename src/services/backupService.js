import db from '../config/db.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Backend kini memakai MySQL/MariaDB. Backup hanya didukung format .sql
// (dump CREATE TABLE + INSERT); tipe .db/.sqlite lama tidak lagi berlaku.

// 1. Tentukan folder writeable (/tmp di Vercel Serverless)
const DEFAULT_DIR = process.env.VERCEL
    ? path.join(os.tmpdir(), 'mmu44-backups')
    : path.join(os.homedir(), 'mmu44-backups');

const BACKUP_DIR = process.env.BACKUP_DIR || DEFAULT_DIR;
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '10', 10);

// Helper untuk membuat folder secara aman tanpa memutus eksekusi serverless
function ensureBackupDir() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
    } catch (err) {
        console.warn('Gagal membuat direktori backup:', err.message);
    }
}

// Panggil secara eksplisit saat aman
ensureBackupDir();

function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// MySQL selalu dianggap remote (server terpisah / cloud).
const isRemote = () => true;

// Escape nilai literal untuk INSERT (quote ganda '').
function sqlLiteral(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? '1' : '0';
    return "'" + String(val).replace(/'/g, "''") + "'";
}

export const listBackupsService = async () => {
    try {
        ensureBackupDir();
        if (!fs.existsSync(BACKUP_DIR)) return [];

        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db') || f.endsWith('.sql'))
            .map(f => {
                const stats = fs.statSync(path.join(BACKUP_DIR, f));
                return {
                    filename: f,
                    size: stats.size,
                    created_at: stats.mtime.toISOString(),
                    type: f.endsWith('.db') ? 'sqlite' : 'sql'
                };
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return files;
    } catch (err) {
        console.error('List backups error:', err);
        return [];
    }
};

async function generateSqlDump(database, filepath) {
    // Daftar tabel aplikasi (bukan tabel sistem MySQL)
    const tablesResult = await database.execute(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    `);

    let sql = '-- MMU A-44 MySQL/MariaDB backup\n-- Generated: ' + new Date().toISOString() + '\n\n';
    sql += 'SET FOREIGN_KEY_CHECKS = 0;\n\n';

    for (const table of tablesResult.rows) {
        const tableName = table.TABLE_NAME || table['TABLE_NAME'];
        if (!tableName || tableName.startsWith('sqlite_')) continue;

        // Schema via SHOW CREATE TABLE
        const schemaResult = await database.execute(
            `SHOW CREATE TABLE \`${tableName}\``
        );
        const createRow = schemaResult.rows[0];
        const createSql = createRow && (createRow['Create Table'] || createRow.create_table);
        if (createSql) {
            sql += 'DROP TABLE IF EXISTS `' + tableName + '`;\n';
            sql += createSql + ';\n\n';
        }

        // Data
        const dataResult = await database.execute(`SELECT * FROM \`${tableName}\``);
        if (dataResult.rows.length > 0) {
            const columns = Object.keys(dataResult.rows[0]);
            for (const row of dataResult.rows) {
                const values = columns.map(col => sqlLiteral(row[col])).join(', ');
                sql += `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${values});\n`;
            }
            sql += '\n';
        }
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n';
    fs.writeFileSync(filepath, sql);
}

export const createBackupService = async ({ type = 'auto' } = {}) => {
    ensureBackupDir();
    const timestamp = getTimestamp();

    if (type === 'auto') {
        type = 'sql';
    }

    if (type === 'sqlite' || type === 'db') {
        throw new Error('Backup tipe .db/.sqlite tidak didukung dengan MySQL/MariaDB. Gunakan tipe .sql');
    }

    if (type === 'sql') {
        const backupName = `mmu44-backup-${timestamp}.sql`;
        const backupPath = path.join(BACKUP_DIR, backupName);
        await generateSqlDump(db, backupPath);
        await cleanupOldBackups('sql');
        return { filename: backupName, path: backupPath, type: 'sql', size: fs.statSync(backupPath).size };
    }

    throw new Error('Tipe backup tidak valid. Gunakan tipe .sql');
};

async function cleanupOldBackups(type) {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return;
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => type === 'sqlite' ? f.endsWith('.db') : f.endsWith('.sql'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > MAX_BACKUPS) {
            const toDelete = files.slice(MAX_BACKUPS);
            for (const f of toDelete) {
                fs.unlinkSync(path.join(BACKUP_DIR, f.name));
            }
        }
    } catch (e) {
        console.warn('Cleanup backup gagal:', e.message);
    }
}

// Eksekusi file dump .sql statement-per-statement terhadap MySQL.
async function executeSqlDump(sqlContent) {
    const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    for (const stmt of statements) {
        await db.execute(stmt);
    }
}

export const restoreBackupService = async (filename) => {
    ensureBackupDir();
    const backupPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(backupPath)) {
        throw new Error('File backup tidak ditemukan');
    }

    if (filename.endsWith('.db')) {
        throw new Error('Restore file biner .db/.sqlite tidak didukung. Gunakan file format .sql');
    }

    if (filename.endsWith('.sql')) {
        const sqlContent = fs.readFileSync(backupPath, 'utf8');
        await executeSqlDump(sqlContent);
        return { message: 'Database MySQL berhasil di-restore', filename };
    }

    throw new Error('Format backup tidak didukung');
};

// --- SERVICE UNTUK UPLOAD & RESTORE ---
export const restoreFromUploadedFileService = async (file) => {
    if (!file || !file.buffer || file.buffer.length === 0) {
        throw new Error('File upload tidak ditemukan atau kosong');
    }

    const originalName = (file.originalname || '').trim();
    const lowerName = originalName.toLowerCase();
    const isSql = lowerName.endsWith('.sql');
    const isDb = lowerName.endsWith('.db') || lowerName.endsWith('.sqlite') || lowerName.endsWith('.sqlite3');

    if (isSql) {
        const sqlContent = file.buffer.toString('utf8').trim();
        if (!sqlContent) throw new Error('File SQL kosong');
        await executeSqlDump(sqlContent);
        return { message: 'Database MySQL berhasil di-restore dari file unggahan', filename: originalName };
    }

    if (isDb) {
        throw new Error('Restore file biner .db/.sqlite tidak didukung dengan MySQL/MariaDB. Gunakan file format .sql');
    }

    throw new Error('Format file tidak didukung. Unggah berkas .sql saja');
};

export const deleteBackupService = async (filename) => {
    ensureBackupDir();
    const backupPath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(backupPath)) {
        throw new Error('File backup tidak ditemukan');
    }
    fs.unlinkSync(backupPath);
    return { message: 'Backup dihapus', filename };
};

export const getBackupConfigService = () => ({
    backupDir: BACKUP_DIR,
    maxBackups: MAX_BACKUPS,
    isRemote: isRemote(),
    dbFilePath: null
});