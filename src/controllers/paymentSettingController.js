import * as paymentSettingService from '../services/paymentSettingService.js';

// Daftar setting nominal pembayaran (terscope lembaga admin)
export const getPaymentSettings = async (req, res) => {
    try {
        const lembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const data = await paymentSettingService.getPaymentSettingsService(lembaga);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// Simpan/ubah setting nominal pembayaran
export const upsertPaymentSetting = async (req, res) => {
    try {
        const lembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const data = await paymentSettingService.upsertPaymentSettingService(req.body, lembaga);
        return res.json({ success: true, message: 'Setting nominal pembayaran berhasil disimpan!', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

// Hapus setting nominal pembayaran
export const deletePaymentSetting = async (req, res) => {
    try {
        const lembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const deleted = await paymentSettingService.deletePaymentSettingService(req.params.id, lembaga);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Setting nominal tidak ditemukan.' });
        }
        return res.json({ success: true, message: 'Setting nominal pembayaran berhasil dihapus.' });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
