# typescript-pos

[![CI](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/typescript-pos.svg)](https://www.npmjs.com/package/typescript-pos)
[![lisans](https://img.shields.io/github/license/mkiyak/typescript-pos.svg)](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

Türk bankalarının sanal POS altyapılarını (3D Secure akışları dahil) tek, durumsuz (stateless) ve async bir arayüz arkasında
toplayan TypeScript kütüphanesi. Node.js 22 veya üzeri gerekir; ESM ve CommonJS desteklenir, çalışma zamanı bağımlılıkları yalnızca
`fast-xml-parser` ve `iconv-lite`'tır.

> Durum: 1.0 öncesi. Minor sürümler kırıcı değişiklik içerebilir (bkz. [Versiyonlama](#versiyonlama)).

## Desteklenen gateway'ler

| Gateway        | Bankalar                                                                                          | Doğrulama                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssecoPos`    | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, QNB Finansbank (Asseco)   | Birim testli; 3D hash'i PHP ile karşılaştırmalı test edildi (1000 rastgele kümede 0 uyuşmazlık).                                                                                                            |
| `PayFlexV4Pos` | VakıfBank (8443 portu), Ziraat (PayFlex)                                                          | Birim testli. VakıfBank herkese açık TEST ortamında 2026-11-23'te canlı doğrulandı: 3D kayıt kontrolü (Status `Y`), 3D'siz Satış (`0000`) ve İptal (`0000`). |
| `PayFlexCPV4Pos` | VakıfBank (Güvenli Ortak Ödeme, port 8443) | Birim testli. |
| `GarantiPos` | Garanti BBVA | Birim testli; hash'ler ve tutar biçimi PHP'ye karşı diferansiyel test edildi. |
| `AkbankPos` | Akbank (sanal POS API) | Birim testli; istek imzası, 3D hash'leri ve tutar biçimi PHP'ye karşı diferansiyel test edildi (her biri için 1000 rastgele kümede 0 uyuşmazlık). |
| `PosNetPos` | Yapı Kredi (POSNET XML) | Birim testli; MAC'ler, tutar ve sipariş no biçimi PHP'ye karşı diferansiyel test edildi (her biri için 1000 rastgele kümede 0 uyuşmazlık). |
| `PosNetV1Pos` | Albaraka Türk (POSNET JSON) | Birim testli; MAC'ler PHP'ye karşı diferansiyel test edildi (her biri için 1000 rastgele kümede 0 uyuşmazlık). |
| `PayForPos` | QNB Finansbank (PayFor), Ziraat Katılım (PayFor) | Birim testli; form ve callback hash'leri ile tutar biçimi PHP'ye karşı diferansiyel test edildi (her biri için 2.000 rastgele kümede 0 uyuşmazlık). |
| `InterPos` | Denizbank (InterVPOS) | Birim testli; form ve callback hash'leri ile tutar biçimi PHP'ye karşı diferansiyel test edildi (her biri için 2.000 rastgele kümede 0 uyuşmazlık). |
| `KuveytPos` | Kuveyt Türk | Birim testli; istek ve callback hash'leri ile kuruş tutarı dönüşümü PHP'ye karşı diferansiyel test edildi (her biri için 1.000 rastgele kümede 0 uyuşmazlık). |
| `VakifKatilimPos` | Vakıf Katılım | Birim testli; istek ve callback hash'leri ile kuruş tutarı dönüşümü PHP'ye karşı diferansiyel test edildi (her biri için 1.000 rastgele kümede 0 uyuşmazlık). |
| `ToslaPos` | Tosla | Birim testli; istek ve callback hash'leri PHP'ye karşı diferansiyel test edildi (her biri için 1.000 rastgele kümede 0 uyuşmazlık). |
| `ParamPos` | Param (TURK Elektronik Para) | Birim testli; istek ve callback hash'leri PHP'ye karşı diferansiyel test edildi (her biri için 1.000 rastgele kümede 0 uyuşmazlık). |
| `Param3DHostPos` | Param ortak ödeme sayfası | Birim testli; callback hash'leri PHP'ye karşı diferansiyel test edildi (1.000 rastgele kümede 0 uyuşmazlık); işlem kimliği PHP'nin PBKDF2/HMAC'ine karşı test edildi (1.000 kümede 0 uyuşmazlık). |
| `PayTrPos` | PayTR (iFrame, Direct API, 3D Secure'suz) | Birim testli; istek imzaları ve bildirim hash'i PHP'ye karşı diferansiyel test edildi (1.000 rastgele kümede 0 uyuşmazlık); sepet JSON'u PHP'nin json_encode'una karşı test edildi (1.000 sepette 0 uyuşmazlık). |
| `IyzicoPos` | iyzico (3D Secure, 3D Host ödeme formu, 3D Secure'suz) | Birim testli; istek yetkilendirme başlığı ile callback ve cevap imzaları PHP'ye karşı diferansiyel test edildi (her biri için 1.000 rastgele kümede 0 uyuşmazlık). |

## Kurulum

```sh
npm install typescript-pos
```

## Hızlı başlangıç

Her şey düz nesnelerle kurulur. Sipariş anahtarları ve normalize cevap anahtarları snake_case'tir ve tüm
gateway'lerde aynıdır (`id`, `amount`, `success_url`, ... ve `status`, `proc_return_code`, `order_id`, ...). Tutarlar ana
birimdedir (`10.5` = 10,50 TL).

### Asseco 3D Pay Hosting (kart verisi sunucunuza uğramaz)

```ts
import { AccountFactory, MODEL, PosFactory, posProductionConfig, TX_TYPE } from 'typescript-pos'

const account = AccountFactory.createAssecoPosAccount('isbank', clientId, username, password, storeKey)
const pos = PosFactory.createPosGateway(account, posProductionConfig) // durumsuz, paylaşabilirsiniz

// 1. Sayfanızın bankaya otomatik göndereceği formu üretin.
const form = await pos.get3DFormData(order, MODEL.THREE_D_PAY_HOSTING, TX_TYPE.PAY_AUTH)
// { gateway, method: 'POST', inputs }

// 2. Banka müşteriyi success_url / fail_url adresine POST ile geri yönlendirir.
const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, callbackBody)
if (response.status === 'approved') {
  /* ödendi */
}
```

### PayFlex 3D Secure (kart verisi sunucunuzdan geçer, PCI SAQ D)

```ts
import { AccountFactory, CARD_TYPE, CreditCardFactory, MODEL, PosFactory, posProductionConfig, TX_TYPE } from 'typescript-pos'

const account = AccountFactory.createPayFlexPosAccount('vakifbank', merchantId, password, terminalNo)
const pos = PosFactory.createPosGateway(account, posProductionConfig)
const card = CreditCardFactory.create('4938410157705591', '29', '12', '453', 'John Doe', CARD_TYPE.VISA)

// 1. Kayıt kontrolü: ACS formunu döner (kart 3D'ye kayıtlı değilse hata fırlatır).
const form = await pos.get3DFormData(order, MODEL.THREE_D_SECURE, TX_TYPE.PAY_AUTH, card)

// 2. Callback: sonucu doğrular ve provizyon isteğini gönderir. PayFlex kartı yeniden ister.
const response = await pos.payment(MODEL.THREE_D_SECURE, order, TX_TYPE.PAY_AUTH, card, callbackBody)
```

Hata yönetimi dahil tam ve derleme denetimli sürümler [`examples/`](https://github.com/mkiyak/typescript-pos/tree/main/examples) altındadır. Tüm kılavuzlar [kılavuz dizininde](https://github.com/mkiyak/typescript-pos/blob/main/guides/README.md) listelenir. Şunlarla başlayın:

- [Ödeme modelleri](https://github.com/mkiyak/typescript-pos/blob/main/guides/payment-models.md): kartı kimin topladığı, PCI kapsamı ve hangi gateway'in hangi modeli sunduğu
- [Yönlendirme, iframe veya popup içinde 3D sayfaları](https://github.com/mkiyak/typescript-pos/blob/main/guides/3d-iframe-and-popup.md)
- [Ödemeden sonra: iptal, iade, durum, sipariş geçmişi](https://github.com/mkiyak/typescript-pos/blob/main/guides/after-payment.md)
- [Ön provizyon ve kapama](https://github.com/mkiyak/typescript-pos/blob/main/guides/pre-auth-and-capture.md)
- [Sorgular (özel banka istekleri)](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)
- [Güvenlik ve canlıya çıkış kontrol listesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)

Gateway başına adım adım kılavuzlar:

- [Asseco 3D Pay Hosting](https://github.com/mkiyak/typescript-pos/blob/main/guides/asseco-3d-payment.md)
- [PayFlex V4 3D Secure](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-3d-payment.md)
- [VakıfBank Ortak Ödeme (3D Host / 3D Pay)](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-cp-payment.md)
- [Garanti BBVA 3D ödeme](https://github.com/mkiyak/typescript-pos/blob/main/guides/garanti-3d-payment.md)
- [Akbank sanal POS ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/akbank-pos-payment.md)
- [Yapı Kredi POSNET 3D ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/posnet-3d-payment.md)
- [Albaraka Türk POSNET 3D ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/posnet-v1-3d-payment.md)
- [QNB Finansbank ve Ziraat Katılım (PayFor) ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/payfor-payment.md)
- [Denizbank (InterVPOS) ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/interpos-payment.md)
- [Kuveyt Türk ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/kuveytpos-payment.md)
- [Vakıf Katılım ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/vakif-katilim-payment.md)
- [Tosla ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/tosla-payment.md)
- [Param ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/param-payment.md)
- [PayTR ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/paytr-payment.md)
- [iyzico ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/iyzico-payment.md)

Diğer işlemler: `pos.cancel(order)`, `pos.refund(order)` (`order.order_amount` verilmiş ve `order.amount` ondan
küçükse kısmi iade), `pos.status(order)`, `pos.orderHistory(order)` (Asseco, Garanti, Akbank, PayFor, Vakıf Katılım, Tosla ve iyzico), 3D Secure'suz ödeme için
`pos.payment(MODEL.NON_SECURE, ...)` ve ön/son provizyon için `TX_TYPE.PAY_PRE_AUTH` / `TX_TYPE.PAY_POST_AUTH`.

### Test ve canlı yapılandırma

`posProductionConfig` banka adıyla anahtarlanır (`isbank`, `akbank`, `vakifbank`, ...). `posTestConfig` ise
test ortamı adıyla anahtarlanır: `asseco`, `akbank-pos`, `albaraka`, `denizbank`, `garanti`, `iyzico`, `kuveytpos`,
`param-pos`, `param-3d-host-pos`, `paytr`, `qnbfinansbank-payfor`, `tosla`, `vakif-katilim`, `vakifbank`,
`vakifbank-cp`, `yapikredi`, `ziraat-katilim-payfor` ve `ziraat-vpos`. Bu yüzden test ortamındaki bir
İşbank hesabı `asseco` banka adını kullanır; ya da kodunuzda tek ad tutmak için şu kalıbı kullanın:

```ts
import { posTestConfig } from 'typescript-pos'

const testConfig = { banks: { isbank: posTestConfig.banks.asseco } }
```

Hazır gelen iki yapılandırma da derinlemesine dondurulmuştur (deep freeze) ve banka anahtarları tiplidir. Bir girdiyi
değiştirmek için onu yeni bir nesneye yayın (spread): `{ ...posProductionConfig.banks.vakifbank, require_3d_hash: true }`.

## Callback yönetimi

Banka müşteriyi siteler arası (cross-site) bir POST ile geri gönderir; bu yüzden `SameSite` oturum çerezleri
gelmeyebilir. Siparişi sunucuda sipariş numarasıyla bulun, callback'i her zaman gateway metodundan geçirin
(`pos.payment(...)`, `make3DPayment`, ...) ve callback alanlarına doğrudan güvenmeyin. Siparişinizle eşleşmeyen bir
callback `OrderMismatchError` fırlatır (`error.field` alanı adlandırır): bunu sipariş için başarısızlık sayın ve
`error.response` içeriğini okuyun. `error.paymentMayHaveCompleted` `true` ise banka bu callback için tamamlanmış bir
ödeme bildirmiştir, yani karttan çekim yapılmış olabilir: ilgili kişiyi uyarın, ödemeyi iptal veya iade edin.
`requires_manual_review: true` taşıyan reddedilmiş (declined) bir cevap da (3D doğrulaması başarısız olduğu hâlde
banka provizyon vermiştir) para hareketi olmuş olabileceğini gösterir: inceleyin. [Güvenlik kılavuzu](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)
iki bayrağı tanımlar ve her gateway'in neleri kontrol ettiğini listeler.

Bankanın 3D sayfasını yönlendirme, iframe veya popup içinde göstermek için form nesnesini
`render3DFormHtml(form, options)` ile sunun (her değeri kaçışlar, `https:` olmayan action'ları reddeder ve CSP nonce'unuzu
taşır); rotalar ve `postMessage` kuralları [iframe ve popup kılavuzundadır](https://github.com/mkiyak/typescript-pos/blob/main/guides/3d-iframe-and-popup.md).

```ts
try {
  const response = await pos.payment(MODEL.THREE_D_PAY_HOSTING, order, TX_TYPE.PAY_AUTH, null, body)
  if (response.requires_manual_review) alertOps(response)
  return response.status === 'approved'
} catch (error) {
  if (error instanceof HashMismatchError) return false
  if (error instanceof OrderMismatchError) {
    if (error.paymentMayHaveCompleted) alertOps(error.response) // iptal veya iade edin
    return false
  }
  throw error // sonuç bilinmiyor: tekrar denemeden önce pos.status(order) ile kontrol edin
}
```

**Sonuç bilinmiyor: ödemeleri asla körlemesine tekrar denemeyin.** Para hareketi yapan bir istekten (ödeme, ön
provizyon, son provizyon, 3D ödemenin provizyonu, iade) sonra gelen bir `PosHttpError` (zaman aşımı, 2xx dışı cevap,
HTML/WAF sayfası veya sonuç taşımayan bir 2xx cevap), banka isteği zaten işledikten sonra oluşmuş olabilir. Tekrar
denemek müşteriden iki kez çekim yapılmasına yol açabilir. Siparişi beklemede tutun ve önce `pos.status(order)`
çağırın; yalnızca bankada işlemin kaydı yoksa tekrar deneyin. Tekrarlanan iptal güvenlidir. Bkz.
[Sonuç bilinmiyor](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md#outcome-unknown).

Kütüphanenin fırlattığı her hata `PosError` sınıfından türer (örneğin `HashMismatchError`, `OrderMismatchError`,
`MissingAccountInfoError`, `InvalidCardError`, `PosHttpError`).

Saat dilimi (offset) içermeyen banka zaman damgaları Türkiye saati (UTC+03:00) olarak yorumlanır. Bankaya gönderilen
tarihler (PayFlex düzenli ödeme tarihleri) İstanbul takvim gününe göre biçimlenir; bu yüzden başka bir saat diliminde
gece yarısına yakın bir `Date` önceki veya sonraki güne düşebilir.

PayFlex notları (ayrıntılar [PayFlex kılavuzunda](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-3d-payment.md#good-to-know)):
iptal ve iade, `order.ip` verilmezse `ClientIp` alanını boş gönderir (bu alanı verin); boş bir `MdStatus` hiç
gönderilmemiş sayılır; birden fazla kayıt dönen bir durum sorgusu (`Search`) cevabı `declined` ve boş alanlarla
eşlenir, bu siparişleri kendi kayıtlarınızla mutabık kılın.

## Sorgular

Tek bir siparişe bağlı olmayan istekler, durumsuz bir sorgu nesnesinden geçer. Gateway gibi oluşturulur; kimlik bilgileri sizin yerinize eklenir.

```ts
import { PosQueryFactory } from 'typescript-pos'

const query = PosQueryFactory.createPosQuery(account, posProductionConfig)
const answer = await query.customQuery({ TransactionId: transactionId }) // çözülmüş, normalize edilmemiş
```

Özel URL'ler `https:` olmalı ve yapılandırılmış bir banka origin'inde (ya da `allowedApiOrigins` ile verdiğiniz bir origin'de)
olmalıdır. `GarantiPos` ayrıca `history` ve `getBinList`, `AkbankPos`, `PayForPos` ve `VakifKatilimPos` ise `history` sunar (Vakıf Katılım'ın özel sorguları `apiUrl` ister; Kuveyt Türk sorgu sunmaz). `ToslaPos` özel sorgu (`apiUrl` ile), `getInstallmentRates` (6 haneli BIN ile) ve `getInstallmentPrices` (TL cinsinden tutarla) sunar; taksit sorgusu sunan ilk gateway'dir. `ParamPos` ve `PayTrPos` özel sorgu, `history`, `getInstallmentRates` ve `getBinList` sunar. `IyzicoPos` özel sorgu (`apiUrl` ile), `history`, `getInstallmentPrices` ve `getBinList` sunar. Asseco, PayFlex V4, VakıfBank Ortak Ödeme, InterPos ve POSNET gateway'lerinde yalnız
`customQuery` vardır; diğer sorgular `UnsupportedTransactionTypeError` ile reddedilir. Ayrıntı için [sorgular kılavuzuna](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md) bakın.

## Tasarım

1. Durumsuz, async API: her ağ metodu kendi cevabını döner; `isSuccess()` / `getResponse()` durumu yoktur.
2. Sipariş ve normalize cevap anahtarları snake_case'tir ve her gateway'de aynıdır.
3. Callback doğrulamasını kapatan bir seçenek yoktur; her gateway'in callback'lerini nasıl doğruladığı [güvenlik kılavuzunda](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md#how-each-gateway-verifies-callbacks) listelenir.
4. Hassas veri (PAN, CVV, son kullanma, şifreler, store key) logger'a ulaşmadan maskelenir.
5. Sabit zamanlı hash karşılaştırması; Asseco hash'i bankanın beklediği doğal, büyük/küçük harf duyarsız anahtar sıralamasını birebir kullanır.
6. Ek Asseco, Garanti ve Akbank korumaları: dönen sipariş numarası ve tutar siparişle karşılaştırılır, Asseco ve
   Garanti'de ayrıca ödeme modeli de (Garanti'de bunlara ek olarak terminal ve para birimi)
   (`OrderMismatchError`; banka onay verdiyse `paymentMayHaveCompleted` ile); Akbank'ta callback'teki sipariş numarası ve
   üye işyeri/terminal doğrudan, tutar, para birimi, işlem türü, taksit sayısı ve sipariş durumu ise bankanın sipariş geçmişi
   üzerinden doğrulanır; provizyon verilmiş ama 3D başarısız
   cevap `declined` olur ve `requires_manual_review` ile işaretlenir.
7. Ek PayFlex korumaları: katı 3D kuralı (Status `Y`, ECI `02`/`05`, CAVV, varsa `MdStatus` 1), callback tutar, para
   birimi ve üye işyeri bağlaması, isteğe bağlı `require_3d_hash`.
8. VakıfBank varsayılan uçları 8443 portunu kullanır; `MerchantType` hesap başına ayarlanır.
9. Giden veriyi incelemek veya değiştirmek için kancalar (`onRequestDataPrepared`, `onBefore3DFormHashCalculated`).
10. `fetch` tabanlı ince HTTP katmanı (enjekte edilebilir, varsayılan zaman aşımı 60 sn); banka HTML/WAF sayfaları
    `PosHttpError` fırlatır.
11. Her gateway'de aynı olan kütüphane genelindeki kurallar ([güvenlik kılavuzu](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)): `createWithoutCard: true` ile kurulan bir form asla kart içermez ([Kartsız form kurmak](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md#building-forms-without-the-card)); yeni ödemeler için tek bir sipariş numarası kuralı vardır: 1 ile 64 arası harf, rakam, `_` veya `-`, ilk karakter harf veya rakam; daha önce oluşturulmuş siparişler ise çalışmaya devam eder ([Sipariş numaraları](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md#order-ids)); para hareketi yapan bir istekten sonra sonuç taşımayan cevap bilinmeyen bir sonuçtur ve `declined` değil `PosHttpError` fırlatır ([Sonuç bilinmiyor](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md#outcome-unknown)); her `status`, `cancel`, `refund`, `orderHistory` ve `payment` sonucunda `status`, `order_id`, `proc_return_code`, `error_code`, `error_message` ve `all` anahtarları bulunur ([Ödemeden sonra](https://github.com/mkiyak/typescript-pos/blob/main/guides/after-payment.md)).

## Güvenlik

Açık bildirmek için [SECURITY.md](https://github.com/mkiyak/typescript-pos/blob/main/SECURITY.md), canlıya çıkış kontrol listesi için
[guides/security.md](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md) dosyasına bakın. PCI DSS: PayFlex 3D Secure (MPI) kart verisinin
sunucunuzdan geçmesini gerektirir; bu nedenle SAQ D kapsamına girersiniz. Asseco 3D Pay Hosting kart verisini
sunucunuzun dışında tutar.

## Versiyonlama

[SemVer](https://semver.org). 1.0 öncesinde kırıcı değişiklik minor, diğer değişiklikler patch sürümü artırır.
Commit'ler [Conventional Commits](https://www.conventionalcommits.org) kurallarına uyar; sürümler
[Changesets](https://github.com/changesets/changesets) ile yönetilir (bkz. [CONTRIBUTING.md](https://github.com/mkiyak/typescript-pos/blob/main/CONTRIBUTING.md)).

### 0.14'e yükseltme

Aşağıdaki değişiklikler davranışı değiştirir; ayrıntılar değişiklik günlüğündedir.

- `createWithoutCard: true` asla bir tarayıcı formuna kart koymaz; yine de verdiğiniz kart atılır.
- Yeni bir ödeme (3D formu, 3D'siz satış, ön provizyon) için sipariş numarası 1 ile 64 arası harf, rakam, `_` veya `-`
  olmalı ve harf ya da rakamla başlamalıdır (POSNET: en çok 20 karakter; VakıfBank Ortak Ödeme artık `_` kabul etmez).
  Daha önce oluşturulmuş siparişler çalışmaya devam eder: callback, provizyon kapama, iptal, iade ve durum sorgusu,
  siparişin oluşturulduğu numarayı kabul eder (kontrol karakteri içermeyen metin ya da güvenli, negatif olmayan bir tam sayı).
- Asseco 3D Secure callback'leri, provizyon gönderilmeden önce siparişin numarası, tutarı ve para birimiyle eşleşmelidir.
- Para hareketi yapan bir istekten (iadeler dahil) sonra sonuç taşımayan cevap `declined` yerine `PosHttpError` fırlatır.
- `ResponseDataMapperInterface` arayüzüne `readProcReturnCode(raw): string | null` eklendi; özel cevap mapper'ları bunu
  uygulamalıdır.
- `IyzicoPos.make3DPayPayment` artık `UnsupportedPaymentModelError` fırlatır (önceden `UnsupportedTransactionTypeError`).

## Lisans

[MIT](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

English: [README.md](https://github.com/mkiyak/typescript-pos/blob/main/README.md)
