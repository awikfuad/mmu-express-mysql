import {
    getAccountsService,
    createAccountService,
    updateAccountService,
    deleteAccountService,
    getKasTransactionsService,
    createKasTransactionService,
    deleteKasTransactionService,
    getKasReportService
} from '../services/kasService.js';

const getLembaga = (req) => (req.user?.lembaga || 'ALL').toUpperCase();
const getPostedBy = (req) => req.user ? `${req.user.role || 'admin'}:${req.user.username || req.user.name || req.user.id || ''}` : null;

// ============================================================================
// MASTER AKUN (COA)
// ============================================================================

export const getAccounts = async (req, res) => {
    try {
        const data = await getAccountsService(getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET ACCOUNTS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat daftar akun' });
    }
};

export const createAccount = async (req, res) => {
    try {
        const data = await createAccountService(req.body, getLembaga(req));
        return res.status(201).json({ success: true, data, message: 'Akun berhasil ditambahkan' });
    } catch (error) {
        console.error('EROR CREATE ACCOUNT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menambahkan akun' });
    }
};

export const updateAccount = async (req, res) => {
    try {
        await updateAccountService(req.params.id, req.body, getLembaga(req));
        return res.status(200).json({ success: true, message: 'Akun berhasil diubah' });
    } catch (error) {
        console.error('EROR UPDATE ACCOUNT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mengubah akun' });
    }
};

export const deleteAccount = async (req, res) => {
    try {
        await deleteAccountService(req.params.id, getLembaga(req));
        return res.status(200).json({ success: true, message: 'Akun berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE ACCOUNT:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal menghapus akun' });
    }
};

// ============================================================================
// JURNAL / TRANSAKSI KAS
// ============================================================================

export const getKasTransactions = async (req, res) => {
    try {
        const data = await getKasTransactionsService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET KAS TRANSACTIONS:', error);
        return res.status(500).json({ success: false, message: 'Gagal memuat transaksi kas' });
    }
};

export const createKasTransaction = async (req, res) => {
    try {
        const data = await createKasTransactionService(req.body, getLembaga(req), getPostedBy(req));
        return res.status(201).json({ success: true, data, message: 'Transaksi kas berhasil dicatat' });
    } catch (error) {
        console.error('EROR CREATE KAS TRANSACTION:', error);
        return res.status(400).json({ success: false, message: error.message || 'Gagal mencatat transaksi kas' });
    }
};

export const deleteKasTransaction = async (req, res) => {
    try {
        const ok = await deleteKasTransactionService(req.params.id, getLembaga(req));
        if (!ok) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
        return res.status(200).json({ success: true, message: 'Transaksi berhasil dihapus' });
    } catch (error) {
        console.error('EROR DELETE KAS TRANSACTION:', error);
        return res.status(500).json({ success: false, message: 'Gagal menghapus transaksi kas' });
    }
};

export const getKasReport = async (req, res) => {
    try {
        const data = await getKasReportService(req.query, getLembaga(req));
        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('EROR GET KAS REPORT:', error);
        const status = error.message && /tanggal|bulan/i.test(error.message) ? 400 : 500;
        return res.status(status).json({ success: false, message: error.message || 'Gagal memuat rekap kas' });
    }
};
