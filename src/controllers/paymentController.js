import db from '../config/db.js';
import * as paymentService from '../services/paymentService.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { getSekolahSettingsService } from '../services/sekolahService.js';
import { isCloudinaryConfigured, uploadBufferToCloudinary } from '../services/cloudinaryService.js';
import { saveLocalUpload } from '../config/upload.js';

// Validasi target santri milik lembaga pemanggil (admin/teacher scoped).
const assertScope = async (req, studentId) => {
    const lembaga = req.user?.lembaga || 'ALL';
    const s = getSumber(lembaga);
    if (s.isAll || (req.user?.role !== 'admin' && req.user?.role !== 'teacher')) return;
    const res = await db.execute({
        sql: 'SELECT sumber FROM santri_penempatan WHERE id = ?',
        args: [Number(studentId)]
    });
    if (res.rows.length === 0 || res.rows[0].sumber !== s.sumber) {
        const err = new Error('Santri bukan milik lembaga Anda');
        err.status = 403;
        throw err;
    }
};

export const createPayment = async (req, res) => {
    const { student_id } = req.body;

    // 1. Validasi input tingkat dasar di tingkat Controller
    if (!student_id) {
        return res.status(400).json({ 
            success: false, 
            message: 'ID Santri wajib disertakan!' 
        });
    }

    try {
        await assertScope(req, student_id);

        // 2. Kloning data kiriman body (req.body) agar aman dimodifikasi
        const paymentData = { ...req.body };

        // 3. Jika ada file gambar bukti transfer yang berhasil di-upload lewat Multer,
        // unggah ke Cloudinary (primary) dan simpan URL-nya; fallback ke folder lokal
        // bila Cloudinary belum dikonfigurasi di environment.
        if (req.file) {
            try {
                if (isCloudinaryConfigured()) {
                    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
                        folder: 'mmu44-app/bukti-transfer',
                        resource_type: 'auto'
                    });
                    paymentData.transfer_proof = uploaded.secure_url || uploaded.url;
                } else {
                    paymentData.transfer_proof = await saveLocalUpload(req.file.buffer, req.file.originalname, 'transfer_proof');
                }
            } catch (uploadError) {
                console.error('❌ GAGAL UNGGAH BUKTI TRANSFER:', uploadError.message);
                return res.status(400).json({
                    success: false,
                    message: `Gagal mengunggah bukti transfer: ${uploadError.message}`
                });
            }
        }

        // 4. Kirim data yang sudah matang ke Service untuk disimpan ke database Turso
        const result = await paymentService.processBulkPaymentService(student_id, paymentData, req.user?.lembaga);

        // 5. Kembalikan respons sukses ke Front-end (Vue/Flutter)
        return res.status(201).json({
            success: true,
            message: 'Pembayaran majemuk berhasil dicatat beserta bukti transfer!',
            data: result
        });

    } catch (error) {
        // Menangkap dan mengembalikan pesan error dari throwing logic di Service
        return res.status(error.status || 400).json({ 
            success: false, 
            message: error.message 
        });
    }
};



export const getStudentHistory = async (req, res) => {
    // Kita ambil student_id dari parameter URL (misal: /api/payments/history/1)
    const { student_id } = req.params;

    if (!student_id) {
        return res.status(400).json({ success: false, message: 'ID Santri tidak valid!' });
    }

    try {
        await assertScope(req, student_id);
        // Panggil service untuk mengambil data dari Turso
        const history = await paymentService.getStudentPaymentHistoryService(student_id);

        return res.json({
            success: true,
            message: 'Riwayat pembayaran berhasil diambil!',
            count: history.length,
            data: history
        });
    } catch (error) {
        return res.status(error.status || 500).json({ 
            success: false, 
            message: 'Gagal mengambil riwayat pembayaran', 
            error: error.message 
        });
    }
}; 

