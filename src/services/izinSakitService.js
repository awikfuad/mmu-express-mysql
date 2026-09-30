import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Ambil lembaga & sumber tabel (madrasah/tpq)
const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq,
        sumber: s.sumber
    };
};

// Ambil nama murid dari tabel penempatan gabungan (fallback ke students / data induk)
const nameExpr = (alias) => `
    COALESCE(
        (SELECT name FROM santri_penempatan WHERE nim = ${alias}.nim LIMIT 1),
        (SELECT name FROM students WHERE nim = ${alias}.nim LIMIT 1)
    ) AS student_name
`;

const classExpr = (alias) => `
    (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = ${alias}.nim LIMIT 1) AS class_name
`;

export const JENIS_IZIN = ['IZIN', 'SAKIT'];
export const STATUS_IZIN = ['MENUNGGU', 'DISETUJUI', 'DITOLAK'];

const toUpper = (v) => (v ? String(v).toUpperCase() : null);

const isValidDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00`);
    return !isNaN(d.getTime());
};

// Cari akun siswa (students) untuk resolve nim & lembaga
const resolveStudent = async (studentId) => {
    const res = await db.execute({
        sql: `SELECT id, nim, name, lembaga FROM students WHERE id = ?`,
        args: [Number(studentId)]
    });
    return res.rows[0] || null;
};

// List catatan izin/sakit (filter jenis/status/rentang tanggal/cari, terscope lembaga)
export const getIzinSakitService = async ({ jenis, status, tanggal_from, tanggal_to, search }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (jenis) {
        const jenisFinal = toUpper(jenis);
        if (!JENIS_IZIN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_IZIN.join(', ')}`);
        conditions.push('iz.jenis = ?');
        args.push(jenisFinal);
    }
    if (status) {
        const statusFinal = toUpper(status);
        if (!STATUS_IZIN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_IZIN.join(', ')}`);
        conditions.push('iz.status = ?');
        args.push(statusFinal);
    }
    if (tanggal_from) {
        conditions.push('iz.tanggal_selesai >= ?');
        args.push(tanggal_from);
    }
    if (tanggal_to) {
        conditions.push('iz.tanggal_mulai <= ?');
        args.push(tanggal_to);
    }
    if (search && String(search).trim()) {
        conditions.push('(iz.nim LIKE ? OR iz.alasan LIKE ?)');
        const like = `%${String(search).trim()}%`;
        args.push(like, like);
    }
    if (!ctx.isAll) {
        conditions.push('iz.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT iz.id, iz.student_id, iz.nim, iz.jenis, iz.alasan,
               iz.tanggal_mulai, iz.tanggal_selesai, iz.keterangan,
               iz.status, iz.disetujui_oleh, iz.lembaga, iz.created_at, iz.updated_at,
               ${nameExpr('iz')},
               ${classExpr('iz')}
        FROM izin_sakit iz
        ${whereClause}
        ORDER BY iz.tanggal_mulai DESC, iz.id DESC
    `;
    const result = await db.execute({ sql: query, args });
    return result.rows;
};

// Simpan catatan izin/sakit (admin/teacher)
export const createIzinSakitService = async ({ student_id, jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan, status }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const jenisFinal = toUpper(jenis);
    const alasanFinal = String(alasan || '').trim();
    const mulaiFinal = String(tanggal_mulai || '').trim();
    const selesaiFinal = String(tanggal_selesai || '').trim();

    if (!student_id) throw new Error('Siswa wajib dipilih');
    if (!jenisFinal || !JENIS_IZIN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_IZIN.join(', ')}`);
    if (!alasanFinal) throw new Error('Alasan wajib diisi');
    if (!isValidDate(mulaiFinal)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
    if (!isValidDate(selesaiFinal)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
    if (mulaiFinal > selesaiFinal) throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');

    let statusFinal = toUpper(status);
    if (statusFinal && !STATUS_IZIN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_IZIN.join(', ')}`);
    if (!statusFinal) statusFinal = 'MENUNGGU';

    const student = await resolveStudent(student_id);
    if (!student) throw new Error('Siswa tidak ditemukan');
    // Admin scoped tidak boleh membuat catatan untuk siswa lembaga lain (legacy 'ALL' diperbolehkan)
    if (!ctx.isAll && student.lembaga && student.lembaga !== 'ALL' && student.lembaga !== ctx.lembaga) {
        throw new Error('Siswa bukan milik lembaga Anda');
    }

    const rowLembaga = ctx.isAll ? (student.lembaga || 'ALL') : ctx.lembaga;

    const result = await db.execute({
        sql: `
            INSERT INTO izin_sakit
                (student_id, nim, jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan, status, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            Number(student.id),
            student.nim || null,
            jenisFinal,
            alasanFinal,
            mulaiFinal,
            selesaiFinal,
            keterangan || null,
            statusFinal,
            rowLembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah catatan izin/sakit (data & status persetujuan, admin/teacher)
export const updateIzinSakitService = async (id, { jenis, alasan, tanggal_mulai, tanggal_selesai, keterangan, status }, lembaga = 'ALL', actorName = null) => {
    const ctx = getContext(lembaga);
    const updates = [];
    const args = [];

    if (jenis !== undefined) {
        const jenisFinal = toUpper(jenis);
        if (!JENIS_IZIN.includes(jenisFinal)) throw new Error(`Jenis tidak valid! Pilih: ${JENIS_IZIN.join(', ')}`);
        updates.push('jenis = ?');
        args.push(jenisFinal);
    }
    if (alasan !== undefined) {
        const alasanFinal = String(alasan || '').trim();
        if (!alasanFinal) throw new Error('Alasan wajib diisi');
        updates.push('alasan = ?');
        args.push(alasanFinal);
    }
    if (tanggal_mulai !== undefined) {
        const tgl = String(tanggal_mulai || '').trim();
        if (!isValidDate(tgl)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
        updates.push('tanggal_mulai = ?');
        args.push(tgl);
    }
    if (tanggal_selesai !== undefined) {
        const tgl = String(tanggal_selesai || '').trim();
        if (!isValidDate(tgl)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
        updates.push('tanggal_selesai = ?');
        args.push(tgl);
    }
    if (keterangan !== undefined) {
        updates.push('keterangan = ?');
        args.push(keterangan || null);
    }
    if (status !== undefined) {
        const statusFinal = toUpper(status);
        if (!STATUS_IZIN.includes(statusFinal)) throw new Error(`Status tidak valid! Pilih: ${STATUS_IZIN.join(', ')}`);
        updates.push('status = ?');
        args.push(statusFinal);
        updates.push('disetujui_oleh = ?');
        args.push(statusFinal === 'DISETUJUI' ? (actorName || null) : null);
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    // Validasi urutan tanggal bila keduanya diubah sekaligus
    if (tanggal_mulai !== undefined && tanggal_selesai !== undefined) {
        if (String(tanggal_mulai).trim() > String(tanggal_selesai).trim()) {
            throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');
        }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE izin_sakit SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus catatan izin/sakit (admin, terscope lembaga)
export const deleteIzinSakitService = async (id, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM izin_sakit WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};
