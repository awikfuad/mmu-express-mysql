import * as savingsService from '../services/savingsService.js';
import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { getSekolahSettingsService } from '../services/sekolahService.js';

// Validasi target santri milik lembaga pemanggil (admin/teacher scoped).
const assertScope = async (req, placementId) => {
    const lembaga = req.user?.lembaga || 'ALL';
    const s = getSumber(lembaga);
    if (s.isAll || req.user?.role !== 'admin' && req.user?.role !== 'teacher') return;
    const res = await db.execute({
        sql: 'SELECT sumber FROM santri_penempatan WHERE id = ?',
        args: [Number(placementId)]
    });
    if (res.rows.length === 0 || res.rows[0].sumber !== s.sumber) {
        const err = new Error('Santri bukan milik lembaga Anda');
        err.status = 403;
        throw err;
    }
};

// Input Transaksi (Setor/Tarik) oleh Admin atau Kasir Pondok
export const handleTransaction = async (req, res) => {
    const { student_id, transaction_type, amount } = req.body;

    if (!student_id || !transaction_type || !amount) {
        return res.status(400).json({ success: false, message: 'Data input transaksi tabungan belum lengkap!' });
    }

    if (!['SETORAN', 'PENARIKAN'].includes(transaction_type.toUpperCase())) {
        return res.status(400).json({ success: false, message: 'Tipe transaksi harus SETORAN atau PENARIKAN' });
    }

    try {
        const data = await savingsService.createSavingsTransactionService(req.body, req.user?.lembaga);
        return res.status(201).json({
            success: true,
            message: `Transaksi ${transaction_type.toUpperCase()} berhasil diproses!`,
            data
        });
    } catch (error) {
        return res.status(error.status || 400).json({ success: false, message: error.message });
    }
};

// Cek Saldo dan Riwayat (Bisa diakses Admin via Web atau Santri via HP Flutter)
export const getSavingsDashboard = async (req, res) => {
    const { student_id } = req.params;

    try {
        await assertScope(req, student_id);
        const balance = await savingsService.getStudentBalanceService(student_id);
        const history = await savingsService.getSavingsHistoryService(student_id);

        return res.json({
            success: true,
            message: 'Data rekening tabungan berhasil diambil.',
            student_id,
            total_balance: balance,
            transactions_count: history.length,
            history: history
        });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, message: error.message });
    }
};

export const getSavingstransactions = async (req, res) => {
    // Kita ambil student_id dari parameter URL (misal: /api/payments/history/1)
   

    try {
        // Panggil service untuk mengambil data dari Turso
        const history = await savingsService.getSavingstransactions(req.user?.lembaga);

        return res.json({
            success: true,
            message: 'Riwayat pembayaran berhasil diambil!',
            count: history.length,
            data: history
        });
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: 'Gagal mengambil riwayat pembayaran', 
            error: error.message 
        });
    }
}; 

// Get Kwitansi/Struk for a specific savings transaction
export const getSavingsKwitansi = async (req, res) => {
    const { transaction_id } = req.params;

    if (!transaction_id) {
        return res.status(400).json({ success: false, message: 'Transaction ID wajib diisi' });
    }

    try {
        const query = `
            SELECT 
                st.id, st.student_id, st.transaction_type, st.amount, st.notes,
                st.bulan_hijriah, st.tahun_hijriah,
                st.saving_date, st.created_at,
                st.student_id AS sid,
                s.name AS student_name, s.nim, s.classroom_id, s.sumber,
                c.class_name,
                j.nama_jenjang
            FROM savings_transactions st
            JOIN santri_penempatan s ON st.student_id = s.id
            LEFT JOIN classes c ON s.classroom_id = c.id
            LEFT JOIN jenjang j ON s.jenjang_id = j.id
            WHERE st.id = ?
        `;

        const result = await db.execute({ sql: query, args: [transaction_id] });

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaksi tabungan tidak ditemukan' });
        }

        const data = result.rows[0];

        // Terscope lembaga: admin/teacher scoped hanya lembaganya sendiri
        const s = getSumber(req.user?.lembaga || 'ALL');
        if (!s.isAll && data.sumber !== s.sumber) {
            return res.status(403).json({ success: false, message: 'Transaksi di luar lembaga Anda' });
        }

        // Generate kwitansi number
        const prefix = data.transaction_type === 'SETORAN' ? 'SET' : 'TRK';
        const kwitansiNo = `${prefix}-${String(data.id).padStart(6, '0')}-${data.created_at.slice(0, 10).replace(/-/g, '')}`;

        // Get school settings
        const schoolSettings = await getSekolahSettingsService();

        // Calculate running balance
        const balanceQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN transaction_type = 'SETORAN' THEN amount ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN transaction_type = 'PENARIKAN' THEN amount ELSE 0 END), 0) as balance
            FROM savings_transactions
            WHERE student_id = ? AND created_at <= ?
        `;
        const balanceResult = await db.execute({ sql: balanceQuery, args: [data.student_id || data.id, data.created_at] });

        // Terbilang helper
        const terbilang = (n) => {
            const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan'];
            const belasan = ['Sepuluh', 'Sebelas', 'Dua Belas', 'Tiga Belas', 'Empat Belas', 'Lima Belas', 'Enam Belas', 'Tujuh Belas', 'Delapan Belas', 'Sembilan Belas'];
            const puluhan = ['', '', 'Dua Puluh', 'Tiga Puluh', 'Empat Puluh', 'Lima Puluh', 'Enam Puluh', 'Tujuh Puluh', 'Delapan Puluh', 'Sembilan Puluh'];
            if (n === 0) return 'Nol Rupiah';
            let str = '';
            let num = Math.round(n);
            if (num >= 1000000000) { str += terbilang(Math.floor(num / 1000000000)) + ' Miliar '; num %= 1000000000; }
            if (num >= 1000000) { str += terbilang(Math.floor(num / 1000000)) + ' Juta '; num %= 1000000; }
            if (num >= 1000) { str += (num < 2000 ? 'Seribu ' : terbilang(Math.floor(num / 1000)) + ' Ribu '); num %= 1000; }
            if (num >= 100) { str += (num < 200 ? 'Seratus ' : satuan[Math.floor(num / 100)] + ' Ratus '); num %= 100; }
            if (num >= 20) { str += puluhan[Math.floor(num / 10)] + ' '; num %= 10; }
            else if (num >= 10) { str += belasan[num - 10] + ' '; num = 0; }
            if (num > 0) { str += satuan[num] + ' '; }
            return str.trim() + ' Rupiah';
        };

        const kwitansi = {
            ...data,
            kwitansi_no: kwitansiNo,
            nominal_terbilang: terbilang(data.amount),
            tanggal_transaksi: new Date(data.created_at).toLocaleDateString('id-ID', {
                day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            }),
            bulan_label: data.bulan_hijriah
                ? `${data.bulan_hijriah} ${data.tahun_hijriah || ''}`.trim()
                : '-',
            current_balance: balanceResult.rows[0]?.balance || 0,
            school: schoolSettings
        };

        return res.json({ success: true, data: kwitansi });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal mengambil kwitansi tabungan', error: error.message });
    }
};