# typescript-pos

[![CI](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/mkiyak/typescript-pos/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/typescript-pos.svg)](https://www.npmjs.com/package/typescript-pos)
[![lisans](https://img.shields.io/github/license/mkiyak/typescript-pos.svg)](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

Türk bankalarının sanal POS altyapılarını (3D Secure akışları dahil) tek, durumsuz (stateless) ve async bir arayüz arkasında
toplayan TypeScript kütüphanesi. Node.js 22 veya üzeri gerekir; ESM ve CommonJS desteklenir, çalışma zamanı bağımlılıkları yalnızca
`fast-xml-parser` ve `iconv-lite`'tır.

> Durum: v0.1, 1.0 öncesi. Minor sürümler kırıcı değişiklik içerebilir (bkz. [Versiyonlama](#versiyonlama)).

## Desteklenen gateway'ler

| Gateway        | Bankalar                                                                                          | Doğrulama                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssecoPos`    | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, QNB Finansbank (Asseco)   | Birim testli; 3D hash'i PHP ile karşılaştırmalı test edildi (1000 rastgele kümede 0 uyuşmazlık).                                                                                                            |
| `PayFlexV4Pos` | VakıfBank (8443 portu), Ziraat (PayFlex)                                                          | Birim testli. VakıfBank herkese açık TEST ortamında 2026-11-23'te canlı doğrulandı: 3D kayıt kontrolü (Status `Y`), 3D'siz Satış (`0000`) ve İptal (`0000`). |
| `PayFlexCPV4Pos` | VakıfBank (Güvenli Ortak Ödeme, port 8443) | Birim testli. |
| `GarantiPos` | Garanti BBVA | Birim testli; hash'ler ve tutar biçimi PHP'ye karşı diferansiyel test edildi. |
| `AkbankPos` | Akbank (sanal POS API) | Birim testli; imzalar ve tutar biçimi PHP'ye karşı diferansiyel test edildi. |

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

Hata yönetimi dahil tam ve derleme denetimli sürümler [`examples/`](https://github.com/mkiyak/typescript-pos/tree/main/examples) altındadır. Adım adım kılavuzlar:

- [Asseco 3D Pay Hosting](https://github.com/mkiyak/typescript-pos/blob/main/guides/asseco-3d-payment.md)
- [PayFlex V4 3D Secure](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-3d-payment.md)
- [VakıfBank Ortak Ödeme (3D Host / 3D Pay)](https://github.com/mkiyak/typescript-pos/blob/main/guides/payflex-cp-payment.md)
- [Garanti BBVA 3D ödeme](https://github.com/mkiyak/typescript-pos/blob/main/guides/garanti-3d-payment.md)
- [Akbank sanal POS ödemesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/akbank-pos-payment.md)
- [Sorgular (özel banka istekleri)](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md)
- [Güvenlik ve canlıya çıkış kontrol listesi](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md)

Diğer işlemler: `pos.cancel(order)`, `pos.refund(order)` (`order.order_amount` verilmiş ve `order.amount` ondan
küçükse kısmi iade), `pos.status(order)`, `pos.orderHistory(order)` (Asseco, Garanti ve Akbank), 3D Secure'suz ödeme için
`pos.payment(MODEL.NON_SECURE, ...)` ve ön/son provizyon için `TX_TYPE.PAY_PRE_AUTH` / `TX_TYPE.PAY_POST_AUTH`.

### Test ve canlı yapılandırma

`posProductionConfig` banka adıyla anahtarlanır (`isbank`, `akbank`, `vakifbank`, ...). `posTestConfig` ise
sağlayıcı adıyla anahtarlanır: `asseco`, `vakifbank`, `ziraat-vpos`. Bu yüzden test ortamındaki bir
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
(`pos.payment(...)`, `make3DPayment`, ...) ve callback alanlarına doğrudan güvenmeyin. `OrderMismatchError`
reddedilen (declined) cevaplar dahil her Asseco 3D Pay / 3D Host callback'inde, ayrıca `storetype` değeri ödeme
modeliyle eşleşmeyen 3D Secure callback'lerinde oluşabilir (`error.field` değeri `order_id`, `amount` veya
`storetype` olur): bunu sipariş için başarısızlık sayın ve `error.response` içindeki
`transaction_id`, `proc_return_code` alanlarını okuyun. `error.paymentMayHaveCompleted` `true` ise banka bu
callback için tamamlanmış bir ödeme bildirmiştir, yani karttan çekim yapılmış olabilir: ilgili kişiyi uyarın, ödemeyi
iptal veya iade edin. `requires_manual_review: true` taşıyan reddedilmiş (declined) bir cevap da (3D doğrulaması
başarısız olduğu hâlde banka provizyon vermiştir) para hareketi olmuş olabileceğini gösterir: inceleyin. Ayrıntılar
kılavuzlardadır.

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

**Sonuç bilinmiyor: ödemeleri asla körlemesine tekrar denemeyin.** Para hareketi yapan bir istekten (PayFlex 3D
Secure veya Asseco `MODEL.THREE_D_SECURE` provizyonu, 3D'siz ödemeler, ön provizyon kapama, iptal, iade) sonra gelen
bir `PosHttpError` (zaman aşımı, 2xx dışı cevap, HTML/WAF sayfası), banka isteği zaten işledikten sonra oluşmuş
olabilir. Tekrar denemek müşteriden iki kez çekim yapılmasına yol açabilir. Önce `pos.status(order)` çağırın ve
yalnızca bankada işlemin kaydı yoksa tekrar deneyin.

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
olmalıdır. `GarantiPos` ayrıca `history` ve `getBinList`, `AkbankPos` ise `history` sunar. Asseco, PayFlex V4 ve VakıfBank Ortak Ödeme'de yalnız
`customQuery` vardır; diğer sorgular `UnsupportedTransactionTypeError` ile reddedilir. Ayrıntı için [sorgular kılavuzuna](https://github.com/mkiyak/typescript-pos/blob/main/guides/queries.md) bakın.

## Tasarım

1. Durumsuz, async API: her ağ metodu kendi cevabını döner; `isSuccess()` / `getResponse()` durumu yoktur.
2. Sipariş ve normalize cevap anahtarları snake_case'tir ve her gateway'de aynıdır.
3. 3D hash doğrulamasını kapatan bir seçenek yoktur. `AssecoPos` her zaman geçerli hash ister; `GarantiPos` imzalı callback'i her zaman doğrular, imzasız olanı yalnız ret olarak kabul eder (`require_3d_hash: true` onu da reddeder); `AkbankPos` 3D Pay, 3D Host ve başarılı 3D Secure callback'lerinde her zaman geçerli hash ister, onaylanan 3D Pay/Host sonuçlarını bankayla doğrular; `PayFlexV4Pos` callback `Hash` taşıyorsa her zaman doğrular, `Hash` eksikse yalnızca `require_3d_hash: true` ile reddeder.
4. Hassas veri (PAN, CVV, son kullanma, şifreler, store key) logger'a ulaşmadan maskelenir.
5. Sabit zamanlı hash karşılaştırması; Asseco hash'i bankanın beklediği doğal, büyük/küçük harf duyarsız anahtar sıralamasını birebir kullanır.
6. Ek Asseco ve Garanti korumaları: dönen sipariş numarası, tutar ve ödeme modeli (Garanti'de ayrıca terminal ve para birimi) siparişle karşılaştırılır
   (`OrderMismatchError`; banka onay verdiyse `paymentMayHaveCompleted` ile); provizyon verilmiş ama 3D başarısız
   cevap `declined` olur ve `requires_manual_review` ile işaretlenir.
7. Ek PayFlex korumaları: katı 3D kuralı (Status `Y`, ECI `02`/`05`, CAVV, varsa `MdStatus` 1), callback tutar, para
   birimi ve üye işyeri bağlaması, isteğe bağlı `require_3d_hash`.
8. VakıfBank varsayılan uçları 8443 portunu kullanır; `MerchantType` hesap başına ayarlanır.
9. Giden veriyi incelemek veya değiştirmek için kancalar (`onRequestDataPrepared`, `onBefore3DFormHashCalculated`).
10. `fetch` tabanlı ince HTTP katmanı (enjekte edilebilir, varsayılan zaman aşımı 60 sn); banka HTML/WAF sayfaları
    `PosHttpError` fırlatır.

## Güvenlik

Açık bildirmek için [SECURITY.md](https://github.com/mkiyak/typescript-pos/blob/main/SECURITY.md), canlıya çıkış kontrol listesi için
[guides/security.md](https://github.com/mkiyak/typescript-pos/blob/main/guides/security.md) dosyasına bakın. PCI DSS: PayFlex 3D Secure (MPI) kart verisinin
sunucunuzdan geçmesini gerektirir; bu nedenle SAQ D kapsamına girersiniz. Asseco 3D Pay Hosting kart verisini
sunucunuzun dışında tutar.

## Versiyonlama

[SemVer](https://semver.org). 1.0 öncesinde kırıcı değişiklik minor, diğer değişiklikler patch sürümü artırır.
Commit'ler [Conventional Commits](https://www.conventionalcommits.org) kurallarına uyar; sürümler
[Changesets](https://github.com/changesets/changesets) ile yönetilir (bkz. [CONTRIBUTING.md](https://github.com/mkiyak/typescript-pos/blob/main/CONTRIBUTING.md)).

## Lisans

[MIT](https://github.com/mkiyak/typescript-pos/blob/main/LICENSE)

English: [README.md](https://github.com/mkiyak/typescript-pos/blob/main/README.md)
