import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api/client';

const FeatureCtx = createContext(null);

export const DEFAULT_FEATURES = {
  enableGST: true,
  enableBatch: true,
  enableExpiry: true,
  enableDiscount: true,
  discountMode: 'tcs',
  enableMRP: true,
  enableHSN: true,
  autoRoundOff: true,
  whatsappAutoSend: false,
  whatsappAutoPrompt: true,
  negativeStock: false,
  duplicateSerialAlert: true,
  showStockInVoucher: true,
  printPreview: true,
  defaultPayMode: 'cash',
  invoiceFooter: 'Thank you for your business!',
  autoHSN: true,
  gstinAutoFill: true,
  b2clThreshold: 250000,
  // --- Tax-invoice content blocks (Bill Format tab in F12) ---
  billConsignee: true,
  billBuyerBox: true,
  billDispatch: true,
  billOrderRef: true,
  billEwayNo: true,
  billEInvoice: true,
  billPlaceOfSupply: true,
  billHsnSummary: true,
  billAmountWords: true,
  billTaxWords: true,
  billBankDetails: true,
  billDeclaration: true,
  billPan: true,
  billUdyam: true,
  billComputerGenerated: true,
  billCustomerSeal: true,
  billRoundOff: true,
  billTriplicate: true,
};

export function FeatureProvider({ children }) {
  const [company, setCompany] = useState(null);
  const [features, setFeatures] = useState(DEFAULT_FEATURES);

  const reload = useCallback(() => {
    return api.get('/company').then((c) => {
      setCompany(c);
      setFeatures({ ...DEFAULT_FEATURES, ...(c.features || {}) });
      return c;
    }).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Patch one or more toggles and persist immediately.
  const setFeature = useCallback((patch) => {
    setFeatures((f) => ({ ...f, ...patch }));
    return api.patch ? api.patch('/company/features', patch).then((c) => {
      setCompany(c);
      setFeatures({ ...DEFAULT_FEATURES, ...(c.features || {}) });
    }) : Promise.resolve();
  }, []);

  return (
    <FeatureCtx.Provider value={{ company, features, setFeature, reload }}>
      {children}
    </FeatureCtx.Provider>
  );
}

export const useFeatures = () => useContext(FeatureCtx) || { features: DEFAULT_FEATURES, setFeature: () => {}, reload: () => {} };
