import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { masehiToHijri, hijriMonthDays, hijriahTahunPelajaran, BULAN_HIJRIYAH_NAMES } from '../utils/hijriyahHelper.js';

// Kalender Pendidikan (B.5) — agenda tahunan per lembaga berbasis tahun Hijriyah.

export const KATEGORI_KALENDER = ['EFEKTIF', 'LIBUR', 'UJIAN', 'KEGIATAN'];
export const SEMESTER_KALENDER = ['IMDA 1', 'IMDA 2', 'IMDA 3'];

const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq
    };
};

const isValidDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00`);
    return !isNaN(d.getTime());
};

const scopeWhere = (ctx, alias) => {
    if (ctx.isAll) return '';
    return `AND ${alias}.lembaga = ?`;
};

const scopeArgs = (ctx) => (ctx.isAll ? [] : [ctx.lembaga]);

// List agenda kalender pendidikan (filter tahun ajaran/semester/kategori, terscope lembaga)
export const getKalenderService = async ({ academic_year_id, semester, kategori }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);
    const conditions = [];
    const args = [];

    if (academic_year_id) {
        conditions.push('k.academic_year_id = ?');
        args.push(Number(academic_year_id));
    }
    if (semester) {
        const sem = String(semester).toUpperCase();
        if (!SEMESTER_KALENDER.includes(sem)) throw new Error(`Semester tidak valid! Pilih: ${SEMESTER_KALENDER.join(', ')}`);
        conditions.push('k.semester = ?');
        args.push(sem);
    }
    if (kategori) {
        const kat = String(kategori).toUpperCase();
        if (!KATEGORI_KALENDER.includes(kat)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_KALENDER.join(', ')}`);
        conditions.push('k.kategori = ?');
        args.push(kat);
    }

    let sql = `
        SELECT k.id, k.academic_year_id, a.year_name, k.semester, k.kategori, k.judul,
               k.tanggal_mulai, k.tanggal_selesai, k.hijriyah_mulai, k.hijriyah_selesai,
               k.keterangan, k.lembaga, k.source, k.external_uid, k.created_at
        FROM kalender_pendidikan k
        LEFT JOIN academic_years a ON k.academic_year_id = a.id
    `;
    if (conditions.length || !ctx.isAll) {
        const conds = conditions.slice();
        if (!ctx.isAll) conds.push('k.lembaga = ?');
        sql += ` WHERE ${conds.join(' AND ')}`;
    }
    sql += ` ORDER BY k.tanggal_mulai ASC, k.id ASC`;
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({ sql, args });
    return result.rows;
};

// Simpan agenda (admin/teacher, terscope lembaga)
export const createKalenderService = async ({ academic_year_id, semester, kategori, judul, tanggal_mulai, tanggal_selesai, keterangan, lembaga }, lembagaPemanggil = 'ALL') => {
    const ctx = getContext(lembagaPemanggil);
    const semFinal = String(semester || 'IMDA 1').toUpperCase();
    const katFinal = String(kategori || 'KEGIATAN').toUpperCase();
    const judulFinal = String(judul || '').trim();
    const mulaiFinal = String(tanggal_mulai || '').trim();
    const selesaiFinal = String(tanggal_selesai || '').trim();

    if (!SEMESTER_KALENDER.includes(semFinal)) throw new Error(`Semester tidak valid! Pilih: ${SEMESTER_KALENDER.join(', ')}`);
    if (!KATEGORI_KALENDER.includes(katFinal)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_KALENDER.join(', ')}`);
    if (!judulFinal) throw new Error('Judul agenda wajib diisi');
    if (!isValidDate(mulaiFinal)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
    if (!isValidDate(selesaiFinal)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
    if (mulaiFinal > selesaiFinal) throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');

    const rowLembaga = ctx.isAll ? (String(lembaga || 'ALL').toUpperCase() || 'ALL') : ctx.lembaga;
    const hijriyahMulai = masehiToHijri(mulaiFinal);
    const hijriyahSelesai = masehiToHijri(selesaiFinal);

    const result = await db.execute({
        sql: `
            INSERT INTO kalender_pendidikan
                (academic_year_id, semester, kategori, judul, tanggal_mulai, tanggal_selesai,
                 hijriyah_mulai, hijriyah_selesai, keterangan, lembaga)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            academic_year_id ? Number(academic_year_id) : null,
            semFinal,
            katFinal,
            judulFinal,
            mulaiFinal,
            selesaiFinal,
            hijriyahMulai ? hijriyahMulai.full : null,
            hijriyahSelesai ? hijriyahSelesai.full : null,
            keterangan || null,
            rowLembaga
        ]
    });
    return { id: Number(result.lastInsertRowid) };
};

