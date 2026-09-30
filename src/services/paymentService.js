import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { resolveNominalForAccount } from './paymentSettingService.js';

// Validasi nominal yang diinput kasir: harus kelipatan nominal yang disetel (bila ada setting)
const validateNominalKelipatan = (amount, nominal, typeLabel) => {
    if (nominal == null) return; // belum di-setting -> bebas
    const amountInt = Math.round(Number(amount));
    if (amountInt % Math.round(nominal) !== 0) {
        throw new Error(`Nominal ${typeLabel} harus kelipatan dari Rp ${Number(nominal).toLocaleString('id-ID')} (pembayaran 1x, 2x, dst).`);
    }
};

// Validasi target santri milik lembaga pemanggil (admin scoped hanya lembaganya sendiri)
const assertStudentScope = async (studentId, lembaga) => {
    const s = getSumber(lembaga);
    if (s.isAll) return;
    const res = await db.execute({
        sql: 'SELECT id, sumber FROM santri_penempatan WHERE id = ?',
        args: [Number(studentId)]
    });
    if (res.rows.length === 0) throw new Error('Santri tidak ditemukan (cek data di menu Data Murid)');
    if (res.rows[0].sumber !== s.sumber) {
        const err = new Error('Santri bukan milik lembaga Anda');
        err.status = 403;
        throw err;
    }
};

export const processBulkPaymentService = async (studentId, data, lembaga = 'ALL') => {
    await assertStudentScope(studentId, lembaga);

    const {
        pay_yaumiyah,
        yaumiyah_month,
        yaumiyah_amount,
        pay_daftar_ulang,
        daftar_ulang_amount,
        payment_method,
        transfer_note,
        transfer_proof // Ini akan berisi path file yang sudah di-upload (jika ada)
    } = data;

    const recordedTransactions = [];

    // 1. Validasi Logika Bisnis: Pastikan nominal tidak minus
    if ((pay_yaumiyah && yaumiyah_amount <= 0) || (pay_daftar_ulang && daftar_ulang_amount <= 0)) {
        throw new Error("Nominal pembayaran harus lebih besar dari Rp 0");
    }

    // 2. Jika metode pembayaran TRANSFER, pastikan catatan transfer diisi
    if (payment_method === 'TRANSFER' && (!transfer_note || transfer_note.trim() === '')) {
        throw new Error("Keterangan pelacakan transfer wajib diisi untuk metode TRANSFER!");
    }

    // 3. Eksekusi Pembayaran Yaumiyah
    if (pay_yaumiyah) {
        const { yearId, nominal } = await resolveNominalForAccount(studentId, 'YAUMIYAH');
        validateNominalKelipatan(yaumiyah_amount, nominal, 'Yaumiyah');

        const queryYaumiyah = `
            INSERT INTO payment_transactions (academic_year_id, student_id, payment_type, month, amount, payment_method, transfer_note, transfer_proof)
            VALUES (?, ?, 'YAUMIYAH', ?, ?, ?, ?, ?)
        `;
        const result = await db.execute({
            sql: queryYaumiyah,
            args: [yearId, studentId, yaumiyah_month, yaumiyah_amount, payment_method, transfer_note || null, transfer_proof || null]
        });

        recordedTransactions.push({ id: result.lastInsertRowid, type: 'YAUMIYAH', amount: yaumiyah_amount });
    }

    // 4. Eksekusi Pembayaran Daftar Ulang
    if (pay_daftar_ulang) {
        const { yearId, nominal } = await resolveNominalForAccount(studentId, 'DAFTAR_ULANG');
        validateNominalKelipatan(daftar_ulang_amount, nominal, 'Daftar Ulang');

        const queryDaftarUlang = `
            INSERT INTO payment_transactions (academic_year_id, student_id, payment_type, month, amount, payment_method, transfer_note, transfer_proof)
            VALUES (?, ?, 'DAFTAR_ULANG', NULL, ?, ?, ?, ?)
        `;
        const result = await db.execute({
            sql: queryDaftarUlang,
            args: [yearId, studentId, daftar_ulang_amount, payment_method, transfer_note || null, transfer_proof || null]
        });

        recordedTransactions.push({ id: result.lastInsertRowid, type: 'DAFTAR_ULANG', amount: daftar_ulang_amount });
    }

    // Kembalikan ringkasan data yang berhasil disimpan ke controller
    return recordedTransactions;

};
// ... kode processBulkPaymentService yang lama tetap ada di atas ...

export const getStudentPaymentHistoryService = async (studentId) => {
    // Kueri SQL untuk mengambil riwayat pembayaran, diurutkan dari yang paling baru
    const query = `
        SELECT id, payment_type, month, amount, payment_method, transfer_note, transfer_proof, created_at 
        FROM payment_transactions 
        WHERE student_id = ? 
        ORDER BY created_at DESC
    `;

    const result = await db.execute({
        sql: query,
        args: [studentId]
    });

    // Mengembalikan hasil baris data dari database Turso
    return result.rows;
};
export const gettransactions = async (lembaga = 'ALL') => {
    // Kueri SQL untuk mengambil riwayat pembayaran, diurutkan dari yang paling baru
    const s = getSumber(lembaga);

      const query = `
    SELECT 
      s.id AS student_id,
      s.name AS student_name,
      s.nim,
        s.academic_year_id,
      s.classroom_id,
      s.jenjang_id,
      s.rombel_id,

      
      pt.id AS transaction_id,
      pt.amount,
      pt.month,
      
            pt.payment_type,
      pt.payment_method,
      pt.transfer_note,
      pt.transfer_proof,
      pt.created_at AS payment_date
    FROM ${s.santriTable} s
    LEFT JOIN payment_transactions pt ON s.id = pt.student_id
    WHERE 1 = 1 ${s.sumberFilter ? `AND ${s.sumberFilter}` : ''}
    ORDER BY pt.created_at DESC, 
    s.name ASC
  `;

    const result = await db.execute({
        sql: query,

    });

    // Mengembalikan hasil baris data dari database Turso
    return result.rows;
};