// Get Kwitansi/Struk for a specific transaction
export const getKwitansi = async (req, res) => {
    const { transaction_id } = req.params;

    if (!transaction_id) {
        return res.status(400).json({ success: false, message: 'Transaction ID wajib diisi' });
    }

    try {
        const query = `
            SELECT 
                pt.id, pt.payment_type, pt.month, pt.amount, pt.payment_method,
                pt.transfer_note, pt.transfer_proof, pt.created_at,
                pt.academic_year_id,
                s.name AS student_name, s.nim, s.classroom_id, s.sumber,
                c.class_name,
                ay.year_name,
                j.nama_jenjang
            FROM payment_transactions pt
            JOIN santri_penempatan s ON pt.student_id = s.id
            LEFT JOIN classes c ON s.classroom_id = c.id
            LEFT JOIN academic_years ay ON pt.academic_year_id = ay.id
            LEFT JOIN jenjang j ON s.jenjang_id = j.id
            WHERE pt.id = ?
        `;

        const result = await db.execute({ sql: query, args: [transaction_id] });

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
        }

        const data = result.rows[0];

        // Terscope lembaga: admin/teacher scoped hanya lembaganya sendiri
        const s = getSumber(req.user?.lembaga || 'ALL');
        if (!s.isAll && data.sumber !== s.sumber) {
            return res.status(403).json({ success: false, message: 'Transaksi di luar lembaga Anda' });
        }
        
        // Generate kwitansi number
        const kwitansiNo = `KWT-${String(data.id).padStart(6, '0')}-${data.created_at.slice(0, 10).replace(/-/g, '')}`;

        // Get school settings for kwitansi template
        const schoolSettings = await getSekolahSettingsService();

        // QR code data for verification
        const qrData = JSON.stringify({
            id: data.id,
            no: kwitansiNo,
            amount: data.amount,
            nim: data.nim,
            timestamp: data.created_at
        });

        const kwitansi = {
            ...data,
            kwitansi_no: kwitansiNo,
            nominal_terbilang: terbilang(data.amount),
            tanggal_transaksi: new Date(data.created_at).toLocaleDateString('id-ID', {
                day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            }),
            bulan_hijriah: data.month || (data.payment_type === 'DAFTAR_ULANG' ? 'Tahunan' : 'Bulanan'),
            school: schoolSettings,
            qr_data: qrData
        };

        return res.json({ success: true, data: kwitansi });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal mengambil kwitansi', error: error.message });
    }
};

// Helper: Terbilang Indonesia
function terbilang(n) {
    const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan'];
    const belasan = ['Sepuluh', 'Sebelas', 'Dua Belas', 'Tiga Belas', 'Empat Belas', 'Lima Belas', 'Enam Belas', 'Tujuh Belas', 'Delapan Belas', 'Sembilan Belas'];
    const puluhan = ['', '', 'Dua Puluh', 'Tiga Puluh', 'Empat Puluh', 'Lima Puluh', 'Enam Puluh', 'Tujuh Puluh', 'Delapan Puluh', 'Sembilan Puluh'];

    if (n === 0) return 'Nol Rupiah';
    
    let str = '';
    let num = Math.round(n);
    
    if (num >= 1000000000) {
        str += terbilang(Math.floor(num / 1000000000)) + ' Miliar ';
        num %= 1000000000;
    }
    if (num >= 1000000) {
        str += terbilang(Math.floor(num / 1000000)) + ' Juta ';
        num %= 1000000;
    }
    if (num >= 1000) {
        str += (num < 2000 ? 'Seribu ' : terbilang(Math.floor(num / 1000)) + ' Ribu ');
        num %= 1000;
    }
    if (num >= 100) {
        str += (num < 200 ? 'Seratus ' : satuan[Math.floor(num / 100)] + ' Ratus ');
        num %= 100;
    }
    if (num >= 20) {
        str += puluhan[Math.floor(num / 10)] + ' ';
        num %= 10;
    } else if (num >= 10) {
        str += belasan[num - 10] + ' ';
        num = 0;
    }
    if (num > 0) {
        str += satuan[num] + ' ';
    }
    
    return str.trim() + ' Rupiah';
}

export const gettransactions = async (req, res) => {
    // Kita ambil student_id dari parameter URL (misal: /api/payments/history/1)
   

    try {
        // Panggil service untuk mengambil data dari Turso
        const history = await paymentService.gettransactions(req.user?.lembaga);

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