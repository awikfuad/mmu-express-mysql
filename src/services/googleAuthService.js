import { OAuth2Client } from 'google-auth-library';
import db from '../config/db.js';
import env from '../config/env.js';

// Error dengan HTTP status agar controller bisa langsung memetakan respons.
export class GoogleAuthError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const client = new OAuth2Client(env.googleClientId || undefined);
const ACCOUNT_TABLES = [
    { table: 'admins', role: 'admin' },
    { table: 'teachers', role: 'teacher' },
    { table: 'parent_users', role: 'parent' },
];

// Verifikasi ID token Google. Kembalikan identitas terverifikasi (sub/email/nama/picture).
// Throw GoogleAuthError bila client id belum disetel atau token tidak valid.
export const verifyGoogleIdToken = async (idToken, { googleClientId } = {}) => {
    const aud = googleClientId || env.googleClientId;
    if (!aud) {
        throw new GoogleAuthError(503, 'Login Google belum dikonfigurasi. Admin: isi GOOGLE_CLIENT_ID di lingkungan server.');
    }
    if (!idToken || typeof idToken !== 'string') {
        throw new GoogleAuthError(400, 'idToken Google wajib dikirim');
    }

    let payload;
    try {
        const ticket = await client.verifyIdToken({ idToken, audience: aud });
        payload = ticket.getPayload();
    } catch (error) {
        throw new GoogleAuthError(401, `Token Google tidak valid atau bukan untuk audiensi aplikasi ini: ${error.message}`);
    }

    if (!payload || !payload.sub) {
        throw new GoogleAuthError(401, 'Token Google tidak valid (tidak berisi sub).');
    }

    return {
        sub: payload.sub,
        email: payload.email || null,
        name: payload.name || null,
        picture: payload.picture || null,
    };
};

// Kolom yang dipilih per tabel akun (parent_users tak punya username/foto).
const ACCOUNT_SELECT = (table) => {
    if (table === 'parent_users') {
        return 'id, NULL AS username, name, role, lembaga, NULL AS foto, google_sub, google_email';
    }
    return 'id, username, name, role, lembaga, foto, google_sub, google_email';
};

// Cari akun admin/guru/orang tua yang sudah ditautkan dengan google_sub tertentu.
// Kembalikan null bila belum ada akun yang terhubung.
export const findAccountByGoogleSub = async (sub) => {
    for (const { table, role } of ACCOUNT_TABLES) {
        const result = await db.execute({
            sql: `SELECT ${ACCOUNT_SELECT(table)}
                  FROM ${table} WHERE google_sub = ? LIMIT 1`,
            args: [sub]
        });
        if (result.rows.length > 0) {
            return { table, role, account: result.rows[0] };
        }
    }
    return null;
};

// Cek apakah google_sub sudah dipakai akun LAIN di lembaga mana pun (mencegah pencurian tautan).
export const findGoogleSubOwner = async (sub, { excludeTable, excludeId } = {}) => {
    for (const { table, role } of ACCOUNT_TABLES) {
        const args = [sub];
        let excludeSql = '';
        if (excludeTable === table && excludeId != null) {
            excludeSql = ' AND id <> ?';
            args.push(excludeId);
        }
        const result = await db.execute({
            sql: `SELECT id, table_name FROM (
                      SELECT id, '${table}' AS table_name FROM ${table} WHERE google_sub = ?${excludeSql}
                  ) AS owner WHERE 1=1 LIMIT 1`,
            args
        });
        if (result.rows.length > 0) {
            return { table, id: result.rows[0].id };
        }
    }
    return null;
};

// Ambil data akun sendiri (admin/teacher) untuk pengecekan status tautan Google.
export const getAccountByRoleId = async ({ table, id }) => {
    if (!ACCOUNT_TABLES.some((t) => t.table === table)) {
        throw new GoogleAuthError(400, 'Peran akun tidak didukung untuk Google Sign-In.');
    }
    const result = await db.execute({
        sql: `SELECT ${ACCOUNT_SELECT(table)}
              FROM ${table} WHERE id = ? LIMIT 1`,
        args: [id]
    });
    if (result.rows.length === 0) {
        throw new GoogleAuthError(404, 'Akun tidak ditemukan');
    }
    return result.rows[0];
};