// Ubah agenda (admin/teacher, terscope lembaga)
export const updateKalenderService = async (id, fields, lembagaPemanggil = 'ALL') => {
    const ctx = getContext(lembagaPemanggil);
    const updates = [];
    const args = [];

    const apply = (field, value, validate = null) => {
        const finalValue = validate ? validate(value) : value;
        updates.push(`${field} = ?`);
        args.push(finalValue);
    };

    if (fields.academic_year_id !== undefined) {
        apply('academic_year_id', fields.academic_year_id ? Number(fields.academic_year_id) : null);
    }
    if (fields.semester !== undefined) {
        const sem = String(fields.semester).toUpperCase();
        if (!SEMESTER_KALENDER.includes(sem)) throw new Error(`Semester tidak valid! Pilih: ${SEMESTER_KALENDER.join(', ')}`);
        apply('semester', sem);
    }
    if (fields.kategori !== undefined) {
        const kat = String(fields.kategori).toUpperCase();
        if (!KATEGORI_KALENDER.includes(kat)) throw new Error(`Kategori tidak valid! Pilih: ${KATEGORI_KALENDER.join(', ')}`);
        apply('kategori', kat);
    }
    if (fields.judul !== undefined) {
        const judul = String(fields.judul || '').trim();
        if (!judul) throw new Error('Judul agenda wajib diisi');
        apply('judul', judul);
    }
    if (fields.keterangan !== undefined) {
        apply('keterangan', fields.keterangan || null);
    }
    if (fields.lembaga !== undefined && ctx.isAll) {
        apply('lembaga', String(fields.lembaga || 'ALL').toUpperCase() || 'ALL');
    }

    // Tanggal berubah → hitung ulang label Hijriyah
    if (fields.tanggal_mulai !== undefined || fields.tanggal_selesai !== undefined) {
        const existing = await db.execute({ sql: 'SELECT tanggal_mulai, tanggal_selesai FROM kalender_pendidikan WHERE id = ?', args: [Number(id)] });
        const row = existing.rows[0];
        if (!row) throw new Error('Agenda tidak ditemukan');
        const mulai = fields.tanggal_mulai !== undefined ? String(fields.tanggal_mulai).trim() : row.tanggal_mulai;
        const selesai = fields.tanggal_selesai !== undefined ? String(fields.tanggal_selesai).trim() : row.tanggal_selesai;
        if (!isValidDate(mulai)) throw new Error('Tanggal mulai tidak valid (gunakan YYYY-MM-DD)');
        if (!isValidDate(selesai)) throw new Error('Tanggal selesai tidak valid (gunakan YYYY-MM-DD)');
        if (mulai > selesai) throw new Error('Tanggal mulai tidak boleh melewati tanggal selesai');

        if (fields.tanggal_mulai !== undefined) {
            apply('tanggal_mulai', mulai);
            const hm = masehiToHijri(mulai);
            apply('hijriyah_mulai', hm ? hm.full : null);
        }
        if (fields.tanggal_selesai !== undefined) {
            apply('tanggal_selesai', selesai);
            const hs = masehiToHijri(selesai);
            apply('hijriyah_selesai', hs ? hs.full : null);
        }
    }

    if (updates.length === 0) throw new Error('Tidak ada data yang diubah');

    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    args.push(Number(id));
    if (!ctx.isAll) args.push(ctx.lembaga);

    const result = await db.execute({
        sql: `UPDATE kalender_pendidikan SET ${updates.join(', ')} WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Hapus agenda (admin, terscope lembaga)
export const deleteKalenderService = async (id, lembagaPemanggil = 'ALL') => {
    const ctx = getContext(lembagaPemanggil);
    const whereClause = ctx.isAll ? 'id = ?' : 'id = ? AND lembaga = ?';
    const args = ctx.isAll ? [Number(id)] : [Number(id), ctx.lembaga];
    const result = await db.execute({
        sql: `DELETE FROM kalender_pendidikan WHERE ${whereClause}`,
        args
    });
    return result.rowsAffected > 0;
};

// Label tahun pelajaran Hijriyah untuk suatu tahun ajaran (contoh: '1447/1448')
export const getTahunHijriyahService = async (academic_year_id) => {
    const result = await db.execute({
        sql: 'SELECT id, year_name, semester, is_active FROM academic_years WHERE id = ?',
        args: [Number(academic_year_id)]
    });
    const row = result.rows[0];
    if (!row) throw new Error('Tahun ajaran tidak ditemukan');
    return {
        academic_year_id: row.id,
        year_name: row.year_name,
        tahun_hijriyah: hijriahTahunPelajaran(row.year_name) || '',
        semester: row.semester
    };
};

// Grid bulan Hijriyah: daftar hari Masehi dalam satu bulan Hijriyah + agenda yang menabrak
export const getKalenderGridService = async ({ hijri_year, hijri_month, academic_year_id }, lembaga = 'ALL', now = null) => {
    const ctx = getContext(lembaga);
    let year = Number(hijri_year);
    let month = Number(hijri_month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        const ref = masehiToHijri(now || new Date().toISOString().slice(0, 10));
        if (!ref) throw new Error('Gagal menentukan bulan Hijriyah saat ini');
        year = ref.year;
        month = ref.month;
    }
    if (year < 1300 || year > 1600) throw new Error('Tahun Hijriyah tidak valid');

    const days = hijriMonthDays(year, month);
    if (days.length === 0) throw new Error('Bulan Hijriyah tidak valid');

    const startISO = days[0].date;
    const endISO = days[days.length - 1].date;

    const conditions = ['k.tanggal_selesai >= ?', 'k.tanggal_mulai <= ?'];
    const args = [startISO, endISO];
    if (academic_year_id) {
        conditions.push('k.academic_year_id = ?');
        args.push(Number(academic_year_id));
    }
    if (!ctx.isAll) {
        conditions.push('k.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const result = await db.execute({
        sql: `
            SELECT k.id, k.academic_year_id, a.year_name, k.semester, k.kategori, k.judul,
                   k.tanggal_mulai, k.tanggal_selesai, k.hijriyah_mulai, k.hijriyah_selesai, k.keterangan
            FROM kalender_pendidikan k
            LEFT JOIN academic_years a ON k.academic_year_id = a.id
            WHERE ${conditions.join(' AND ')}
            ORDER BY k.tanggal_mulai ASC
        `,
        args
    });

    return {
        hijri_year: year,
        hijri_month: month,
        month_name: BULAN_HIJRIYAH_NAMES[month - 1],
        days,
        events: result.rows
    };
};
