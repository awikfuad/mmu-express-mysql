import db from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import env from '../config/env.js';
import { parseTanggalLahir, tanggalSama } from '../utils/tanggalLahirHelper.js';
import { logAudit } from '../services/auditService.js';
import { saveLocalUpload } from '../config/upload.js';
import { verifyGoogleIdToken, findAccountByGoogleSub, findGoogleSubOwner, getAccountByRoleId, GoogleAuthError } from '../services/googleAuthService.js';
import { isLembagaValidService } from '../services/lembagaService.js';

// Format Date → 'YYYY-MM-DD HH:MM:SS' (MySQL DATETIME tidak menerima ISO 'T'/'Z').
const toMysqlDatetime = (date = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};

// FUNGSI BANTUAN GENERATE TOKEN (v2.4: family_id, expires_at, ip, user_agent)
const generateTokens = async (userId, role, name, lembaga, options = {}) => {
    const nonce = crypto.randomUUID();
    const familyId = options.familyId || crypto.randomUUID(); // login baru → family baru; rotate → family sama
    const refreshExpiresIn = '7d';
    const refreshExpiresAt = toMysqlDatetime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    // 1. Access Token (15 menit)
    const accessToken = jwt.sign(
        { id: userId, role, name, lembaga: lembaga || 'ALL', jti: nonce },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
    );

    // 2. Refresh Token (7 hari)
    const refreshToken = jwt.sign(
        { id: userId, role, lembaga: lembaga || 'ALL', jti: nonce, family_id: familyId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: refreshExpiresIn }
    );

    // 3. Simpan Refresh Token ke Database (dengan metadata)
    await db.execute({
        sql: "INSERT INTO refresh_tokens (user_id, role, token, family_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [userId, role, refreshToken, familyId, refreshExpiresAt, options.ip || null, options.userAgent || null]
    });

    return { accessToken, refreshToken, familyId };
};

// Guru yang juga terdaftar sebagai pimpinan aktif (tabel pimpinan → teachers.id).
// Dipakai utk menandai user login agar aplikasi Flutter bisa menawarkan "Mode Pimpinan".
const getPimpinanRoleInfo = async (userId, role) => {
    if (role !== 'teacher' || !userId) {
        console.log(`[PIMPINAN] getPimpinanRoleInfo -> bukan guru (userId=${userId}, role=${role})`);
        return { is_pimpinan: false, pimpinan_jabatan: null };
    }
    try {
        const res = await db.execute({
            sql: 'SELECT jabatan FROM pimpinan WHERE teacher_id = ? AND aktif = 1 LIMIT 1',
            args: [Number(userId)]
        });
        const row = res.rows[0];
        const info = row
            ? { is_pimpinan: true, pimpinan_jabatan: row.jabatan || null }
            : { is_pimpinan: false, pimpinan_jabatan: null };
        console.log(`[PIMPINAN] getPimpinanRoleInfo(userId=${userId}) -> ${JSON.stringify(info)} (baris=${res.rows.length})`);
        return info;
    } catch (error) {
        console.error('GET_PIMPINAN_ROLE_INFO ERROR:', error);
        return { is_pimpinan: false, pimpinan_jabatan: null };
    }
};

