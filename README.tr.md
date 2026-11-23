# typescript-pos

Türk bankalarının sanal POS altyapılarını (3D Secure akışları dahil) tek, durumsuz (stateless) ve async bir arayüz arkasında
toplayan TypeScript kütüphanesi. Node.js 20 veya üzeri gerekir.

> Durum: erken geliştirme aşamasında. Henüz yayınlanmış bir sürüm yoktur.

## Durum

| Gateway                                                                                                 | Bankalar                                                                                    | Durum             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------- |
| `AssecoPos`                                                                                             | İş Bankası, Ziraat (Asseco), Akbank (Asseco), Halkbank, TEB, Şekerbank, Finansbank (Asseco) | planlandı (v0.1)  |
| `PayFlexV4Pos`                                                                                          | VakıfBank, Ziraat (PayFlex)                                                                 | planlandı (v0.1)  |
| `PayFlexCPV4Pos`                                                                                        | VakıfBank Güvenli Ortak Ödeme                                                               | planlandı (v0.2)  |
| Garanti, Akbank (yeni API), PosNet, PayFor, InterPos, Kuveyt, VakıfKatılım, Param, Tosla, PayTR, Iyzico |                                                                                             | planlandı (v0.3+) |

## Kurulum

```sh
npm install typescript-pos
```

Kullanım dokümantasyonu ilk sürümle birlikte eklenecektir.

## Lisans

[MIT](./LICENSE)

English: [README.md](./README.md)
