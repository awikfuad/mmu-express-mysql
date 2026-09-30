import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt'; // Disesuaikan dengan instalasi npm install bcrypt
import 'dotenv/config';
import { setLembagaCache } from '../utils/lembagaHelper.js';

const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'mmu_a44';

// Membuat database bila belum ada (pool membutuhkan database yang sudah ada).
const ensureDatabase = async () => {
    const conn = await mysql.createConnection({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        multipleStatements: false
    });
    await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.end();
};

const ensureDatabasePromise = ensureDatabase();

// Wrapper MySQL yang mempertahankan kontrak API libsql yang dipakai seluruh layanan:
//   db.execute({ sql, args })  /  db.execute(sql, args)  /  db.execute(sql)
//       → { rows, columns, rowsAffected, lastInsertRowid, insertId, changedRows }
//   db.batch(stmt[], mode)     → array hasil (dibungkus transaksi)
class MySQLWrapper {
    constructor(pool) {
        this.pool = pool;
    }

    normalize(result, fields) {
        if (Array.isArray(result)) {
            return {
                rows: result,
                columns: (fields || []).map((f) => f && f.name),
                rowsAffected: result.length,
                lastInsertRowid: 0,
                insertId: 0,
                changedRows: 0
            };
        }
        return {
            rows: [],
            columns: [],
            rowsAffected: result.affectedRows || 0,
            lastInsertRowid: result.insertId || 0,
            insertId: result.insertId || 0,
            changedRows: (result.changedRows || 0)
        };
    }

    async execute(input, extraArgs) {
        let sql, args;
        if (typeof input === 'string') {
            sql = input;
            args = extraArgs || [];
        } else {
            sql = input.sql;
            args = input.args || [];
        }
        const [result, fields] = await this.pool.execute(sql, args);
        return this.normalize(result, fields);
    }

    async batch(statements) {
        const conn = await this.pool.getConnection();
        try {
            await conn.beginTransaction();
            const results = [];
            for (const stmt of statements) {
                const sql = typeof stmt === 'string' ? stmt : stmt.sql;
                const args = typeof stmt === 'string' ? [] : stmt.args || [];
                const [result, fields] = await conn.execute(sql, args);
                results.push(this.normalize(result, fields));
            }
            await conn.commit();
            return results;
        } catch (err) {
            try { await conn.rollback(); } catch (_) {}
            throw err;
        } finally {
            conn.release();
        }
    }

    async close() {
        return this.pool.end();
    }
}

// Index DB disiapkan dengan try/catch agar idempotent di MySQL (tanpa IF NOT EXISTS).
const safeIndex = async (db, name, table, columns) => {
    try {
        await db.execute(`CREATE INDEX ${name} ON ${table} (${columns})`);
    } catch (e) {
        // index sudah ada — abaikan
    }
};