// 1. LOGIN ADMIN (WEB)
export const loginAdmin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    try {
        const result = await db.execute({
            sql: "SELECT * FROM admins WHERE username = ?",
            args: [username]
        });

        if (result.rows.length === 0) {
            await logAudit({ action: 'LOGIN_FAIL', module: 'AUTH', actor_name: username, detail: 'login admin', ip: req.ip });
            return res.status(401).json({ success: false, message: 'Username atau password salah' });
        }

        const admin = result.rows[0];
        const isPasswordMatch = bcrypt.compareSync(password, admin.password);
        
        if (!isPasswordMatch) {
            await logAudit({ lembaga: admin.lembaga, action: 'LOGIN_FAIL', module: 'AUTH', actor_id: admin.id, actor_name: admin.name, detail: 'login admin', ip: req.ip });
            return res.status(401).json({ success: false, message: 'Username atau password salah' });
        }

        // Generate sepasang token
        const { accessToken, refreshToken } = await generateTokens(admin.id, admin.role, admin.name, admin.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        await logAudit({ lembaga: admin.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: admin.role, actor_id: admin.id, actor_name: admin.name, detail: 'login admin', ip: req.ip });

        return res.json({
            success: true,
            message: 'Login Admin Berhasil!',
            accessToken,
            refreshToken, // Simpan ini di LocalStorage (Vue) / Secure Storage (Flutter)
            user: { id: admin.id, name: admin.name, username: admin.username, role: admin.role, lembaga: admin.lembaga || 'ALL' }
        });
    } catch (error) {
        console.error("LOG EROR INTERNAL:", error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 2. LOGIN SANTRI (FLUTTER)
export const loginStudent = async (req, res) => {
    const { nim, password } = req.body;

    if (!nim || !password) {
        return res.status(400).json({ success: false, message: 'NIM dan password wajib diisi' });
    }

    try {
        const result = await db.execute({
            sql: "SELECT * FROM students WHERE nim = ?",
            args: [nim]
        });

        if (result.rows.length === 0) {
            await logAudit({ action: 'LOGIN_FAIL', module: 'AUTH', actor_name: nim, detail: 'login santri', ip: req.ip });
            return res.status(401).json({ success: false, message: 'NIM atau password salah' });
        }

        const student = result.rows[0];
        const isPasswordMatch = bcrypt.compareSync(password, student.password);

        // Dukungan login dengan TANGGAL LAHIR sebagai password santri.
        // Tanggal lahir disimpan dengan beragam format, jadi dibandingkan secara tanggal (hari/bulan/tahun).
        let viaTanggalLahir = false;
        if (student.tanggal_lahir) {
            viaTanggalLahir = tanggalSama(
                parseTanggalLahir(student.tanggal_lahir),
                parseTanggalLahir(password)
            );
        }

        if (!isPasswordMatch && !viaTanggalLahir) {
            await logAudit({ lembaga: student.lembaga, action: 'LOGIN_FAIL', module: 'AUTH', actor_id: student.id, actor_name: student.name, detail: 'login santri', ip: req.ip });
            return res.status(401).json({ success: false, message: 'NIM atau password (tanggal lahir) salah' });
        }

        const { accessToken, refreshToken } = await generateTokens(student.id, student.role, student.name, student.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        await logAudit({ lembaga: student.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: student.role, actor_id: student.id, actor_name: student.name, detail: 'login santri', ip: req.ip });

        return res.json({
            success: true,
            message: 'Login Santri Berhasil!',
            accessToken,
            refreshToken,
                    user: { id: student.id, name: student.name, nim: student.nim, role: student.role, lembaga: student.lembaga || 'ALL', tanggal_lahir: student.tanggal_lahir || null, isDefaultPassword: viaTanggalLahir || password === env.defaultResetPassword || password === 'santri123' }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 2b. LOGIN ORANG TUA (Flutter)
export const loginParent = async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'No HP dan password wajib diisi' });
    }

    try {
        const result = await db.execute({
            sql: "SELECT * FROM parent_users WHERE phone = ?",
            args: [String(phone).trim()]
        });

        if (result.rows.length === 0) {
            await logAudit({ action: 'LOGIN_FAIL', module: 'AUTH', actor_name: phone, detail: 'login orang tua', ip: req.ip });
            return res.status(401).json({ success: false, message: 'No HP atau password salah' });
        }

        const parent = result.rows[0];
        const isPasswordMatch = bcrypt.compareSync(password, parent.password);

        if (!isPasswordMatch) {
            await logAudit({ lembaga: parent.lembaga, action: 'LOGIN_FAIL', module: 'AUTH', actor_id: parent.id, actor_name: parent.name, detail: 'login orang tua', ip: req.ip });
            return res.status(401).json({ success: false, message: 'No HP atau password salah' });
        }

        const { accessToken, refreshToken } = await generateTokens(parent.id, 'parent', parent.name, parent.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        await logAudit({ lembaga: parent.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: 'parent', actor_id: parent.id, actor_name: parent.name, detail: 'login orang tua', ip: req.ip });

        return res.json({
            success: true,
            message: 'Login Orang Tua Berhasil!',
            accessToken,
            refreshToken,
            user: { id: parent.id, name: parent.name, phone: parent.phone, role: 'parent', lembaga: parent.lembaga || 'ALL' }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// =========================================================================
// 🔗 PORTAL WALI + GURU (v3.40) — satu orang bisa merangkap guru & orang tua
// Relasi disimpan di parent_users.teacher_id (diisi lewat self-service oleh guru).
// PENTING: Google Sign-In tetap satu Google = satu identitas (aturan findGoogleSubOwner).
// =========================================================================

const normalizePhone = (phone) => {
    const clean = String(phone || '').replace(/[\s\-\(\)]/g, '').trim();
    return clean;
};

// Resolusi relasi parent↔guru utk role admin/teacher (hanya admin & teacher yg punya portal wali).
const findLinkedParentForTeacher = async (req) => {
    const result = await db.execute({
        sql: "SELECT id, phone, name, role, lembaga, teacher_id FROM parent_users WHERE teacher_id = ? LIMIT 1",
        args: [req.user.id]
    });
    return result.rows[0] || null;
};

// Data pribadi akun guru/admin yg sedang login (utk endpoint /auth/me/identities).
const getSelfAccount = async (req) => {
    const table = IDENTITY_TABLE_BY_ROLE[req.user?.role];
    if (!table) return null;
    const result = await db.execute({
        sql: `SELECT id, name, username, lembaga FROM ${table} WHERE id = ? LIMIT 1`,
        args: [req.user.id]
    });
    return result.rows[0] || null;
};

// GET /auth/me/identities — identitas guru (+ akun wali bila sudah dikaitkan)
export const getMyIdentities = async (req, res) => {
    try {
        const self = await getSelfAccount(req);
        if (!self) {
            return res.status(403).json({ success: false, message: 'Fitur ini hanya untuk guru/pimpinan.' });
        }
        const parent = await findLinkedParentForTeacher(req);
        const teacher = {
            id: self.id,
            name: self.name,
            username: self.username,
            role: req.user.role,
            lembaga: self.lembaga || 'ALL'
        };
        // Guru yang merangkap pimpinan — dipakai app utk menawarkan "Mode Pimpinan".
        if (req.user.role === 'teacher') {
            Object.assign(teacher, await getPimpinanRoleInfo(self.id, req.user.role));
        }
        console.log(`[PIMPINAN] getMyIdentities: teacher.send=${JSON.stringify(teacher)}`);
        return res.json({
            success: true,
            identities: {
                teacher: teacher,
                parent: parent
                    ? { id: parent.id, phone: parent.phone, name: parent.name, role: parent.role, lembaga: parent.lembaga || 'ALL' }
                    : null
            }
        });
    } catch (error) {
        console.error('GET_MY_IDENTITIES ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// POST /auth/me/parent-link — guru menghubungkan akun wali-nya sendiri via No HP
export const linkParentAccount = async (req, res) => {
    const { phone } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized) {
        return res.status(400).json({ success: false, message: 'No HP wali wajib diisi' });
    }
    if (!/^\d{10,15}$/.test(normalized)) {
        return res.status(400).json({ success: false, message: 'No HP tidak valid (10-15 digit)' });
    }

    try {
        const result = await db.execute({
            sql: "SELECT id, phone, name, lembaga, teacher_id FROM parent_users WHERE phone = ? LIMIT 1",
            args: [normalized]
        });
        if (result.rows.length === 0) {
            await logAudit({
                actor_role: req.user.role, actor_id: req.user.id, actor_name: req.user.name,
                action: 'LINK_PARENT_FAIL', module: 'AUTH', detail: `No HP ${normalized} tidak ditemukan di data wali`, ip: req.ip
            });
            return res.status(404).json({ success: false, message: 'No HP tidak terdaftar sebagai akun wali.' });
        }

        const parent = result.rows[0];
        // teacher_id menunjuk teachers.id; admin.id bisa bernilai sama angka-nya,
        // jadi hanya role 'teacher' yg boleh dianggap sebagai pemilik kaitan.
        const isOwnLink = parent.teacher_id != null
            && req.user.role === 'teacher'
            && Number(parent.teacher_id) === Number(req.user.id);
        if (parent.teacher_id != null && !isOwnLink) {
            return res.status(409).json({ success: false, message: `Akun wali "${parent.name}" sudah terhubung ke guru lain.` });
        }

        await db.execute({
            sql: "UPDATE parent_users SET teacher_id = ? WHERE id = ?",
            args: [req.user.id, parent.id]
        });

        await logAudit({
            lembaga: parent.lembaga || req.user.lembaga || 'ALL',
            action: 'LINK_PARENT', module: 'AUTH',
            actor_role: req.user.role, actor_id: req.user.id, actor_name: req.user.name,
            target_id: String(parent.id),
            detail: `menghubungkan akun wali "${parent.name}" (${parent.phone})`, ip: req.ip
        });

        return res.json({
            success: true,
            message: `Akun wali "${parent.name}" berhasil dihubungkan.`,
            parent: { id: parent.id, phone: parent.phone, name: parent.name, lembaga: parent.lembaga || 'ALL' }
        });
    } catch (error) {
        console.error('LINK_PARENT ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// DELETE /auth/me/parent-link — lepaskan kaitan akun wali
export const unlinkParentAccount = async (req, res) => {
    try {
        const parent = await findLinkedParentForTeacher(req);
        if (!parent) {
            return res.json({ success: true, message: 'Tidak ada akun wali yang terhubung.' });
        }
        await db.execute({
            sql: "UPDATE parent_users SET teacher_id = NULL WHERE id = ?",
            args: [parent.id]
        });
        await logAudit({
            lembaga: parent.lembaga || req.user.lembaga || 'ALL',
            action: 'UNLINK_PARENT', module: 'AUTH',
            actor_role: req.user.role, actor_id: req.user.id, actor_name: req.user.name,
            target_id: String(parent.id),
            detail: `memutuskan kaitan akun wali "${parent.name}" (${parent.phone})`, ip: req.ip
        });
        return res.json({ success: true, message: 'Kaitan akun wali berhasil diputuskan.' });
    } catch (error) {
        console.error('UNLINK_PARENT ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// POST /auth/switch-parent — login silang: guru masuk ke portal wali dgn token sendiri
export const switchToParent = async (req, res) => {
    try {
        const parent = await findLinkedParentForTeacher(req);
        if (!parent) {
            return res.status(404).json({ success: false, message: 'Akun wali belum terhubung. Hubungkan No HP wali terlebih dahulu.' });
        }

        const { accessToken, refreshToken } = await generateTokens(parent.id, 'parent', parent.name, parent.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        await logAudit({
            lembaga: parent.lembaga || req.user.lembaga || 'ALL',
            action: 'SWITCH_PARENT', module: 'AUTH',
            actor_role: req.user.role, actor_id: req.user.id, actor_name: req.user.name,
            target_id: String(parent.id),
            detail: `masuk ke portal wali "${parent.name}" (${parent.phone})`, ip: req.ip
        });

        return res.json({
            success: true,
            message: 'Login Portal Wali Berhasil!',
            accessToken,
            refreshToken,
            user: { id: parent.id, name: parent.name, phone: parent.phone, role: 'parent', lembaga: parent.lembaga || 'ALL' }
        });
    } catch (error) {
        console.error('SWITCH_PARENT ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 2. LOGIN SANTRI (FLUTTER)
export const loginTeacher = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    try {
        const result = await db.execute({
            sql: "SELECT * FROM teachers WHERE username = ?",
            args: [username]
        });

        if (result.rows.length === 0) {
            await logAudit({ action: 'LOGIN_FAIL', module: 'AUTH', actor_name: username, detail: 'login guru', ip: req.ip });
            return res.status(401).json({ success: false, message: 'Username atau password Guru salah' });
        }

        const teacher = result.rows[0];
        const isPasswordMatch = bcrypt.compareSync(password, teacher.password);
        
        if (!isPasswordMatch) {
            await logAudit({ lembaga: teacher.lembaga, action: 'LOGIN_FAIL', module: 'AUTH', actor_id: teacher.id, actor_name: teacher.name, detail: 'login guru', ip: req.ip });
            return res.status(401).json({ success: false, message: 'Username atau password Guru salah' });
        }

        const { accessToken, refreshToken } = await generateTokens(teacher.id, teacher.role, teacher.name, teacher.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        const pimpinanInfo = await getPimpinanRoleInfo(teacher.id, teacher.role);
        await logAudit({ lembaga: teacher.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: teacher.role, actor_id: teacher.id, actor_name: teacher.name, detail: 'login guru', ip: req.ip });

        return res.json({
            success: true,
            message: 'Login Guru Berhasil!',
            accessToken,
            refreshToken,
            user: { id: teacher.id, name: teacher.name, username: teacher.username, role: teacher.role, lembaga: teacher.lembaga || 'ALL', ...pimpinanInfo }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// LOGIN GABUNGAN (GURU & ADMIN) — Dipakai Aplikasi E-Presensi Asatidz (Flutter)
export const loginUnified = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
    }

    try {
        // 1. Cek tabel teachers dulu
        const teacherResult = await db.execute({
            sql: "SELECT * FROM teachers WHERE username = ?",
            args: [username]
        });

        if (teacherResult.rows.length > 0) {
            const teacher = teacherResult.rows[0];
            if (bcrypt.compareSync(password, teacher.password)) {
                const { accessToken, refreshToken } = await generateTokens(
                    teacher.id, teacher.role, teacher.name, teacher.lembaga || 'ALL',
                    { ip: req.ip, userAgent: req.headers['user-agent'] || null }
                );
                const pimpinanInfo = await getPimpinanRoleInfo(teacher.id, teacher.role);
                await logAudit({ lembaga: teacher.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: teacher.role, actor_id: teacher.id, actor_name: teacher.name, detail: 'login unified (guru)', ip: req.ip });
                return res.json({
                    success: true,
                    message: 'Login Guru Berhasil!',
                    accessToken,
                    refreshToken,
                    user: { id: teacher.id, name: teacher.name, username: teacher.username, role: teacher.role, lembaga: teacher.lembaga || 'ALL', ...pimpinanInfo }
                });
            }
        }

        // 2. Cek tabel admins
        const adminResult = await db.execute({
            sql: "SELECT * FROM admins WHERE username = ?",
            args: [username]
        });

        if (adminResult.rows.length > 0) {
            const admin = adminResult.rows[0];
            if (bcrypt.compareSync(password, admin.password)) {
                const { accessToken, refreshToken } = await generateTokens(
                    admin.id, admin.role, admin.name, admin.lembaga || 'ALL',
                    { ip: req.ip, userAgent: req.headers['user-agent'] || null }
                );
                await logAudit({ lembaga: admin.lembaga, action: 'LOGIN', module: 'AUTH', actor_role: admin.role, actor_id: admin.id, actor_name: admin.name, detail: 'login unified (admin)', ip: req.ip });
                return res.json({
                    success: true,
                    message: 'Login Admin Berhasil!',
                    accessToken,
                    refreshToken,
                    user: { id: admin.id, name: admin.name, username: admin.username, role: admin.role, lembaga: admin.lembaga || 'ALL' }
                });
            }
        }

        await logAudit({ action: 'LOGIN_FAIL', module: 'AUTH', actor_name: username, detail: 'login unified', ip: req.ip });
        return res.status(401).json({ success: false, message: 'Username atau password salah' });
    } catch (error) {
        console.error("LOG EROR INTERNAL (loginUnified):", error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 2. REGISTRASI GURU / USTADZ BARU (Ditembak dari Vue Admin Dashboard) — foto optional, minimal
export const registerTeacher = async (req, res) => {
    const { username, name, password, lembaga, foto } = req.body;

    // 1. Validasi Input Dasar
    if (!username || !name || !password) {
        return res.status(400).json({ success: false, message: 'Username, nama, dan password wajib diisi' });
    }

    // Guru HARUS punya lembaga spesifik (MADRASAH atau TPQ) — TIDAK BOLEH ALL.
    // Hanya Super Admin (lembaga ALL di tabel admins) yang boleh pilih lembaga guru.
    // Admin scoped dipaksa ke lembaganya sendiri.
    const adminLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    let lembagaFinal;
    if (adminLembaga !== 'ALL') {
        // Admin scoped → paksa guru ke lembaga admin
        lembagaFinal = adminLembaga;
    } else {
        // Super Admin → wajib pilih lembaga (MADRASAH/TPQ), default MADRASAH
        lembagaFinal = lembaga ? lembaga.toUpperCase() : 'MADRASAH';
    }
    // Guru tidak boleh ALL — hanya MADRASAH atau TPQ
    if (lembagaFinal === 'ALL') {
        return res.status(400).json({ success: false, message: 'Guru harus ditugaskan ke lembaga MADRASAH atau TPQ. ALL hanya untuk Super Admin.' });
    }
    if (!(await isLembagaValidService(lembagaFinal))) {
        return res.status(400).json({ success: false, message: 'Lembaga tidak valid! Pilih MADRASAH atau TPQ.' });
    }

    try {
        // 2. Cek apakah Username Guru sudah pernah terdaftar sebelumnya di database
        const checkUser = await db.execute({
            sql: "SELECT id FROM teachers WHERE username = ?",
            args: [username]
        });

        if (checkUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Username guru sudah terdaftar di sistem' });
        }

        // 3. Amankan password guru dengan melakukan Hashing (Bcrypt)
        const hashedPassword = bcrypt.hashSync(password, 10);

        // 4. Foto optional (upload file atau string URL dari client)
        let fotoPath = null;
        if (req.file) {
            fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-guru');
        } else if (foto) {
            fotoPath = String(foto).trim() || null;
        }

        // 5. Masukkan data guru baru ke tabel 'teachers'
        await db.execute({
            sql: "INSERT INTO teachers (username, name, password, role, lembaga, foto) VALUES (?, ?, ?, ?, ?, ?)",
            args: [username, name, hashedPassword, 'teacher', lembagaFinal, fotoPath]
        });

        return res.status(200).json({
            success: true,
            message: `🎉 Ustadz "${name}" berhasil didaftarkan ke sistem database pesantren!`
        });

    } catch (error) {
        console.error("LOG EROR INTERNAL REGISTER GURU:", error);
        return res.status(500).json({ 
            success: false, 
            message: 'Gagal mendaftarkan guru karena gangguan server internal', 
            error: error.message 
        });
    }
};
// 2.5 REGISTRASI ADMIN BARU (Khusus Super Admin / lembaga ALL)
export const registerAdmin = async (req, res) => {
    const { username, name, password, lembaga, foto } = req.body;

    // 1. Validasi Input Dasar
    if (!username || !name || !password) {
        return res.status(400).json({ success: false, message: 'Username, nama, dan password wajib diisi' });
    }

    // 2. Hanya Super Admin (ALL) yang boleh membuat akun admin baru
    const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (callerLembaga !== 'ALL') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat mendaftarkan admin baru.' });
    }

    const lembagaFinal = lembaga ? lembaga.toUpperCase() : 'ALL';
    if (!(await isLembagaValidService(lembagaFinal))) {
        return res.status(400).json({ success: false, message: 'Lembaga tidak valid! Pilih ALL, MADRASAH, atau TPQ.' });
    }

    try {
        // 3. Cek username admin belum terdaftar
        const checkUser = await db.execute({
            sql: "SELECT id FROM admins WHERE username = ?",
            args: [username]
        });
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Username admin sudah terdaftar di sistem' });
        }

        // 4. Hash password
        const hashedPassword = bcrypt.hashSync(password, 10);

        // 5. Foto optional
        let fotoPath = null;
        if (req.file) {
            fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-admin');
        } else if (foto) {
            fotoPath = String(foto).trim() || null;
        }

        // 6. Simpan admin baru
        await db.execute({
            sql: "INSERT INTO admins (username, name, password, role, lembaga, foto) VALUES (?, ?, ?, 'admin', ?, ?)",
            args: [username, name, hashedPassword, lembagaFinal, fotoPath]
        });

        return res.status(200).json({
            success: true,
            message: `🎉 Admin "${name}" (lembaga ${lembagaFinal}) berhasil didaftarkan!`
        });
    } catch (error) {
        console.error("LOG EROR REGISTER ADMIN:", error);
        return res.status(500).json({
            success: false,
            message: 'Gagal mendaftarkan admin karena gangguan server internal',
            error: error.message
        });
    }
};

// AMBIL SEMUA DATA ADMIN (Khusus Super Admin / lembaga ALL)
export const getAdmins = async (req, res) => {
    try {
        // Hanya Super Admin (ALL) yang boleh melihat daftar admin
        const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        if (callerLembaga !== 'ALL') {
            return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat melihat data admin.' });
        }

        const result = await db.execute({
            sql: "SELECT id, username, name, role, lembaga, foto FROM admins ORDER BY id DESC"
        });

        return res.status(200).json({
            success: true,
            message: 'Berhasil memuat daftar admin',
            data: result.rows
        });
    } catch (error) {
        console.error("LOG EROR GET ADMIN:", error);
        return res.status(500).json({
            success: false,
            message: 'Gagal memuat data admin karena gangguan server internal',
            error: error.message
        });
    }
};

// UPDATE ADMIN (name, lembaga, optional password, foto optional) — hanya Super Admin (ALL)
export const updateAdmin = async (req, res) => {
    const { id } = req.params;
    const { name, password, lembaga, foto } = req.body;

    const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (callerLembaga !== 'ALL') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat mengubah data admin.' });
    }

    let lembagaFinal = null;
    if (lembaga) {
        const lembagaInput = lembaga.toUpperCase();
        if (!(await isLembagaValidService(lembagaInput))) {
            return res.status(400).json({ success: false, message: 'Lembaga tidak valid! Pilih ALL, MADRASAH, atau TPQ.' });
        }
        lembagaFinal = lembagaInput;
    }

    try {
        const check = await db.execute({
            sql: "SELECT id, lembaga FROM admins WHERE id = ?",
            args: [id]
        });
        if (check.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin tidak ditemukan.' });
        }
        const target = check.rows[0];

        // Cegah menurunkan hak lembaga Super Admin yang terakhir (agar tidak terkunci)
        if (lembagaFinal && lembagaFinal !== 'ALL' && (target.lembaga || 'ALL') === 'ALL') {
            const superAdmins = await db.execute({ sql: "SELECT COUNT(*) AS total FROM admins WHERE lembaga = 'ALL'" });
            if (Number(superAdmins.rows[0]?.total || 0) <= 1) {
                return res.status(400).json({ success: false, message: 'Tidak dapat mengubah lembaga Super Admin terakhir.' });
            }
        }

        const updates = [];
        const args = [];
        if (name) {
            updates.push('name = ?');
            args.push(name);
        }
        if (lembagaFinal) {
            updates.push('lembaga = ?');
            args.push(lembagaFinal);
        }
        if (password) {
            const hashedPassword = bcrypt.hashSync(password, 10);
            updates.push('password = ?');
            args.push(hashedPassword);
        }
        // Foto optional (file upload atau string)
        let fotoPath = null;
        if (req.file) {
            fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-admin');
            updates.push('foto = ?');
            args.push(fotoPath);
        } else if (foto !== undefined) {
            // foto = '' untuk hapus, foto string untuk set manual (dari import)
            const v = String(foto).trim();
            updates.push('foto = ?');
            args.push(v || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada data yang diubah' });
        }

        args.push(id);
        await db.execute({
            sql: `UPDATE admins SET ${updates.join(', ')} WHERE id = ?`,
            args
        });

        if (password) {
            await logAudit({
                lembaga: callerLembaga,
                action: 'RESET_PASSWORD',
                module: 'AUTH',
                actor_role: 'admin',
                actor_id: req.user.id,
                actor_name: req.user.username || req.user.name,
                target_id: String(id),
                detail: 'Password admin direset oleh Super Admin',
                ip: req.ip
            });
        }

        return res.json({ success: true, message: 'Data admin berhasil diperbarui' });
    } catch (error) {
        console.error("LOG EROR UPDATE ADMIN:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// HAPUS ADMIN — hanya Super Admin (ALL); dilarang hapus akun sendiri & Super Admin terakhir
export const deleteAdmin = async (req, res) => {
    const { id } = req.params;

    const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (callerLembaga !== 'ALL') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat menghapus akun admin.' });
    }

    try {
        if (Number(id) === Number(req.user.id)) {
            return res.status(400).json({ success: false, message: 'Tidak dapat menghapus akun yang sedang digunakan.' });
        }

        const check = await db.execute({
            sql: "SELECT lembaga FROM admins WHERE id = ?",
            args: [id]
        });
        if (check.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Admin tidak ditemukan.' });
        }

        if ((check.rows[0].lembaga || 'ALL') === 'ALL') {
            const superAdmins = await db.execute({ sql: "SELECT COUNT(*) AS total FROM admins WHERE lembaga = 'ALL'" });
            if (Number(superAdmins.rows[0]?.total || 0) <= 1) {
                return res.status(400).json({ success: false, message: 'Tidak dapat menghapus Super Admin terakhir.' });
            }
        }

        await db.execute({ sql: "DELETE FROM admins WHERE id = ?", args: [id] });
        return res.json({ success: true, message: 'Admin berhasil dihapus' });
    } catch (error) {
        console.error("LOG EROR DELETE ADMIN:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 3. AMBIL SEMUA DATA GURU (Ditembak oleh Vue Admin untuk Tabel View)
// import db from '../config/db.js';
// import { getLembagaByKodeService } from '../services/lembagaService.js';

export const getTeachers = async (req, res) => {
    try {
        const callerLembaga = String(req.user?.lembaga || 'ALL').toUpperCase();
        let targetLembaga = callerLembaga;

        // Super Admin (ALL) dapat memfilter data guru sesuai parameter ?lembaga=<kode>
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
        
        // Filter case-insensitive: menampilkan guru khusus lembaga terpilih atau yang bersifat 'ALL'/lintas lembaga
        const whereClause = isAll
            ? ''
            : 'WHERE LOWER(lembaga) = LOWER(?) OR LOWER(lembaga) = \'all\' OR lembaga IS NULL OR lembaga = \'\'';
            
        const args = isAll ? [] : [targetLembaga];

        const result = await db.execute({
            sql: `SELECT id, username, name, lembaga, foto, google_sub, google_email 
                  FROM teachers ${whereClause} 
                  ORDER BY name ASC`,
            args
        });

        return res.status(200).json({
            success: true,
            message: 'Berhasil memuat daftar dewan guru',
            lembaga: targetLembaga,
            data: result.rows
        });

    } catch (error) {
        console.error("LOG EROR INTERNAL GET GURU:", error);
        return res.status(500).json({
            success: false,
            message: 'Gagal memuat data guru karena gangguan server internal',
            error: error.message
        });
    }
};
// 3. FUNGSI UNTUK REFRESH TOKEN (v2.4: rotasi single-use + deteksi token kompromi)
export const handleRefreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ success: false, message: 'Refresh token tidak ditemukan' });
    }

    try {
        // 1. Decode JWT dulu (untuk dapat family_id walaupun token sudah dihapus dari DB)
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        } catch (err) {
            // Token expired/invalid secara kriptografi → hapus dari DB bila ada
            await db.execute({ sql: "DELETE FROM refresh_tokens WHERE token = ?", args: [refreshToken] });
            return res.status(403).json({ success: false, message: 'Refresh token kadaluwarsa, silakan login ulang' });
        }

        // 2. Cek apakah token masih ada di DB (single-use: bila sudah di-rotate, token lama dihapus)
        const dbResult = await db.execute({
            sql: "SELECT * FROM refresh_tokens WHERE token = ?",
            args: [refreshToken]
        });

        if (dbResult.rows.length === 0) {
            // Token TIDAK ada di DB tapi JWT valid → kemungkinan sudah di-rotate → REUSE!
            const familyId = decoded.family_id;
            if (familyId) {
                // Revoke semua token dalam family ini (kompromi)
                await db.execute({
                    sql: "DELETE FROM refresh_tokens WHERE family_id = ?",
                    args: [familyId]
                });
                await logAudit({
                    lembaga: decoded.lembaga || 'ALL',
                    action: 'TOKEN_REUSE_DETECTED',
                    module: 'AUTH',
                    actor_role: decoded.role,
                    actor_id: decoded.id,
                    actor_name: 'token-theft-suspected',
                    detail: `family_id=${familyId}`,
                    ip: req.ip
                });
            }
            return res.status(403).json({ success: false, message: 'Refresh token sudah tidak berlaku (sudah diganti). Kemungkinan akun kompromi — semua sesi telah dicabut.' });
        }

        // 3. Token ada di DB → gunakan untuk rotasi
        const existingToken = dbResult.rows[0];
        const familyId = existingToken.family_id || decoded.family_id || crypto.randomUUID();

        // 4. Hapus token lama (single-use)
        await db.execute({
            sql: "DELETE FROM refresh_tokens WHERE token = ?",
            args: [refreshToken]
        });

        // 5. Cleanup expired tokens dalam family yang sama (housekeeping)
        await db.execute({
            sql: "DELETE FROM refresh_tokens WHERE family_id = ? AND expires_at < NOW()",
            args: [familyId]
        }).catch(() => {});

        // 6. Ambil data user terupdate
        const tableName = decoded.role === 'admin' ? 'admins'
                        : decoded.role === 'teacher' ? 'teachers'
                        : decoded.role === 'parent' ? 'parent_users'
                        : 'students';
        const userResult = await db.execute({
            sql: `SELECT id, name, role, lembaga FROM ${tableName} WHERE id = ?`,
            args: [decoded.id]
        });

        if (userResult.rows.length === 0) {
            return res.status(403).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = userResult.rows[0];
        const pimpinanInfo = await getPimpinanRoleInfo(user.id, user.role);

        // 7. Buat access token baru + refresh token baru (rotasi — family_id sama)
        const nonce = crypto.randomUUID();
        const newAccessToken = jwt.sign(
            { id: user.id, role: user.role, name: user.name, lembaga: user.lembaga || 'ALL', jti: nonce },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        const refreshExpiresAt = toMysqlDatetime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        const newRefreshToken = jwt.sign(
            { id: user.id, role: user.role, lembaga: user.lembaga || 'ALL', jti: nonce, family_id: familyId },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        // 8. Simpan refresh token baru
        await db.execute({
            sql: "INSERT INTO refresh_tokens (user_id, role, token, family_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
            args: [user.id, user.role, newRefreshToken, familyId, refreshExpiresAt, req.ip, req.headers['user-agent'] || null]
        });

        return res.json({
            success: true,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            user: { id: user.id, name: user.name, role: user.role, lembaga: user.lembaga || 'ALL', ...pimpinanInfo }
        });

    } catch (error) {
        console.error('REFRESH_TOKEN ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};


// 4. FUNGSI LOGOUT (v2.4: revoke token spesifik atau seluruh family)
export const logout = async (req, res) => {
    const { refreshToken, revokeAll } = req.body;
    try {
        if (revokeAll && refreshToken) {
            // Revoke seluruh family (logout dari semua perangkat)
            try {
                const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
                if (decoded.family_id) {
                    await db.execute({
                        sql: "DELETE FROM refresh_tokens WHERE family_id = ?",
                        args: [decoded.family_id]
                    });
                } else {
                    // Token lama tanpa family_id → revoke semua token user
                    await db.execute({
                        sql: "DELETE FROM refresh_tokens WHERE user_id = ? AND role = ?",
                        args: [decoded.id, decoded.role]
                    });
                }
            } catch {
                // Token expired → coba revoke by token string
                await db.execute({
                    sql: "DELETE FROM refresh_tokens WHERE token = ?",
                    args: [refreshToken]
                });
            }
        } else if (refreshToken) {
            // Revoke token spesifik saja
            await db.execute({
                sql: "DELETE FROM refresh_tokens WHERE token = ?",
                args: [refreshToken]
            });
        }
        return res.json({ success: true, message: 'Berhasil keluar, sesi dihapus.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// UPDATE GURU (name, lembaga, optional password, foto optional minimal)
export const updateTeacher = async (req, res) => {
    const { id } = req.params;
    const { name, password, lembaga, foto } = req.body;

    // Hanya Super Admin (ALL) boleh ubah lembaga; scoped admin hanya boleh edit name
    const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();

    let lembagaFinal = null;
    if (lembaga) {
        const lembagaInput = lembaga.toUpperCase();
        if (lembagaInput === 'ALL') {
            return res.status(400).json({ success: false, message: 'Guru tidak boleh lembaga ALL. ALL hanya untuk Super Admin.' });
        }
        if (!(await isLembagaValidService(lembagaInput))) {
            return res.status(400).json({ success: false, message: 'Lembaga tidak valid!' });
        }
        if (callerLembaga !== 'ALL') {
            return res.status(403).json({ success: false, message: 'Hanya Super Admin yang boleh mengubah lembaga.' });
        }
        lembagaFinal = lembagaInput;
    }

    try {
        const updates = [];
        const args = [];

        if (name) {
            updates.push('name = ?');
            args.push(name);
        }
        if (lembagaFinal) {
            updates.push('lembaga = ?');
            args.push(lembagaFinal);
        }
        if (password) {
            const hashedPassword = bcrypt.hashSync(password, 10);
            updates.push('password = ?');
            args.push(hashedPassword);
        }
        // Foto optional (file upload minimal, optional)
        if (req.file) {
            const fotoPath = await saveLocalUpload(req.file.buffer, req.file.originalname, 'foto-guru');
            updates.push('foto = ?');
            args.push(fotoPath);
        } else if (foto !== undefined) {
            const v = String(foto).trim();
            updates.push('foto = ?');
            args.push(v || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada data yang diubah' });
        }

        args.push(id);
        await db.execute({
            sql: `UPDATE teachers SET ${updates.join(', ')} WHERE id = ?`,
            args
        });

        if (password) {
            await logAudit({
                lembaga: callerLembaga,
                action: 'RESET_PASSWORD',
                module: 'AUTH',
                actor_role: 'admin',
                actor_id: req.user.id,
                actor_name: req.user.username || req.user.name,
                target_id: String(id),
                detail: 'Password guru direset oleh admin',
                ip: req.ip
            });
        }

        return res.json({ success: true, message: 'Data guru berhasil diperbarui' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// HAPUS GURU
export const deleteTeacher = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute({ sql: "DELETE FROM teachers WHERE id = ?", args: [id] });
        return res.json({ success: true, message: 'Guru berhasil dihapus' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// CHANGE PASSWORD (admin, teacher, user)
export const changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const role = req.user.role;
    const lembaga = req.user.lembaga || 'ALL';

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });
    }

    try {
        let table, idCol;
        if (role === 'admin') {
            table = 'admins';
            idCol = 'id';
        } else if (role === 'teacher') {
            table = 'teachers';
            idCol = 'id';
        } else if (role === 'parent') {
            table = 'parent_users';
            idCol = 'id';
        } else if (role === 'user') {
            table = 'students';
            idCol = 'id';
        } else {
            return res.status(400).json({ success: false, message: 'Role tidak valid' });
        }

        const result = await db.execute({
            sql: `SELECT password FROM ${table} WHERE ${idCol} = ?`,
            args: [userId]
        });

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
        }

        const user = result.rows[0];
        const isMatch = bcrypt.compareSync(currentPassword, user.password);

        if (!isMatch) {
            await logAudit({ lembaga, action: 'CHANGE_PASSWORD_FAIL', module: 'AUTH', actor_role: role, actor_id: userId, actor_name: req.user.name || req.user.username, detail: 'wrong current password', ip: req.ip });
            return res.status(400).json({ success: false, message: 'Password lama tidak sesuai' });
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        await db.execute({
            sql: `UPDATE ${table} SET password = ? WHERE ${idCol} = ?`,
            args: [hashedPassword, userId]
        });

        // Revoke all refresh tokens for security
        await db.execute({
            sql: "DELETE FROM refresh_tokens WHERE user_id = ? AND role = ?",
            args: [userId, role]
        });

        await logAudit({ lembaga, action: 'CHANGE_PASSWORD', module: 'AUTH', actor_role: role, actor_id: userId, actor_name: req.user.name || req.user.username, detail: 'password changed successfully', ip: req.ip });

        return res.json({ success: true, message: 'Password berhasil diubah. Silakan login ulang.' });
    } catch (error) {
        console.error('CHANGE_PASSWORD ERROR:', error);
        return res.status(500).json({ success: false, message: 'Gagal mengubah password', error: error.message });
    }
};

// RESET PASSWORD SANTRI (admin only) — reset ke tanggal lahir (default)
export const resetStudentPassword = async (req, res) => {
    const { id } = req.params; // id dari santri_penempatan / murid_kelas
    const { newPassword } = req.body;
    const actorLembaga = (req.user?.lembaga || 'ALL').toUpperCase();

    // Tanpa newPassword → reset ke password default terkonfigurasi (DEFAULT_RESET_PASSWORD).
    const finalPassword = newPassword || env.defaultResetPassword;

    if (newPassword && newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });
    }

    try {
        // 1. Cari santri di santri_penempatan (gabungan murid_kelas + santri_kelas)
        const placement = await db.execute({
            sql: `SELECT id, nim, sumber FROM santri_penempatan WHERE id = ?`,
            args: [id]
        });

        if (placement.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Santri tidak ditemukan atau akses ditolak' });
        }

        const { nim } = placement.rows[0];

        // 2. Cari baris di students (tabel login santri) berdasarkan NIM
        const student = await db.execute({
            sql: 'SELECT id, name, lembaga FROM students WHERE nim = ?',
            args: [nim]
        });

        if (student.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Akun login santri tidak ditemukan' });
        }

        const studentData = student.rows[0];

        // 3. Validasi scoping lembaga
        if (actorLembaga !== 'ALL') {
            const studentLembaga = (studentData.lembaga || 'ALL').toUpperCase();
            if (studentLembaga !== 'ALL' && studentLembaga !== actorLembaga) {
                return res.status(403).json({ success: false, message: 'Tidak memiliki akses untuk mereset password santri ini' });
            }
        }

        // 4. Hash & update password
        const hashedPassword = bcrypt.hashSync(finalPassword, 10);
        await db.execute({
            sql: 'UPDATE students SET password = ? WHERE id = ?',
            args: [hashedPassword, studentData.id]
        });

        // 5. Revoke semua refresh token santri (paksa login ulang)
        await db.execute({
            sql: 'DELETE FROM refresh_tokens WHERE user_id = ? AND role = ?',
            args: [studentData.id, 'user']
        });

        // 6. Audit log
        await logAudit({
            lembaga: actorLembaga,
            action: 'RESET_PASSWORD',
            module: 'AUTH',
            actor_role: 'admin',
            actor_id: req.user.id,
            actor_name: req.user.username || req.user.name,
            target_id: String(studentData.id),
            detail: `Password santri "${studentData.name}" (NIM: ${nim}) direset oleh admin${newPassword ? '' : ' (password default)'}`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: newPassword
                ? `Password santri "${studentData.name}" berhasil direset`
                : `Password santri "${studentData.name}" berhasil direset ke password default`
        });
    } catch (error) {
        console.error('RESET_STUDENT_PASSWORD ERROR:', error);
        return res.status(500).json({ success: false, message: 'Gagal mereset password santri', error: error.message });
    }
};

// =========================================================================
// 🔐 GOOGLE SIGN-IN (admin & guru — v3.26)
// Strategi: akun MMU + akun Google ditautkan manual. Cukup satu kali login
// dengan username/password → hubungkan Google di menu Profil. Setelah itu
// login berikutnya cukup lewat tombol Google (tanpa password).
// =========================================================================

const IDENTITY_TABLE_BY_ROLE = { admin: 'admins', teacher: 'teachers', parent: 'parent_users' };

// LOGIN dengan Google (tanpa token) — wajib akun sudah pernah me-link google_sub
export const loginGoogle = async (req, res) => {
    const { idToken } = req.body;

    try {
        const identity = await verifyGoogleIdToken(idToken);
        const match = await findAccountByGoogleSub(identity.sub);

        if (!match) {
            // Cek apakah ada permintaan registrasi Google yang belum/ sudah diproses admin (v3.29)
            const regResult = await db.execute({
                sql: "SELECT id, status FROM google_registrations WHERE google_sub = ? LIMIT 1",
                args: [identity.sub]
            });
            const reg = regResult.rows[0];

            if (reg && reg.status === 'PENDING') {
                await logAudit({
                    action: 'LOGIN_FAIL',
                    module: 'AUTH_GOOGLE',
                    actor_name: identity.email || identity.sub,
                    detail: 'login google — registrasi menunggu konfirmasi admin',
                    ip: req.ip
                });
                return res.status(403).json({
                    success: false,
                    message: 'Registrasi Anda sedang menunggu konfirmasi admin. Silakan coba lagi setelah akun disetujui.',
                    registrationPending: true,
                    google_email: identity.email
                });
            }

            if (reg && reg.status === 'REJECTED') {
                await logAudit({
                    action: 'LOGIN_FAIL',
                    module: 'AUTH_GOOGLE',
                    actor_name: identity.email || identity.sub,
                    detail: 'login google — registrasi ditolak admin',
                    ip: req.ip
                });
                return res.status(403).json({
                    success: false,
                    message: 'Permintaan registrasi Anda ditolak oleh admin. Silakan daftar ulang atau hubungi admin sekolah.',
                    registrationRejected: true,
                    google_email: identity.email
                });
            }

            await logAudit({
                action: 'LOGIN_FAIL',
                module: 'AUTH_GOOGLE',
                actor_name: identity.email || identity.sub,
                detail: 'login google — akun belum terhubung',
                ip: req.ip
            });
            return res.status(401).json({
                success: false,
                message: 'Akun Google ini belum terhubung ke akun MMU mana pun. Login dengan username/password, lalu hubungkan Google di menu Profil.',
                needLink: true,
                google_email: identity.email
            });
        }

        const account = match.account;
        const { accessToken, refreshToken } = await generateTokens(account.id, account.role, account.name, account.lembaga, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null
        });

        const pimpinanInfo = await getPimpinanRoleInfo(account.id, account.role);
        await logAudit({
            lembaga: account.lembaga,
            action: 'LOGIN',
            module: 'AUTH_GOOGLE',
            actor_role: account.role,
            actor_id: account.id,
            actor_name: account.name,
            detail: `login google (${identity.email || identity.sub})`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: 'Login Google Berhasil!',
            accessToken,
            refreshToken,
            user: {
                id: account.id,
                name: account.name,
                username: account.username,
                role: account.role,
                lembaga: account.lembaga || 'ALL',
                google_email: account.google_email || null,
                google_linked: true,
                ...pimpinanInfo
            }
        });
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        console.error('LOGIN_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// TAUTKAN akun Google ke akun admin/guru saat ini (mutlak sudah login password dulu)
export const linkGoogle = async (req, res) => {
    const { idToken } = req.body;
    const table = IDENTITY_TABLE_BY_ROLE[req.user?.role];

    if (!table) {
        return res.status(403).json({ success: false, message: 'Tautkan Google hanya untuk admin & guru.' });
    }

    try {
        const identity = await verifyGoogleIdToken(idToken);

        // Larang sub yang sudah dipakai akun lain (cek lintas admin & guru)
        const owner = await findGoogleSubOwner(identity.sub, { excludeTable: table, excludeId: req.user.id });
        if (owner) {
            return res.status(409).json({
                success: false,
                message: `Akun Google "${identity.email}" sudah terhubung ke akun lain. Putuskan tautan dari akun lama terlebih dahulu.`
            });
        }

        // Cegah tautan ganda akun yang sama (google_sub sudah terisi sub lain)
        const me = await getAccountByRoleId({ table, id: req.user.id });
        if (me.google_sub && me.google_sub !== identity.sub) {
            return res.status(400).json({
                success: false,
                message: `Akun ini sudah terhubung ke Google "${me.google_email || me.google_sub}". Putuskan tautan dulu sebelum menghubungkan akun Google lain.`
            });
        }

        await db.execute({
            sql: `UPDATE ${table} SET google_sub = ?, google_email = ? WHERE id = ?`,
            args: [identity.sub, identity.email, req.user.id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'LINK_GOOGLE',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            detail: `menghubungkan akun google ${identity.email || identity.sub}`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: `Akun Google "${identity.email || identity.sub}" berhasil terhubung.`,
            google_email: identity.email,
            google_linked: true
        });
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        console.error('LINK_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// PUTUS tautan Google dari akun sendiri
export const unlinkGoogle = async (req, res) => {
    const table = IDENTITY_TABLE_BY_ROLE[req.user?.role];
    if (!table) {
        return res.status(403).json({ success: false, message: 'Tautkan Google hanya untuk admin & guru.' });
    }

    try {
        await db.execute({
            sql: `UPDATE ${table} SET google_sub = NULL, google_email = NULL WHERE id = ?`,
            args: [req.user.id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'UNLINK_GOOGLE',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            detail: 'memutuskan tautan akun google',
            ip: req.ip
        });

        return res.json({ success: true, message: 'Tautan Google berhasil diputus.' });
    } catch (error) {
        console.error('UNLINK_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// STATUS konfigurasi & tautan Google akun yang sedang login (untuk menu Profil)
export const getGoogleAuthStatus = async (req, res) => {
    const table = IDENTITY_TABLE_BY_ROLE[req.user?.role];
    try {
        let linked = false;
        let google_email = null;
        if (table) {
            const me = await getAccountByRoleId({ table, id: req.user.id });
            linked = Boolean(me.google_sub);
            google_email = me.google_email || null;
        }
        return res.json({
            success: true,
            configured: Boolean(env.googleClientId),
            linked,
            google_email,
            role_supported: Boolean(table)
        });
    } catch (error) {
        console.error('GOOGLE_AUTH_STATUS ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── ADMIN: TAUTKAN akun Google ke akun guru tertentu (v3.27) ───
// Admin (di web) memilih akun Google milik guru di popup GIS → idToken dikirim ke sini.
// Berlaku hanya admin; scoping lembaga diikuti (super admin bebas, scoped dibatasi lembaganya + ALL).
const resolveTeacherScope = async (id) => {
    const result = await db.execute({
        sql: `SELECT id, username, name, lembaga, google_sub, google_email
              FROM teachers WHERE id = ? LIMIT 1`,
        args: [id]
    });
    if (result.rows.length === 0) {
        return { error: { status: 404, message: 'Guru tidak ditemukan' } };
    }
    return { teacher: result.rows[0] };
};

const assertCanManageTeacher = (req, teacher) => {
    const callerLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (callerLembaga !== 'ALL') {
        const tLembaga = (teacher.lembaga || 'ALL').toUpperCase();
        if (tLembaga !== callerLembaga && tLembaga !== 'ALL') {
            return { error: { status: 403, message: 'Anda tidak memiliki akses ke guru lembaga lain.' } };
        }
    }
    return {};
};

// PUT /api/teachers/:id/google — admin menghubungkan akun Google milik guru
export const linkTeacherGoogle = async (req, res) => {
    const { id } = req.params;
    const { idToken } = req.body;

    try {
        const scoped = await resolveTeacherScope(id);
        if (scoped.error) {
            return res.status(scoped.error.status).json({ success: false, message: scoped.error.message });
        }
        const teacher = scoped.teacher;

        const access = assertCanManageTeacher(req, teacher);
        if (access.error) {
            return res.status(access.error.status).json({ success: false, message: access.error.message });
        }

        const identity = await verifyGoogleIdToken(idToken);

        // Larang sub yang sudah dipakai akun lain (lintas admin & guru)
        const owner = await findGoogleSubOwner(identity.sub, { excludeTable: 'teachers', excludeId: id });
        if (owner) {
            return res.status(409).json({
                success: false,
                message: `Akun Google "${identity.email}" sudah terhubung ke akun lain. Putuskan tautan dari akun lama terlebih dahulu.`
            });
        }

        // Cegah tautan ganda akun yang sama (google_sub sudah terisi sub lain)
        if (teacher.google_sub && teacher.google_sub !== identity.sub) {
            return res.status(400).json({
                success: false,
                message: `Akun guru "${teacher.name}" sudah terhubung ke Google "${teacher.google_email || teacher.google_sub}". Putuskan tautan dulu sebelum menghubungkan akun Google lain.`
            });
        }

        await db.execute({
            sql: `UPDATE teachers SET google_sub = ?, google_email = ? WHERE id = ?`,
            args: [identity.sub, identity.email, id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'LINK_GOOGLE',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            target_id: String(id),
            detail: `admin menautkan akun google ${identity.email || identity.sub} ke guru ${teacher.name}`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: `Akun Google "${identity.email || identity.sub}" berhasil terhubung ke guru "${teacher.name}".`,
            google_email: identity.email,
            google_linked: true
        });
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        console.error('LINK_TEACHER_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// DELETE /api/teachers/:id/google — admin memutuskan tautan Google milik guru
export const unlinkTeacherGoogle = async (req, res) => {
    const { id } = req.params;

    try {
        const scoped = await resolveTeacherScope(id);
        if (scoped.error) {
            return res.status(scoped.error.status).json({ success: false, message: scoped.error.message });
        }
        const teacher = scoped.teacher;

        const access = assertCanManageTeacher(req, teacher);
        if (access.error) {
            return res.status(access.error.status).json({ success: false, message: access.error.message });
        }

        await db.execute({
            sql: `UPDATE teachers SET google_sub = NULL, google_email = NULL WHERE id = ?`,
            args: [id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'UNLINK_GOOGLE',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            target_id: String(id),
            detail: `admin memutuskan tautan google dari guru ${teacher.name}`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: `Tautan Google dari guru "${teacher.name}" berhasil diputus.`
        });
    } catch (error) {
        console.error('UNLINK_TEACHER_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// =========================================================================
// 📝 REGISTRASI GOOGLE + KONFIRMASI ADMIN (v3.29)
// Pemohon mendaftar via akun Google (web / mobi lebih lanjut). Admin
// mengkonfirmasi dengan MENAUTKAN google_sub ke akun lokal yang sudah ada
// (guru / orang tua) — menyerupai alur tautkan Google di menu Profil.
// =========================================================================

export const REGISTRATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

// Helpers scope lembaga — super admin (ALL) bebas, admin scoped dibatasi lembaganya + ALL
const isForbiddenTargetScope = (callerLembaga, targetLembaga) => {
    const caller = (callerLembaga || 'ALL').toUpperCase();
    if (caller === 'ALL') return false;
    const target = (targetLembaga || 'ALL').toUpperCase();
    return target !== caller && target !== 'ALL';
};

const resolveLocalAccount = async ({ target_role, target_id, callerLembaga }) => {
    if (target_role === 'teacher') {
        const r = await db.execute({
            sql: "SELECT id, username, name, lembaga, google_sub, google_email FROM teachers WHERE id = ? LIMIT 1",
            args: [target_id]
        });
        if (r.rows.length === 0) return { error: { status: 404, message: 'Guru tidak ditemukan' } };
        const acc = r.rows[0];
        if (isForbiddenTargetScope(callerLembaga, acc.lembaga)) {
            return { error: { status: 403, message: 'Anda tidak memiliki akses ke guru lembaga lain.' } };
        }
        if (acc.google_sub) {
            return { error: { status: 400, message: `Guru "${acc.name}" sudah terhubung ke Google. Putuskan tautan dulu sebelum menghubungkan akun baru.` } };
        }
        return { table: 'teachers', label: 'guru', account: acc };
    }
    if (target_role === 'parent') {
        const r = await db.execute({
            sql: "SELECT id, phone, name, lembaga, google_sub, google_email FROM parent_users WHERE id = ? LIMIT 1",
            args: [target_id]
        });
        if (r.rows.length === 0) return { error: { status: 404, message: 'Akun orang tua tidak ditemukan' } };
        const acc = r.rows[0];
        if (isForbiddenTargetScope(callerLembaga, acc.lembaga)) {
            return { error: { status: 403, message: 'Anda tidak memiliki akses ke akun orang tua lembaga lain.' } };
        }
        if (acc.google_sub) {
            return { error: { status: 400, message: `Akun orang tua "${acc.name}" sudah terhubung ke Google. Putuskan tautan dulu sebelum menghubungkan akun baru.` } };
        }
        return { table: 'parent_users', label: 'orang tua', account: acc };
    }
    return { error: { status: 400, message: 'Tipe akun target tidak valid. Pilih teacher atau parent.' } };
};

// POST /api/auth/register-google — PUBLIK: daftar via Google (menunggu konfirmasi admin)
export const registerGoogle = async (req, res) => {
    const { idToken, catatan } = req.body;

    try {
        const identity = await verifyGoogleIdToken(idToken);

        // 1. Google sudah terhubung ke akun MMU? Tidak perlu (dan tidak boleh) daftar lagi.
        const match = await findAccountByGoogleSub(identity.sub);
        if (match) {
            await logAudit({
                action: 'REGISTER_GOOGLE',
                module: 'AUTH_GOOGLE',
                actor_name: identity.name || identity.email || identity.sub,
                detail: 'pengajuan registrasi ditolak — google sudah terhubung ke akun',
                ip: req.ip
            });
            return res.status(409).json({
                success: false,
                message: `Akun Google "${identity.email || identity.sub}" sudah terhubung ke akun ${match.role}. Tidak perlu mendaftar ulang.`
            });
        }

        // 2. Cek permintaan yang pernah/sedang ada untuk sub ini
        const existing = await db.execute({
            sql: "SELECT id, status FROM google_registrations WHERE google_sub = ? LIMIT 1",
            args: [identity.sub]
        });
        const row = existing.rows[0];

        if (row && row.status === 'PENDING') {
            return res.status(409).json({
                success: false,
                message: 'Akun Google ini sudah terdaftar dan sedang menunggu konfirmasi admin.',
                registrationPending: true
            });
        }
        if (row && row.status === 'APPROVED') {
            return res.status(409).json({
                success: false,
                message: 'Akun Google ini sudah disetujui dan terhubung ke akun MMU.'
            });
        }

        let registrationId;
        if (row) {
            // REJECTED → izinkan daftar ulang (kembalikan status ke PENDING)
            await db.execute({
                sql: "UPDATE google_registrations SET google_email = ?, name = ?, picture = ?, catatan = ?, status = 'PENDING', reviewed_at = NULL, reviewed_by = NULL WHERE id = ?",
                args: [identity.email, identity.name, identity.picture, catatan || null, row.id]
            });
            registrationId = row.id;
        } else {
            const inserted = await db.execute({
                sql: "INSERT INTO google_registrations (google_sub, google_email, name, picture, catatan) VALUES (?, ?, ?, ?, ?)",
                args: [identity.sub, identity.email, identity.name, identity.picture, catatan || null]
            });
            registrationId = Number(inserted.lastInsertRowid);
        }

        await logAudit({
            action: 'REGISTER_GOOGLE',
            module: 'AUTH_GOOGLE',
            actor_name: identity.name || identity.email || identity.sub,
            target_id: String(registrationId),
            detail: `pengajuan registrasi google (${identity.email || identity.sub})`,
            ip: req.ip
        });

        return res.status(201).json({
            success: true,
            message: 'Pendaftaran berhasil! Registrasi Anda sedang menunggu konfirmasi admin.',
            registrationPending: true,
            registration_id: registrationId
        });
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        console.error('REGISTER_GOOGLE ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// GET /api/registrations — daftar permintaan registrasi (admin)
export const getRegistrations = async (req, res) => {
    const { status, search } = req.query;

    try {
        const where = [];
        const args = [];
        if (status && REGISTRATION_STATUSES.includes(String(status).toUpperCase())) {
            where.push('status = ?');
            args.push(String(status).toUpperCase());
        }
        if (search && String(search).trim()) {
            where.push('(name LIKE ? OR google_email LIKE ?)');
            args.push(`%${search}%`, `%${search}%`);
        }
        const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const [listResult, countsResult] = await Promise.all([
            db.execute({
                sql: `SELECT id, google_sub, google_email, name, picture, catatan, status,
                             created_at, reviewed_at, reviewed_by
                      FROM google_registrations ${whereSql}
                      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, id DESC`,
                args
            }),
            db.execute({
                sql: "SELECT status, COUNT(*) AS total FROM google_registrations GROUP BY status"
            })
        ]);

        const summary = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
        for (const row of countsResult.rows) {
            summary[row.status] = Number(row.total || 0);
        }

        return res.json({ success: true, data: listResult.rows, summary });
    } catch (error) {
        console.error('GET_REGISTRATIONS ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// POST /api/registrations/:id/approve — setujui & tautkan ke akun lokal (guru/parent)
export const approveRegistration = async (req, res) => {
    const { id } = req.params;
    const { target_role, target_id, catatan } = req.body;

    try {
        const reg = await db.execute({
            sql: "SELECT * FROM google_registrations WHERE id = ? LIMIT 1",
            args: [id]
        });
        if (reg.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permintaan registrasi tidak ditemukan' });
        }
        const registration = reg.rows[0];
        if (registration.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Permintaan ini sudah diproses oleh admin.' });
        }
        if (!target_role || !target_id) {
            return res.status(400).json({ success: false, message: 'Pilih akun lokal (guru atau orang tua) yang akan ditautkan.' });
        }

        const resolved = await resolveLocalAccount({
            target_role,
            target_id: Number(target_id),
            callerLembaga: req.user?.lembaga
        });
        if (resolved.error) {
            return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
        }
        const { table, label, account } = resolved;

        // Cegah sub yang sudah dipakai akun lain (lintas admin & guru & orang tua)
        const owner = await findGoogleSubOwner(registration.google_sub, { excludeTable: table, excludeId: account.id });
        if (owner) {
            return res.status(409).json({
                success: false,
                message: `Akun Google "${registration.google_email || registration.google_sub}" sudah terhubung ke akun lain. Putuskan tautan dari akun lama terlebih dahulu.`
            });
        }

        await db.execute({
            sql: `UPDATE ${table} SET google_sub = ?, google_email = ? WHERE id = ?`,
            args: [registration.google_sub, registration.google_email, account.id]
        });

        await db.execute({
            sql: "UPDATE google_registrations SET status = 'APPROVED', reviewed_at = NOW(), reviewed_by = ?, catatan = COALESCE(?, catatan) WHERE id = ?",
            args: [req.user.name || req.user.username || 'admin', catatan || null, id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'APPROVE_REGISTRATION',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            target_id: String(id),
            detail: `menyetujui registrasi ${registration.name || registration.google_email} → ditautkan ke ${table} "${account.name}"`,
            ip: req.ip
        });

        return res.json({
            success: true,
            message: `Registrasi "${registration.name || registration.google_email}" disetujui dan terhubung ke akun ${label} "${account.name}".`
        });
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        console.error('APPROVE_REGISTRATION ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// POST /api/registrations/:id/reject — tolak permintaan (bisa daftar ulang)
export const rejectRegistration = async (req, res) => {
    const { id } = req.params;
    const { catatan } = req.body;

    try {
        const reg = await db.execute({
            sql: "SELECT name, google_email, status FROM google_registrations WHERE id = ? LIMIT 1",
            args: [id]
        });
        if (reg.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permintaan registrasi tidak ditemukan' });
        }
        const registration = reg.rows[0];
        if (registration.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Permintaan ini sudah diproses oleh admin.' });
        }

        await db.execute({
            sql: "UPDATE google_registrations SET status = 'REJECTED', reviewed_at = NOW(), reviewed_by = ?, catatan = ? WHERE id = ?",
            args: [req.user.name || req.user.username || 'admin', catatan || null, id]
        });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'REJECT_REGISTRATION',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            target_id: String(id),
            detail: `menolak registrasi ${registration.name || registration.google_email}${catatan ? ` — ${catatan}` : ''}`,
            ip: req.ip
        });

        return res.json({ success: true, message: `Registrasi "${registration.name || registration.google_email}" ditolak.` });
    } catch (error) {
        console.error('REJECT_REGISTRATION ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// DELETE /api/registrations/:id — hapus permanen riwayat permintaan (admin)
export const deleteRegistration = async (req, res) => {
    const { id } = req.params;

    try {
        const reg = await db.execute({
            sql: "SELECT id FROM google_registrations WHERE id = ?",
            args: [id]
        });
        if (reg.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permintaan registrasi tidak ditemukan' });
        }
        await db.execute({ sql: "DELETE FROM google_registrations WHERE id = ?", args: [id] });

        await logAudit({
            lembaga: req.user.lembaga || 'ALL',
            action: 'DELETE_REGISTRATION',
            module: 'AUTH_GOOGLE',
            actor_role: req.user.role,
            actor_id: req.user.id,
            actor_name: req.user.name || req.user.username,
            target_id: String(id),
            detail: 'menghapus permintaan registrasi google',
            ip: req.ip
        });

        return res.json({ success: true, message: 'Permintaan registrasi dihapus.' });
    } catch (error) {
        console.error('DELETE_REGISTRATION ERROR:', error);
        return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};