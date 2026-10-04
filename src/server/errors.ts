import { BusinessError } from './value';
export const messages: Record<string, [string, string]> = {
  migrationinprogress: [
    'Depolama taşınıyor. Lütfen biraz sonra tekrar deneyin.',
    'Storage migration is in progress. Please retry shortly.',
  ],
  conflict: ['Veriler değişti. Lütfen işlemi yeniden deneyin.', 'The data changed. Please retry the operation.'],
  importinprogress: ['Veri aktarımı sürüyor.', 'Data import is in progress.'],
  reconciliationfailed: ['Veri aktarımı mutabakatı başarısız.', 'Import reconciliation failed.'],
  idempotencyrequired: ['İşlem anahtarı gerekli. Lütfen sayfayı yenileyin.', 'An operation key is required. Please refresh the page.'],
  invalidrequest: ['Geçersiz istek.', 'Invalid request.'],
  invalidquantity: ['Miktar pozitif bir tam sayı olmalıdır.', 'Quantity must be a positive integer.'],
  invalidamount: ['Geçerli bir tutar girin (en fazla iki ondalık basamak).', 'Enter a valid amount (at most two decimal places).'],
  invaliddate: ['Geçersiz tarih.', 'Invalid date.'],
  notfound: ['Kayıt bulunamadı.', 'Record not found.'],
  unauthorized: ['Oturum açmanız gerekiyor.', 'Authentication required.'],
  forbidden: ['Bu işlem için yetkiniz yok.', 'You are not authorized for this operation.'],
  tenantrequired: ['Kooperatif kimliği gerekli.', 'Tenant identity required.'],
  insufficientstock: ['Yeterli stok yok.', 'Insufficient stock.'],
  invalidstock: ['Stok bilgisi geçersiz.', 'Invalid stock state.'],
  invalidpayment: ['Ödeme yöntemi geçersiz.', 'Invalid payment method.'],
  invaliddiscount: ['Bu kooperatif için indirim geçersiz.', 'Invalid discount for this cooperative.'],
  discountlimit: [
    'Bu kooperatifin indirim sınırı aşıldı. Yönetici, Yönetim → Cloudflare işlemleri ekranından en yüksek indirim oranını girebilir.',
    "This cooperative's discount ceiling was exceeded. An administrator can set the maximum discount under Administration → Cloudflare operations.",
  ],
  invalidtransition: ['Nöbet durumu değişti. Lütfen yenileyin.', 'Shift state changed. Please refresh.'],
  cashrequired: ['Sistem kasası bulunamadı.', 'System cash is unavailable.'],
  notesrequired: ['Kasa farkı için açıklama gerekli.', 'A note is required for a cash discrepancy.'],
  shiftimmutable: ['Nöbet geçmişi silinemez.', 'Shift history cannot be deleted.'],
  correctionrequired: ['Kapanış sonrası düzeltme bilgileri gerekli.', 'A correction is required after shift closing.'],
  reasonrequired: ['Düzeltme nedeni ve ödeme tercihi gerekli.', 'A correction reason and cash preference are required.'],
  activeshiftrequired: ['Önce nöbet açın.', 'Open a shift first.'],
  pendingcorrection: ['Bekleyen düzeltme ödemesini tamamlayın.', 'Settle the pending correction first.'],
  cancelled: ['İptal edilen kayıt değiştirilemez.', 'Cancelled records cannot be changed.'],
  notclosed: ['Kayıt kapanmış bir nöbete ait değil.', 'The record does not belong to a closed shift.'],
  salelinkeddebt: [
    'Satışa bağlı borçlar satış/ödeme ekranından yönetilir.',
    'Sale-linked debts are managed through the sale/payment workflow.',
  ],
  returnimmutable: [
    'Geçmiş iadenin ürün, miktar ve türü değiştirilemez; iade silinemez.',
    'Historical returns cannot change product, quantity or type, or be deleted.',
  ],
  duplicate: ['Bu değer zaten kullanılıyor.', 'This value is already in use.'],
  idempotencyconflict: ['Aynı işlem anahtarı farklı bir istek için kullanıldı.', 'The operation key was reused for a different request.'],
  invalidcredentials: ['Kullanıcı adı veya parola hatalı.', 'Invalid login or password.'],
  passwordinvalid: [
    'Parola 8–100 karakter ve en fazla 72 UTF-8 baytı olmalıdır.',
    'Password must contain 8–100 characters and at most 72 UTF-8 bytes.',
  ],
  ratelimited: ['Çok fazla deneme. Biraz sonra tekrar deneyin.', 'Too many attempts. Try again later.'],
  referenced: ['Kayıt başka işlemlerde kullanılıyor.', 'The record is referenced by other operations.'],
  emailunavailable: [
    'Bu ortamda e-posta gönderimi kapalı. Yöneticiyle iletişime geçin.',
    'Outbound email is disabled in this environment. Contact an administrator.',
  ],
  configuration: ['Hizmet yapılandırması eksik.', 'Service configuration is incomplete.'],
};
export function errorResponse(error: unknown, request?: Request): Response {
  const business = error instanceof BusinessError ? error : error instanceof SyntaxError ? new BusinessError('invalidrequest') : null;
  const code = business ? business.code : 'internalerror';
  const tr = request?.headers.get('accept-language')?.toLowerCase().startsWith('tr') !== false;
  const title = messages[code]?.[tr ? 0 : 1] || (tr ? 'İşlem tamamlanamadı.' : 'The operation could not be completed.');
  if (!business) console.error('Pirot operation failed', error instanceof Error ? error.message : 'Unknown error');
  return Response.json(
    { type: 'about:blank', title, status: business ? business.status : 500, detail: title, message: `error.${code}`, errorKey: code },
    { status: business ? business.status : 500, headers: { 'cache-control': 'no-store' } },
  );
}