const initDb = async () => {
    await ensureDatabasePromise;
    const pool = mysql.createPool({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        connectionLimit: 20,
        waitForConnections: true,
        queueLimit: 0,
        dateStrings: true,        // DATE/DATETIME dikembalikan sebagai string (jaga perilaku libsql)
        decimalNumbers: true,     // DECIMAL dikembalikan sebagai angka (bukan string)
        supportBigNumbers: true
    });
    const db = new MySQLWrapper(pool);

    // ORDER FK-SAFE: tabel yang direferensikan harus dibuat lebih dulu.
    try {
        // 1. TABEL ADMIN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            role VARCHAR(20) DEFAULT 'admin',
            username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            foto TEXT,
            google_sub VARCHAR(255),
            google_email VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 2. TABEL MASTER LEMBAGA (dibuat dulu utk cache & referensi)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS lembaga (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kode VARCHAR(50) NOT NULL UNIQUE,
            nama VARCHAR(255) NOT NULL,
            sumber VARCHAR(20) NOT NULL DEFAULT 'madrasah',
            keterangan TEXT,
            urutan INT DEFAULT 0,
            is_system INT DEFAULT 0,
            aktif INT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 3. TABEL TAHUN AJARAN (dibuat sebelum students, year_closing, kalender)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS academic_years (
            id INT AUTO_INCREMENT PRIMARY KEY,
            year_name VARCHAR(20) NOT NULL,
            semester VARCHAR(20) NOT NULL,
            is_active INT DEFAULT 0,
            is_closed INT DEFAULT 0,
            closed_at TEXT,
            closed_by VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // Migrasi DB lama: closed_at semula VARCHAR(20) — ISO timestamp (24 karakter) terpotong di MySQL.
        try { await db.execute('ALTER TABLE academic_years MODIFY COLUMN closed_at TEXT'); } catch (e) { /* sudah TEXT (MySQL lama) */ }

        // 4. TABEL JENJANG
        await db.execute(`
        CREATE TABLE IF NOT EXISTS jenjang (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nama_jenjang VARCHAR(255) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL'
        )`);
        try { await db.execute(`UPDATE jenjang SET lembaga = 'MADRASAH' WHERE id IN (1,2,3) AND (lembaga IS NULL OR lembaga = 'ALL')`); } catch(e) {}
        try { await db.execute(`UPDATE jenjang SET lembaga = 'TPQ' WHERE id = 100 AND (lembaga IS NULL OR lembaga = 'ALL')`); } catch(e) {}

        // 5. TABEL MASTER GURU / USTADZ
        await db.execute(`
        CREATE TABLE IF NOT EXISTS teachers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            role VARCHAR(20) DEFAULT 'teacher',
            username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            status INT DEFAULT 1,
            foto TEXT,
            google_sub VARCHAR(255),
            google_email VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 6. TABEL KEGIATAN LEGACY
        await db.execute(`
        CREATE TABLE IF NOT EXISTS activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            activity_name VARCHAR(255) NOT NULL,
            activity_date VARCHAR(10) NOT NULL,
            description TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 7. TABEL KELAS (gabungan classrooms + class_tpq, dibedakan via `sumber`)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS classes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            class_name VARCHAR(255) NOT NULL,
            description TEXT,
            academic_year_id INT,
            jenjang_id INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 8. TABEL ROMBELS (gabungan rombel + rombel_tpq)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS rombels (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            jenjang_id INT,
            nama_rombel VARCHAR(255) NOT NULL,
            FOREIGN KEY (jenjang_id) REFERENCES jenjang(id)
        )`);

        // 9. TABEL MATA PELAJARAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS subjects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            subject_code VARCHAR(30) UNIQUE NOT NULL,
            subject_name VARCHAR(255) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 10. TABEL KEGIATAN ISTIGHOSAH
        await db.execute(`
        CREATE TABLE IF NOT EXISTS kegiatan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            activity_name VARCHAR(255) NOT NULL,
            activity_date VARCHAR(10) NOT NULL,
            description TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            target VARCHAR(20) DEFAULT 'SEMUA',
            target_jenjang TEXT,
            target_kelas TEXT,
            repeat_type VARCHAR(20) DEFAULT 'ONCE',
            waktu_pelaksanaan VARCHAR(5),
            waktu_selesai VARCHAR(5),
            toleransi_menit INTEGER DEFAULT 30,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        // target_kelas: JSON array id classes (opsional, null/kosong = semua kelas) — ALTER idempotent utk DB lama
        try { await db.execute('ALTER TABLE kegiatan ADD COLUMN target_kelas TEXT'); } catch (e) { /* sudah ada (MySQL lama) */ }
        // v3.43: repeat_type 'ONCE' | 'WEEKLY' (mingguan — absensi dicatat per tanggal) — ALTER idempotent utk DB lama
        try { await db.execute("ALTER TABLE kegiatan ADD COLUMN repeat_type VARCHAR(20) DEFAULT 'ONCE'"); } catch (e) { /* sudah ada (MySQL lama) */ }
        // v3.44: jendela waktu presensi — waktu_pelaksanaan/waktu_selesai (HH:MM WIB) + toleransi_menit (default 30)
        // ALTER idempotent utk DB lama; tanpa waktu_pelaksanaan → presensi TANPA pembatasan (backward compatible).
        try { await db.execute("ALTER TABLE kegiatan ADD COLUMN waktu_pelaksanaan VARCHAR(5)"); } catch (e) { /* sudah ada (MySQL lama) */ }
        try { await db.execute("ALTER TABLE kegiatan ADD COLUMN waktu_selesai VARCHAR(5)"); } catch (e) { /* sudah ada (MySQL lama) */ }
        try { await db.execute("ALTER TABLE kegiatan ADD COLUMN toleransi_menit INTEGER DEFAULT 30"); } catch (e) { /* sudah ada (MySQL lama) */ }

        // 11. TABEL SANTRI (akun mobile) — setelah academic_years
        await db.execute(`
        CREATE TABLE IF NOT EXISTS students (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nim VARCHAR(50) UNIQUE NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            academic_year_id INT,
            jenjang_id INT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            tanggal_lahir VARCHAR(20),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
        )`);

        // 12. TABEL REFRESH TOKENS
        await db.execute(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            role VARCHAR(20) NOT NULL,
            token VARCHAR(700) UNIQUE NOT NULL,
            family_id VARCHAR(64),
            expires_at DATETIME,
            ip VARCHAR(64),
            user_agent VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_refresh_user_id', 'refresh_tokens', 'user_id, role');
        await safeIndex(db, 'idx_refresh_expires_at', 'refresh_tokens', 'expires_at');
        await safeIndex(db, 'idx_refresh_family', 'refresh_tokens', 'family_id');

        // Seed admin jika kosong
        const salt = bcrypt.genSaltSync(10);
        await db.execute({
            sql: `INSERT IGNORE INTO admins (username, password, name) VALUES (?, ?, ?)`,
            args: ['admin', bcrypt.hashSync("awik1745", salt), 'admin']
        });

        // 13. TABEL ABSENSI SANTRI (KBM)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS attendances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            session_name VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            date VARCHAR(10) NOT NULL,
            teacher_id INT,
            latitude DOUBLE,
            longitude DOUBLE,
            accuracy DOUBLE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
            UNIQUE(student_id, date, session_name)
        )`);

        // 14. TABEL ABSENSI KEGIATAN SANTRI
        await db.execute(`
        CREATE TABLE IF NOT EXISTS activity_attendances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            activity_id INT NOT NULL,
            student_id INT NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(activity_id, student_id)
        )`);

        // 15. TABEL JADWAL PELAJARAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS schedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            classroom_id INT NOT NULL,
            teacher_id INT NOT NULL,
            substitute_teacher_id INT,
            subject_id INT NOT NULL,
            day_of_week VARCHAR(20) NOT NULL,
            start_time VARCHAR(5) NOT NULL,
            end_time VARCHAR(5) NOT NULL,
            session_name VARCHAR(50) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            academic_year_id INT,
            jenjang_id INT,
            rombel_id INT,
            jp INT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (classroom_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
            FOREIGN KEY (substitute_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
        )`);

        // 16. TABEL PIKET GURU
        await db.execute(`
        CREATE TABLE IF NOT EXISTS piket_guru (
            id INT AUTO_INCREMENT PRIMARY KEY,
            day_of_week VARCHAR(20) NOT NULL,
            start_time VARCHAR(5) NOT NULL,
            end_time VARCHAR(5) NOT NULL,
            teacher_id INT NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_piket_guru_lembaga', 'piket_guru', 'lembaga');
        await safeIndex(db, 'idx_piket_guru_day', 'piket_guru', 'day_of_week');

        // 17. TABEL TABUNGAN SANTRI
        await db.execute(`
        CREATE TABLE IF NOT EXISTS savings_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            amount DECIMAL(15,2) NOT NULL,
            notes TEXT,
            bulan_hijriah VARCHAR(40),
            tahun_hijriah VARCHAR(20),
            saving_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 18. TABEL SNAPSHOT TUTUP BUKU
        await db.execute(`
        CREATE TABLE IF NOT EXISTS year_closing_snapshots (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT NOT NULL,
            snapshot_type VARCHAR(20) NOT NULL,
            account_code VARCHAR(30),
            lembaga VARCHAR(50) DEFAULT 'ALL',
            student_id INT,
            nim VARCHAR(50),
            description TEXT,
            opening_balance DECIMAL(15,2) DEFAULT 0,
            total_masuk DECIMAL(15,2) DEFAULT 0,
            total_keluar DECIMAL(15,2) DEFAULT 0,
            closing_balance DECIMAL(15,2) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
        )`);

        // 19. TABEL ABSENSI GURU KBM (per slot jadwal per tanggal)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS teacher_kbm_attendances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            schedule_id INT NOT NULL,
            classroom_id INT NOT NULL,
            teacher_id INT NOT NULL,
            hari VARCHAR(20) NOT NULL,
            tanggal VARCHAR(10) NOT NULL,
            session_name VARCHAR(50),
            status VARCHAR(20) NOT NULL,
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            dicatat_oleh VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(schedule_id, tanggal),
            FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_tka_tanggal', 'teacher_kbm_attendances', 'tanggal');
        await safeIndex(db, 'idx_tka_teacher_tanggal', 'teacher_kbm_attendances', 'teacher_id, tanggal');
        await safeIndex(db, 'idx_tka_lembaga', 'teacher_kbm_attendances', 'lembaga');

        // 20. TABEL ABSENSI ISTIGHOSAH
        await db.execute(`
        CREATE TABLE IF NOT EXISTS absensi_istighosah (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            jenjang_id INT,
            nim VARCHAR(50) NOT NULL,
            month VARCHAR(40),
            tahun VARCHAR(20),
            tanggal_absensi VARCHAR(10),
            activity_id INT NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            latitude DOUBLE,
            longitude DOUBLE,
            accuracy DOUBLE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (activity_id) REFERENCES kegiatan(id) ON DELETE CASCADE,
            UNIQUE(activity_id, nim, tanggal_absensi)
        )`);

        // v3.43: migrasi UNIQUE absensi_istighosah — dari (activity_id, nim) menjadi (activity_id, nim, tanggal_absensi)
        // agar kegiatan mingguan (WEEKLY) bisa mencatat absensi per tanggal (seorang santri hadir tiap pekan di kegiatan yang sama).
        // MySQL menamai index UNIQUE(activity_id, nim) sebagai 'activity_id'; drop dahulu lalu buat index baru (idempotent).
        try {
            await db.execute('ALTER TABLE absensi_istighosah DROP INDEX activity_id');
        } catch (e) { /* index lama tidak ada (DB baru sudah langsung (activity_id, nim, tanggal_absensi)) */ }
        try {
            await db.execute('ALTER TABLE absensi_istighosah ADD UNIQUE INDEX uq_absensi_activity_nim_tanggal (activity_id, nim, tanggal_absensi)');
        } catch (e) { /* index baru sudah ada — abaikan */ }
        // v3.43: normalisasi tanggal_absensi utk kegiatan sekali (ONCE) → tanggal kegiatan.
        // Dengan UNIQUE (activity_id, nim, tanggal_absensi), baris ONCE harus konsisten per (kegiatan, santri):
        // pindahkan tanggal_absensi lama yang berbeda ke activity_date agar rekap tidak menghitung ganda (idempotent).
        try {
            await db.execute(`
                UPDATE absensi_istighosah aa
                JOIN kegiatan k ON k.id = aa.activity_id
                SET aa.tanggal_absensi = k.activity_date
                WHERE (k.repeat_type IS NULL OR k.repeat_type = 'ONCE' OR k.repeat_type = '')
                  AND aa.tanggal_absensi IS NOT NULL
                  AND aa.tanggal_absensi <> k.activity_date`);
        } catch (e) { /* abaikan bila kolom/relasi tak tersedia */ }

        // 21. TABEL ABSENSI GURU PADA KEGIATAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS kegiatan_teacher_attendances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kegiatan_id INT NOT NULL,
            teacher_id INT NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            latitude DOUBLE,
            longitude DOUBLE,
            accuracy DOUBLE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (kegiatan_id) REFERENCES kegiatan(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
            UNIQUE(kegiatan_id, teacher_id)
        )`);

        // 22. TABEL PEMBAYARAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            student_id INT NOT NULL,
            payment_type VARCHAR(20) NOT NULL,
            month VARCHAR(40),
            amount DECIMAL(15,2) NOT NULL,
            payment_method VARCHAR(30) NOT NULL,
            transfer_note TEXT,
            transfer_proof TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 23. TABEL SETTING NOMINAL PEMBAYARAN PER TAHUN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS payment_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT NOT NULL,
            payment_type VARCHAR(20) NOT NULL,
            lembaga VARCHAR(50) NOT NULL DEFAULT 'ALL',
            nominal DECIMAL(15,2) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(academic_year_id, payment_type, lembaga)
        )`);

        // 24. TABEL SISWI HAID
        await db.execute(`
        CREATE TABLE IF NOT EXISTS siswi_haid (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nim VARCHAR(50) NOT NULL,
            nama VARCHAR(255) NOT NULL,
            kelas VARCHAR(255) NOT NULL,
            adat INT NOT NULL DEFAULT 7,
            tanggal_mulai_haid VARCHAR(10) NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 25. TABEL JURNAL KAS
        await db.execute(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            date VARCHAR(10),
            account_code VARCHAR(30),
            description TEXT,
            type VARCHAR(20),
            amount DECIMAL(15,2),
            notes TEXT,
            lembaga VARCHAR(50),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            posted_by VARCHAR(255)
        )`);

        // 26. MASTER AKUN (CHART OF ACCOUNTS)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            account_code VARCHAR(30) UNIQUE NOT NULL,
            account_name VARCHAR(255) NOT NULL,
            account_type VARCHAR(20) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            is_system INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Seed akun default (idempotent)
        const defaultAccounts = [
            ['101', 'Kas Utama', 'KAS', 'ALL', 1],
            ['102', 'Kas Kecil', 'KAS', 'ALL', 1],
            ['201', 'Bank', 'BANK', 'ALL', 1],
            ['301', 'Piutang Iuran', 'PIUTANG', 'ALL', 1],
            ['401', 'Pendapatan Iuran Yaumiyah', 'PENDAPATAN', 'ALL', 1],
            ['402', 'Pendapatan Iuran Daftar Ulang', 'PENDAPATAN', 'ALL', 1],
            ['403', 'Setoran Tabungan', 'PENDAPATAN', 'ALL', 1],
            ['501', 'Beban Operasional', 'BEBAN', 'ALL', 1],
            ['502', 'Beban Honor Guru', 'BEBAN', 'ALL', 1],
            ['503', 'Beban Perlengkapan', 'BEBAN', 'ALL', 1]
        ];
        for (const acc of defaultAccounts) {
            await db.execute({
                sql: "INSERT IGNORE INTO accounts (account_code, account_name, account_type, lembaga, is_system) VALUES (?, ?, ?, ?, ?)",
                args: acc
            });
        }

        // Seed lembaga default (idempotent, kode UNIQUE)
        const defaultLembaga = [
            ['ALL', 'Semua Lembaga', '', 'Super Admin — akses lintas lembaga', 0, 1],
            ['MADRASAH', 'Madrasah', 'madrasah', 'Jenjang Sifir, Ibtidaiyah, Tsanawiyah', 1, 1],
            ['TPQ', 'Taman Pendidikan Al-Qur\'an', 'tpq', 'Jenjang MDT TPQ', 2, 1]
        ];
        for (const lem of defaultLembaga) {
            await db.execute({
                sql: "INSERT IGNORE INTO lembaga (kode, nama, sumber, keterangan, urutan, is_system, aktif) VALUES (?, ?, ?, ?, ?, ?, 1)",
                args: lem
            });
        }

        // Muat cache master lembaga → getSumber() men-scope berdasarkan `sumber` tabel lembaga
        try {
            const lembagaRows = await db.execute({ sql: "SELECT id, kode, nama, sumber, keterangan, urutan, is_system, aktif FROM lembaga ORDER BY id ASC", args: [] });
            setLembagaCache(lembagaRows.rows || []);
        } catch (e) {
            console.error('❌ Gagal memuat cache lembaga:', e.message);
        }

        // 27. TABEL NILAI HARIAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS nilai_harian (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            jenjang_id INT,
            classroom_id INT,
            murid_id INT NOT NULL,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            subject_id INT,
            tanggal VARCHAR(10) NOT NULL,
            nilai DECIMAL(7,2) NOT NULL,
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(murid_id, sumber, subject_id, tanggal)
        )`);

        // 28. TABEL PERILAKU MURID
        await db.execute(`
        CREATE TABLE IF NOT EXISTS perilaku_murid (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            jenjang_id INT,
            classroom_id INT,
            murid_id INT NOT NULL,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            kategori VARCHAR(50),
            predikat VARCHAR(50),
            kerajinan VARCHAR(20),
            kedisiplinan VARCHAR(20),
            kebersihan VARCHAR(20),
            catatan TEXT,
            tanggal VARCHAR(10) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 29. TABEL PRESTASI & PELANGGARAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS prestasi_pelanggaran (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            jenjang_id INT,
            classroom_id INT,
            murid_id INT NOT NULL,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            tipe VARCHAR(20) NOT NULL,
            kategori VARCHAR(100),
            deskripsi TEXT NOT NULL,
            poin INT,
            catatan TEXT,
            tanggal VARCHAR(10) NOT NULL,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 30. TABEL INVENTARIS
        await db.execute(`
        CREATE TABLE IF NOT EXISTS inventaris_aset (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kode VARCHAR(50),
            nama VARCHAR(255) NOT NULL,
            kategori VARCHAR(50),
            jumlah INT DEFAULT 0,
            kondisi VARCHAR(30),
            lokasi VARCHAR(255),
            nilai DECIMAL(15,2),
            tahun_pengadaan VARCHAR(10),
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 31. TABEL DATA ORANG TUA / WALI MURID
        await db.execute(`
        CREATE TABLE IF NOT EXISTS wali_murid (
            id INT AUTO_INCREMENT PRIMARY KEY,
            murid_id INT NOT NULL,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50),
            nama_ayah VARCHAR(255),
            pekerjaan_ayah VARCHAR(255),
            nama_ibu VARCHAR(255),
            pekerjaan_ibu VARCHAR(255),
            nama_wali VARCHAR(255),
            hubungan_wali VARCHAR(100),
            telepon_wali VARCHAR(30),
            alamat TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(murid_id, sumber)
        )`);

        // 32. TABEL IZIN/SAKIT SISWA
        await db.execute(`
        CREATE TABLE IF NOT EXISTS izin_sakit (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            nim VARCHAR(50) NOT NULL,
            jenis VARCHAR(20) NOT NULL,
            alasan VARCHAR(255) NOT NULL,
            tanggal_mulai VARCHAR(10) NOT NULL,
            tanggal_selesai VARCHAR(10) NOT NULL,
            keterangan TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',
            disetujui_oleh VARCHAR(255),
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 33. TABEL IZIN GURU + PENUGASAN BADAL
        await db.execute(`
        CREATE TABLE IF NOT EXISTS izin_guru (
            id INT AUTO_INCREMENT PRIMARY KEY,
            teacher_id INT NOT NULL,
            jenis VARCHAR(20) NOT NULL DEFAULT 'IZIN',
            alasan VARCHAR(255) NOT NULL,
            tanggal_mulai VARCHAR(10) NOT NULL,
            tanggal_selesai VARCHAR(10) NOT NULL,
            keterangan TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'AKTIF',
            pengganti_detail TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
        )`);

        // 34. TABEL KALENDER PENDIDIKAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS kalender_pendidikan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            academic_year_id INT,
            semester VARCHAR(20) NOT NULL DEFAULT 'IMDA 1',
            kategori VARCHAR(20) NOT NULL DEFAULT 'KEGIATAN',
            judul VARCHAR(255) NOT NULL,
            tanggal_mulai VARCHAR(10) NOT NULL,
            tanggal_selesai VARCHAR(10) NOT NULL,
            hijriyah_mulai VARCHAR(100),
            hijriyah_selesai VARCHAR(100),
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            source VARCHAR(20) DEFAULT 'LOCAL',
            external_uid VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_kalender_source', 'kalender_pendidikan', 'source');

        // 35. TABEL PENGUMUMAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS pengumuman (
            id INT AUTO_INCREMENT PRIMARY KEY,
            judul VARCHAR(255) NOT NULL,
            isi TEXT NOT NULL,
            kategori VARCHAR(20) NOT NULL DEFAULT 'UMUM',
            tanggal_mulai VARCHAR(10) NOT NULL,
            tanggal_selesai VARCHAR(10),
            is_published INT DEFAULT 0,
            tanggal_publish VARCHAR(30),
            lembaga VARCHAR(50) DEFAULT 'ALL',
            dibuat_oleh VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 36. TABEL AUDIT TRAIL
        await db.execute(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            actor_role VARCHAR(20),
            actor_id INT,
            actor_name VARCHAR(255),
            action VARCHAR(30) NOT NULL,
            module VARCHAR(50) NOT NULL,
            target_id VARCHAR(50),
            detail TEXT,
            ip VARCHAR(64),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_audit_logs_created', 'audit_logs', 'created_at');
        await safeIndex(db, 'idx_audit_logs_lembaga', 'audit_logs', 'lembaga');

        // 37. TABEL SEKOLAH SETTINGS (per lembaga, baris ALL global)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS sekolah_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lembaga VARCHAR(50) NOT NULL DEFAULT 'ALL',
            nama_sekolah VARCHAR(255) NOT NULL DEFAULT 'MMU A-44',
            alamat TEXT,
            telepon VARCHAR(50),
            email VARCHAR(255),
            website VARCHAR(255),
            logo_path TEXT,
            footer_text VARCHAR(255) DEFAULT 'Terima kasih atas pembayarannya',
            latitude DOUBLE,
            longitude DOUBLE,
            geofence_radius INT DEFAULT 100,
            geofence_enabled INT DEFAULT 0,
            kalender_feed_key VARCHAR(255),
            kalender_gcal_url TEXT,
            kalender_last_pulled VARCHAR(30),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_sekolah_settings_lembaga', 'sekolah_settings', 'lembaga');

        // Seed pengaturan default (baris per lembaga bawaan)
        await db.execute(`
        INSERT IGNORE INTO sekolah_settings (id, lembaga, nama_sekolah, footer_text)
        VALUES (1, 'ALL', 'MMU A-44', 'Terima kasih atas pembayarannya')
        `);
        await db.execute(`
        INSERT IGNORE INTO sekolah_settings (id, lembaga, nama_sekolah, footer_text)
        VALUES (2, 'MADRASAH', 'MMU A-44', 'Terima kasih atas pembayarannya'),
               (3, 'TPQ', 'MMU A-44', 'Terima kasih atas pembayarannya')
        `);

        // 38. TABEL PENEMPATAN SANTRI (gabungan murid_kelas + santri_kelas)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS santri_penempatan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            password VARCHAR(255),
            student_id INT,
            academic_year_id INT,
            jenjang_id INT,
            classroom_id INT,
            rombel_id INT,
            jenis_kelamin VARCHAR(20) DEFAULT 'LAKI-LAKI',
            status INT NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
        )`);
        await safeIndex(db, 'idx_santri_penempatan_sumber', 'santri_penempatan', 'sumber');
        await safeIndex(db, 'idx_santri_penempatan_nim', 'santri_penempatan', 'nim');
        await safeIndex(db, 'idx_santri_penempatan_classroom', 'santri_penempatan', 'classroom_id');
        await safeIndex(db, 'idx_santri_penempatan_jenjang', 'santri_penempatan', 'jenjang_id');
        await safeIndex(db, 'idx_santri_penempatan_year', 'santri_penempatan', 'academic_year_id');
        await safeIndex(db, 'idx_santri_penempatan_student', 'santri_penempatan', 'student_id');

        // 39. TABEL BIODATA SANTRI (gabungan data_murid + data_santri)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS santri_biodata (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50),
            nama VARCHAR(255),
            kelas VARCHAR(255),
            jenis_kelamin VARCHAR(20),
            nik VARCHAR(50),
            kk VARCHAR(50),
            tanggal_lahir VARCHAR(20),
            foto TEXT,
            tempat VARCHAR(255),
            wali VARCHAR(255),
            dusun VARCHAR(255),
            desa VARCHAR(255),
            kecamatan VARCHAR(255),
            kabupaten VARCHAR(255),
            tahun_masuk VARCHAR(20),
            status INT DEFAULT 1,
            UNIQUE(sumber, nim)
        )`);

        // 40. TABEL TARIF GAJI GURU PER JENJANG
        await db.execute(`
        CREATE TABLE IF NOT EXISTS salary_tariffs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            jenjang_id INT NOT NULL,
            lembaga VARCHAR(50) NOT NULL DEFAULT 'ALL',
            nominal DECIMAL(15,2) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(jenjang_id, lembaga)
        )`);

        // 41. TABEL SLIP GAJI GURU
        await db.execute(`
        CREATE TABLE IF NOT EXISTS teacher_salaries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            teacher_id INT NOT NULL,
            period VARCHAR(10) NOT NULL,
            jam_mengajar DECIMAL(7,2) NOT NULL DEFAULT 0,
            subtotal_mengajar DECIMAL(15,2) NOT NULL DEFAULT 0,
            tunjangan DECIMAL(15,2) NOT NULL DEFAULT 0,
            tunjangan_detail TEXT,
            total DECIMAL(15,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
            paid_at VARCHAR(10),
            detail TEXT,
            notes TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(teacher_id, period)
        )`);
        await safeIndex(db, 'idx_teacher_salaries_period', 'teacher_salaries', 'period');
        await safeIndex(db, 'idx_teacher_salaries_teacher', 'teacher_salaries', 'teacher_id');

        // 42. TABEL AKUN ORANG TUA
        await db.execute(`
        CREATE TABLE IF NOT EXISTS parent_users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            phone VARCHAR(30) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'parent',
            lembaga VARCHAR(50) DEFAULT 'ALL',
            google_sub VARCHAR(255),
            google_email VARCHAR(255),
            teacher_id INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_parent_users_google_sub', 'parent_users', 'google_sub');
        await safeIndex(db, 'idx_parent_users_teacher_id', 'parent_users', 'teacher_id');

        // 43. TABEL RELASI ORANG TUA ↔ ANAK
        await db.execute(`
        CREATE TABLE IF NOT EXISTS parent_student_links (
            id INT AUTO_INCREMENT PRIMARY KEY,
            parent_id INT NOT NULL,
            student_nim VARCHAR(50) NOT NULL,
            sumber VARCHAR(10) DEFAULT 'madrasah',
            hubungan VARCHAR(50),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(parent_id, student_nim, sumber),
            FOREIGN KEY (parent_id) REFERENCES parent_users(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_parent_student_parent', 'parent_student_links', 'parent_id');
        await safeIndex(db, 'idx_parent_student_nim', 'parent_student_links', 'student_nim');

        // 44. TABEL PENGGAJUAN PEMBAYARAN DARI TABUNGAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS payment_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            parent_id INT NOT NULL,
            nim VARCHAR(50) NOT NULL,
            sumber VARCHAR(10) DEFAULT 'madrasah',
            payment_type VARCHAR(20) NOT NULL,
            month VARCHAR(40),
            amount DECIMAL(15,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',
            disetujui_oleh VARCHAR(255),
            admin_notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_payment_requests_parent', 'payment_requests', 'parent_id');
        await safeIndex(db, 'idx_payment_requests_nim', 'payment_requests', 'nim');
        await safeIndex(db, 'idx_payment_requests_status', 'payment_requests', 'status');

        // 45. TABEL REGISTRASI GOOGLE
        await db.execute(`
        CREATE TABLE IF NOT EXISTS google_registrations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            google_sub VARCHAR(255) NOT NULL UNIQUE,
            google_email VARCHAR(255),
            name VARCHAR(255),
            picture TEXT,
            catatan TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reviewed_at DATETIME,
            reviewed_by VARCHAR(255)
        )`);
        await safeIndex(db, 'idx_google_registrations_status', 'google_registrations', 'status');

        // 46. TABEL PIMPINAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS pimpinan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nama VARCHAR(255) NOT NULL,
            jabatan VARCHAR(255) NOT NULL,
            teacher_id INT,
            aktif INT DEFAULT 1,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_pimpinan_lembaga', 'pimpinan', 'lembaga');
        await safeIndex(db, 'idx_pimpinan_teacher', 'pimpinan', 'teacher_id');

        // 47. TABEL PIKET PIMPINAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS piket_pimpinan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pimpinan_id INT NOT NULL,
            hari VARCHAR(20) NOT NULL,
            urutan INT DEFAULT 0,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(pimpinan_id, hari),
            FOREIGN KEY (pimpinan_id) REFERENCES pimpinan(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_piket_pimpinan_hari', 'piket_pimpinan', 'hari');
        await safeIndex(db, 'idx_piket_pimpinan_lembaga', 'piket_pimpinan', 'lembaga');

        // 48. TABEL PRESENSI PIMPINAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS presensi_pimpinan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            pimpinan_id INT NOT NULL,
            hari VARCHAR(20) NOT NULL,
            tanggal VARCHAR(10) NOT NULL,
            status VARCHAR(20) NOT NULL,
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(pimpinan_id, tanggal),
            FOREIGN KEY (pimpinan_id) REFERENCES pimpinan(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_presensi_pimpinan_tanggal', 'presensi_pimpinan', 'tanggal');
        await safeIndex(db, 'idx_presensi_pimpinan_lembaga', 'presensi_pimpinan', 'lembaga');

        // 49. TABEL BANK SOAL (Bank Soal & Ujian / CBT)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS bank_soal (
            id INT AUTO_INCREMENT PRIMARY KEY,
            subject_id INT,
            jenjang_id INT,
            classroom_id INT,                                -- kelas sasaran (opsional; null = semua kelas)
            imda VARCHAR(20),                                -- 'IMDA 1' | 'IMDA 2' | 'IMDA 3' (opsional; null = semua)
            tipe VARCHAR(10) NOT NULL DEFAULT 'PG',          -- 'PG' | 'ESAI'
            pertanyaan TEXT NOT NULL,
            opsi_a TEXT, opsi_b TEXT, opsi_c TEXT, opsi_d TEXT, opsi_e TEXT,
            kunci TEXT,                                      -- 'A'..'E' utk PG, kosong utk ESAI
            pembahasan TEXT,
            gambar TEXT,
            bobot DECIMAL(6,2) NOT NULL DEFAULT 1,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
            FOREIGN KEY (jenjang_id) REFERENCES jenjang(id) ON DELETE SET NULL,
            FOREIGN KEY (classroom_id) REFERENCES classes(id) ON DELETE SET NULL
        )`);
        await safeIndex(db, 'idx_bank_soal_subject', 'bank_soal', 'subject_id');
        await safeIndex(db, 'idx_bank_soal_jenjang', 'bank_soal', 'jenjang_id');
        await safeIndex(db, 'idx_bank_soal_classroom', 'bank_soal', 'classroom_id');
        await safeIndex(db, 'idx_bank_soal_lembaga', 'bank_soal', 'lembaga');
        try { await db.execute('ALTER TABLE bank_soal ADD COLUMN classroom_id INT'); } catch (e) { /* sudah ada (MySQL lama) */ }
        try { await db.execute("ALTER TABLE bank_soal ADD COLUMN imda VARCHAR(20)"); } catch (e) { /* sudah ada (MySQL lama) */ }

        // 50. TABEL UJIAN (sesi tes/ujian, online atau cetak)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS ujian (
            id INT AUTO_INCREMENT PRIMARY KEY,
            judul VARCHAR(255) NOT NULL,
            subject_id INT,
            classroom_id INT,
            jenjang_id INT,
            imda VARCHAR(20),                                -- 'IMDA 1' | 'IMDA 2' | 'IMDA 3' (opsional; null = semua)
            jenis VARCHAR(30) NOT NULL DEFAULT 'ULANGAN',    -- ULANGAN | UTS | UAS | TRYOUT | LAINNYA
            mode VARCHAR(10) NOT NULL DEFAULT 'ONLINE',      -- ONLINE | CETAK
            waktu_mulai VARCHAR(20),                         -- YYYY-MM-DD HH:MM
            waktu_selesai VARCHAR(20),
            durasi INT DEFAULT 0,                            -- menit (0 = tanpa batas)
            petunjuk TEXT,
            acak_soal INT DEFAULT 0,
            acak_opsi INT DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',     -- DRAFT | TERBIT | ARSIP
            kode_akses VARCHAR(20),
            lembaga VARCHAR(50) DEFAULT 'ALL',
            dibuat_oleh VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
            FOREIGN KEY (classroom_id) REFERENCES classes(id) ON DELETE SET NULL,
            FOREIGN KEY (jenjang_id) REFERENCES jenjang(id) ON DELETE SET NULL
        )`);
        await safeIndex(db, 'idx_ujian_lembaga', 'ujian', 'lembaga');
        await safeIndex(db, 'idx_ujian_status', 'ujian', 'status');
        await safeIndex(db, 'idx_ujian_subject', 'ujian', 'subject_id');
        try { await db.execute('ALTER TABLE ujian ADD COLUMN tampilkan_hasil INT DEFAULT 0'); } catch (e) { /* sudah ada (MySQL lama) */ }
        try { await db.execute("ALTER TABLE ujian ADD COLUMN imda VARCHAR(20)"); } catch (e) { /* sudah ada (MySQL lama) */ }

        // 51. TABEL SOAL DALAM UJIAN (banyak ke banyak, urutan)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS ujian_soal (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ujian_id INT NOT NULL,
            soal_id INT NOT NULL,
            urutan INT DEFAULT 0,
            UNIQUE(ujian_id, soal_id),
            FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE,
            FOREIGN KEY (soal_id) REFERENCES bank_soal(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_ujian_soal_ujian', 'ujian_soal', 'ujian_id');
        await safeIndex(db, 'idx_ujian_soal_soal', 'ujian_soal', 'soal_id');

        // 52. TABEL PESERTA & HASIL UJIAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS ujian_peserta (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ujian_id INT NOT NULL,
            murid_id INT,                                    -- id santri_penempatan (blh kosong utk manual)
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            classroom_id INT,
            status VARCHAR(20) NOT NULL DEFAULT 'BELUM',      -- BELUM | MENGERJAKAN | SELESAI
            mulai VARCHAR(20),
            selesai VARCHAR(20),
            jawaban TEXT,                                     -- JSON {soal_id: 'A'}
            nilai DECIMAL(7,2),
            dinilai_oleh VARCHAR(255),
            lembaga VARCHAR(50) DEFAULT 'ALL',
            UNIQUE(ujian_id, nim),
            FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_ujian_peserta_ujian', 'ujian_peserta', 'ujian_id');
        await safeIndex(db, 'idx_ujian_peserta_nim', 'ujian_peserta', 'nim');
        await safeIndex(db, 'idx_ujian_peserta_lembaga', 'ujian_peserta', 'lembaga');
        try { await db.execute('ALTER TABLE ujian_peserta ADD COLUMN tampilan_soal TEXT'); } catch (e) { /* sudah ada (MySQL lama) */ }

        // 53. TABEL KELULUSAN & MUTASI SANTRI
        await db.execute(`
        CREATE TABLE IF NOT EXISTS kelulusan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            murid_id INT,                                    -- id santri_penempatan (blh kosong utk mutasi masuk)
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            nim VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            classroom_id INT,
            jenjang_id INT,
            academic_year_id INT,
            kelas_lulus VARCHAR(255),                         -- snapshot nama kelas saat proses
            jenis VARCHAR(20) NOT NULL DEFAULT 'LULUS',       -- LULUS | MUTASI_KELUAR | MUTASI_MASUK
            tanggal VARCHAR(10) NOT NULL,
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            dibuat_oleh VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_kelulusan_lembaga', 'kelulusan', 'lembaga');
        await safeIndex(db, 'idx_kelulusan_nim', 'kelulusan', 'nim');
        await safeIndex(db, 'idx_kelulusan_tanggal', 'kelulusan', 'tanggal');

        // 54. TABEL ALUMNI
        await db.execute(`
        CREATE TABLE IF NOT EXISTS alumni (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kelulusan_id INT,
            nim VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            sumber VARCHAR(10) NOT NULL DEFAULT 'madrasah',
            jenis_kelamin VARCHAR(20),
            tanggal_lahir VARCHAR(20),
            jenjang_id INT,
            kelas_lulus VARCHAR(255),
            tahun_lulus VARCHAR(10),
            no_hp VARCHAR(30),
            pekerjaan VARCHAR(255),
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_alumni_lembaga', 'alumni', 'lembaga');
        await safeIndex(db, 'idx_alumni_nim', 'alumni', 'nim');
        await safeIndex(db, 'idx_alumni_tahun', 'alumni', 'tahun_lulus');

        // 55. TABEL NOTULEN RAPAT (header)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS notulen_rapat (
            id INT AUTO_INCREMENT PRIMARY KEY,
            judul VARCHAR(255) NOT NULL,
            agenda TEXT,
            kategori VARCHAR(30) NOT NULL DEFAULT 'RAPAT_GURU',   -- RAPAT_GURU | RAPAT_PENGURUS | RAPAT_WALI_MURID | RAPAT_PIMPINAN
            tanggal VARCHAR(10) NOT NULL,                         -- YYYY-MM-DD
            waktu_mulai VARCHAR(10),
            waktu_selesai VARCHAR(10),
            tempat VARCHAR(255),
            pimpinan VARCHAR(255),
            notulis VARCHAR(255),
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',          -- DRAFT | SELESAI
            lembaga VARCHAR(50) DEFAULT 'ALL',
            dibuat_oleh VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_notulen_lembaga', 'notulen_rapat', 'lembaga');
        await safeIndex(db, 'idx_notulen_status', 'notulen_rapat', 'status');
        await safeIndex(db, 'idx_notulen_tanggal', 'notulen_rapat', 'tanggal');

        // 56. TABEL PESERTA / KEHADIRAN RAPAT
        await db.execute(`
        CREATE TABLE IF NOT EXISTS notulen_peserta (
            id INT AUTO_INCREMENT PRIMARY KEY,
            notulen_id INT NOT NULL,
            teacher_id INT,
            nama VARCHAR(255) NOT NULL,
            kehadiran VARCHAR(20) NOT NULL DEFAULT 'HADIR',       -- HADIR | IZIN | SAKIT | ALPA
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(notulen_id, nama),
            FOREIGN KEY (notulen_id) REFERENCES notulen_rapat(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
        )`);
        await safeIndex(db, 'idx_notulen_peserta_notulen', 'notulen_peserta', 'notulen_id');

        // 57. TABEL POIN PEMBAHASAN & KEPUTUSAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS notulen_pembahasan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            notulen_id INT NOT NULL,
            poin VARCHAR(255) NOT NULL,
            isi TEXT,
            is_keputusan INT DEFAULT 0,                           -- 0 = pembahasan, 1 = keputusan final
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notulen_id) REFERENCES notulen_rapat(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_notulen_pembahasan_notulen', 'notulen_pembahasan', 'notulen_id');

        // 58. TABEL TINDAK LANJUT / ACTION ITEMS
        await db.execute(`
        CREATE TABLE IF NOT EXISTS notulen_tindak_lanjut (
            id INT AUTO_INCREMENT PRIMARY KEY,
            notulen_id INT NOT NULL,
            deskripsi TEXT NOT NULL,
            pic VARCHAR(255),
            teacher_id INT,
            deadline VARCHAR(10),                                 -- YYYY-MM-DD
            status VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',       -- MENUNGGU | BERJALAN | SELESAI
            catatan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notulen_id) REFERENCES notulen_rapat(id) ON DELETE CASCADE,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
        )`);
        await safeIndex(db, 'idx_notulen_tindak_notulen', 'notulen_tindak_lanjut', 'notulen_id');
        await safeIndex(db, 'idx_notulen_tindak_status', 'notulen_tindak_lanjut', 'status');

        // 59. TABEL LAMPIRAN RAPAT
        await db.execute(`
        CREATE TABLE IF NOT EXISTS notulen_lampiran (
            id INT AUTO_INCREMENT PRIMARY KEY,
            notulen_id INT NOT NULL,
            nama_asli VARCHAR(255),
            path_file VARCHAR(255),
            tipe VARCHAR(20),                                     -- GAMBAR | PDF
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (notulen_id) REFERENCES notulen_rapat(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_notulen_lampiran_notulen', 'notulen_lampiran', 'notulen_id');

        // 60. TABEL KATALOG KITAB / BUKU PERPUSTAKAAN
        await db.execute(`
        CREATE TABLE IF NOT EXISTS buku_katalog (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kode_buku VARCHAR(50),                                -- kode koleksi
            judul VARCHAR(255) NOT NULL,                          -- judul kitab/buku
            penulis VARCHAR(255),
            penerbit VARCHAR(255),
            tahun_terbit VARCHAR(10),                             -- YYYY
            kategori_buku VARCHAR(50),                            -- KITAB | FIQIH | HADITS | AQIDAH | AKHLAK | SEJARAH | BAHASA | UMUM | LAINNYA
            nomor_rak VARCHAR(50),
            bahasa VARCHAR(50),
            jumlah INT DEFAULT 0,                                 -- total stok
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_buku_lembaga', 'buku_katalog', 'lembaga');
        await safeIndex(db, 'idx_buku_kode', 'buku_katalog', 'kode_buku');

        // 61. TABEL SIRKULASI PEMINJAMAN BUKU
        await db.execute(`
        CREATE TABLE IF NOT EXISTS sirkulasi_peminjaman (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kode_peminjaman VARCHAR(50),                          -- kode transaksi
            buku_id INT NOT NULL,
            anggota_type VARCHAR(20) NOT NULL DEFAULT 'SANTRI',   -- SANTRI | GURU | TAMU
            nama_anggota VARCHAR(255) NOT NULL,
            nim VARCHAR(50),
            tanggal_pinjam VARCHAR(10) NOT NULL,                  -- YYYY-MM-DD
            tanggal_batas VARCHAR(10) NOT NULL,                   -- jatuh tempo
            tanggal_kembali VARCHAR(10),                          -- NULL selama masih dipinjam
            status VARCHAR(20) NOT NULL DEFAULT 'DIPINJAM',       -- DIPINJAM | DIKEMBALIKAN
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (buku_id) REFERENCES buku_katalog(id) ON DELETE RESTRICT
        )`);
        await safeIndex(db, 'idx_sirkulasi_lembaga', 'sirkulasi_peminjaman', 'lembaga');
        await safeIndex(db, 'idx_sirkulasi_status', 'sirkulasi_peminjaman', 'status');
        await safeIndex(db, 'idx_sirkulasi_buku', 'sirkulasi_peminjaman', 'buku_id');

        // 62. TABEL Denda & KETERLAMBATAN BUKU
        await db.execute(`
        CREATE TABLE IF NOT EXISTS denda_perpustakaan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            peminjaman_id INT NOT NULL,
            buku_id INT,
            tarif_per_hari REAL DEFAULT 0,                        -- jumlah denda per hari keterlambatan
            jumlah_hari INT DEFAULT 0,                            -- hari keterlambatan
            total REAL DEFAULT 0,                                 -- total denda
            status VARCHAR(20) NOT NULL DEFAULT 'BELUM_LUNAS',    -- BELUM_LUNAS | LUNAS
            tanggal_bayar VARCHAR(10),
            catatan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(peminjaman_id),
            FOREIGN KEY (peminjaman_id) REFERENCES sirkulasi_peminjaman(id) ON DELETE CASCADE
        )`);
        await safeIndex(db, 'idx_denda_lembaga', 'denda_perpustakaan', 'lembaga');
        await safeIndex(db, 'idx_denda_status', 'denda_perpustakaan', 'status');

        // 63. TABEL PENGATURAN PERPUSTAKAAN (tarif denda & lama pinjam per lembaga)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS perpus_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            lembaga VARCHAR(50) NOT NULL DEFAULT 'ALL',
            tarif_denda_harian REAL DEFAULT 1000,                 -- denda per hari keterlambatan (Rp)
            lama_pinjam_hari INT DEFAULT 7,                       -- lama pinjam default (hari)
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(lembaga)
        )`);
        await safeIndex(db, 'idx_perpus_lembaga', 'perpus_settings', 'lembaga');

        // 64. TABEL ARSIP SOALAN (arsip file soal/ujian PDF per jenjang/kelas/IMDA/tahun)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS arsip_soalan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            judul VARCHAR(255) NOT NULL,
            file_path VARCHAR(255) NOT NULL,                      -- path PDF di public/uploads
            jenjang_id INT,                                       -- jenjang (opsional; null = semua)
            classroom_id INT,                                     -- kelas (opsional; null = semua)
            imda VARCHAR(20),                                     -- 'IMDA 1' | 'IMDA 2' | 'IMDA 3' (opsional; null = semua)
            academic_year_id INT,                                 -- tahun ajaran (opsional)
            keterangan TEXT,
            lembaga VARCHAR(50) DEFAULT 'ALL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (jenjang_id) REFERENCES jenjang(id) ON DELETE SET NULL,
            FOREIGN KEY (classroom_id) REFERENCES classes(id) ON DELETE SET NULL,
            FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
        )`);
        await safeIndex(db, 'idx_arsip_lembaga', 'arsip_soalan', 'lembaga');
        await safeIndex(db, 'idx_arsip_jenjang', 'arsip_soalan', 'jenjang_id');
        await safeIndex(db, 'idx_arsip_kelas', 'arsip_soalan', 'classroom_id');
        await safeIndex(db, 'idx_arsip_tahun', 'arsip_soalan', 'academic_year_id');

        // 65. TABEL PENGATURAN MODUL (menu yang aktif & lembaga yang boleh akses tiap modul)
        await db.execute(`
        CREATE TABLE IF NOT EXISTS modul_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            modul_key VARCHAR(100) NOT NULL UNIQUE,               -- id menu di sidebar (child.id)
            nama VARCHAR(255) NOT NULL,                           -- nama modul / menu
            icon VARCHAR(100),                                    -- ikon menu
            grup VARCHAR(100) DEFAULT '',                         -- grup sidebar (utama_group, keuangan_group, dst)
            grup_title VARCHAR(255) DEFAULT '',                   -- judul grup sidebar
            is_active INT DEFAULT 1,                              -- 1 aktif (semua role/lembaga melihat), 0 nonaktif
            lembaga_access TEXT,                                  -- JSON array kode lembaga yg boleh akses; NULL/[] = semua lembaga
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await safeIndex(db, 'idx_modul_key', 'modul_settings', 'modul_key');

        // Seed katalog modul default (idempotent — INSERT IGNORE utk modul_key UNIQUE)
        const defaultModuls = [
            ['home', 'Beranda', 'mdi-home-outline', 'utama_group', 'Utama'],
            ['analytics', 'Analitik & Grafik', 'mdi-chart-donut', 'utama_group', 'Utama'],
            ['santri', 'Data Santri', 'mdi-school-outline', 'data_master', 'Data Master'],
            ['guru', 'Data Guru', 'mdi-account-tie-outline', 'data_master', 'Data Master'],
            ['kelas', 'Data Ruang Kelas', 'mdi-google-classroom', 'data_master', 'Data Master'],
            ['muridkelas', 'Murid Kelas', 'mdi-account-box-multiple-outline', 'data_master', 'Data Master'],
            ['data-wali', 'Data Wali Murid', 'mdi-account-heart-outline', 'data_master', 'Data Master'],
            ['master-management', 'Manajemen Master', 'mdi-database-cog-outline', 'data_master', 'Data Master'],
            ['jadwal', 'Jadwal & Piket', 'mdi-calendar-clock-outline', 'akademik_group', 'KBM & Akademik'],
            ['piket-guru', 'Piket Guru', 'mdi-account-tie-hat-outline', 'akademik_group', 'KBM & Akademik'],
            ['presensi-kbm', 'Presensi KBM', 'mdi-clipboard-check-outline', 'akademik_group', 'KBM & Akademik'],
            ['nilai-harian', 'Nilai Harian', 'mdi-note-text-outline', 'akademik_group', 'KBM & Akademik'],
            ['perilaku-murid', 'Perilaku Murid', 'mdi-emoticon-outline', 'akademik_group', 'KBM & Akademik'],
            ['bank-soal-ujian', 'Bank Soal & Ujian', 'mdi-clipboard-pulse-outline', 'akademik_group', 'KBM & Akademik'],
            ['arsip-soalan', 'Arsip Soalan', 'mdi-file-document-multiple-outline', 'akademik_group', 'KBM & Akademik'],
            ['kelulusan-alumni', 'Status Kelulusan & Alumni', 'mdi-school-outline', 'akademik_group', 'KBM & Akademik'],
            ['kegiatan', 'Input Kegiatan', 'mdi-calendar-plus', 'absensi_group', 'Presensi & Kegiatan'],
            ['kegiatan-guru', 'Presensi Guru', 'mdi-account-tie-outline', 'absensi_group', 'Presensi & Kegiatan'],
            ['qrqode', 'Presensi Kegiatan', 'mdi-camera-front-variant', 'absensi_group', 'Presensi & Kegiatan'],
            ['istighosah', 'Presensi Istighosah', 'mdi-mosque', 'absensi_group', 'Presensi & Kegiatan'],
            ['setting-iuran', 'Setting Iuran', 'mdi-cash-sync', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['kasir', 'Loket Pembayaran', 'mdi-cash-register', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['pengajuan-pembayaran', 'Pengajuan Pembayaran', 'mdi-file-clock-outline', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['tunggakan-iuran', 'Tunggakan Iuran', 'mdi-file-alert-outline', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['tabungan', 'Tabungan Santri', 'mdi-wallet-outline', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['gaji-guru', 'Bisyaroh Guru', 'mdi-cash-check', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['kas-module', 'Kas & Jurnal', 'mdi-cash-multiple', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['laporan', 'Laporan Keuangan', 'mdi-chart-bar', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['tutup-buku', 'Tutup Buku Tahunan', 'mdi-book-lock-outline', 'keuangan_group', 'Keuangan & Pembayaran'],
            ['izin-sakit', 'Izin / Sakit Siswa', 'mdi-clipboard-text-clock-outline', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['izin-guru', 'Izin Guru & Badal', 'mdi-account-switch-outline', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['piket-pimpinan', 'Piket Pimpinan', 'mdi-shield-account-outline', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['siswi-haid', 'Siswi Haid', 'mdi-water-outline', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['prestasi-pelanggaran', 'Prestasi & Pelanggaran', 'mdi-trophy-outline', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['qr-santri', 'Peta QR Santri', 'mdi-qrcode', 'kesiswaan_group', 'Kesiswaan & Perizinan'],
            ['kalender-pendidikan', 'Kalender Pendidikan', 'mdi-calendar-month-outline', 'informasi_group', 'Informasi & Laporan'],
            ['rekap-absensi', 'Rekap Absensi', 'mdi-calendar-check-outline', 'informasi_group', 'Informasi & Laporan'],
            ['rekap-laporan', 'Rekap Laporan', 'mdi-chart-box-outline', 'informasi_group', 'Informasi & Laporan'],
            ['pengumuman', 'Pengumuman', 'mdi-bullhorn-outline', 'informasi_group', 'Informasi & Laporan'],
            ['notulen-rapat', 'Notulen Rapat', 'mdi-file-document-edit-outline', 'informasi_group', 'Informasi & Laporan'],
            ['inventaris', 'Inventaris Aset', 'mdi-package-variant-closed', 'informasi_group', 'Informasi & Laporan'],
            ['katalog-buku', 'Katalog Kitab & Buku', 'mdi-book-open-page-variant', 'perpustakaan_group', 'Perpustakaan'],
            ['sirkulasi-buku', 'Sirkulasi Peminjaman', 'mdi-hand-link-outline', 'perpustakaan_group', 'Perpustakaan'],
            ['denda-perpustakaan', 'Denda & Keterlambatan', 'mdi-alarm-panel-outline', 'perpustakaan_group', 'Perpustakaan'],
            ['setting-sekolah', 'Pengaturan Sekolah', 'mdi-school-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['pengguna', 'Data Pengguna', 'mdi-account-cog-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['akun-orang-tua', 'Akun Orang Tua', 'mdi-account-group-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['registrasi-masuk', 'Registrasi Akun', 'mdi-account-check-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['import-data', 'Import Data', 'mdi-file-import-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['import-jadwal', 'Import Jadwal', 'mdi-calendar-import', 'pengelola_group', 'Pengaturan & Sistem'],
            ['sinkronisasi-data', 'Sinkronisasi Data Santri', 'mdi-sync-alert', 'pengelola_group', 'Pengaturan & Sistem'],
            ['audit-logs', 'Audit Trail', 'mdi-history', 'pengelola_group', 'Pengaturan & Sistem'],
            ['backup-management', 'Backup Database', 'mdi-database-import-outline', 'pengelola_group', 'Pengaturan & Sistem'],
            ['change-password', 'Ubah Password', 'mdi-lock-reset', 'pengelola_group', 'Pengaturan & Sistem'],
            ['modul-setting', 'Pengaturan Modul', 'mdi-tune-variant', 'pengelola_group', 'Pengaturan & Sistem'],
        ];
        for (const mod of defaultModuls) {
            await db.execute({
                sql: "INSERT INTO modul_settings (modul_key, nama, icon, grup, grup_title) VALUES (?, ?, ?, ?, ?) " +
                     "ON DUPLICATE KEY UPDATE nama = VALUES(nama), icon = VALUES(icon), grup = VALUES(grup), grup_title = VALUES(grup_title)",
                args: mod
            });
        }

        console.log('✅ Skema MySQL (MariaDB) siap!');
    } catch (error) {
        console.error('❌ Gagal menginisialisasi database:', error.message);
        throw error;
    }

    return db;
};

const db = await initDb();
const dbReady = Promise.resolve(db);

export default db;
export { dbReady };