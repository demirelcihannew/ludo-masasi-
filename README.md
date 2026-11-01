# Oyun Masası

İki oyunluk bir oyun sitesi. Hesap gerekmez: linke tıkla, adını yaz, oyna.

- **Ludo Masası** — klasik Ludo. 2-4 oyuncu, takımlı 2+2 modu var.
- **Son Kart** — renk/sayı eşleştirmeli kart oyunu. 2-4 oyuncu.

Her iki oyun da online (davet linkiyle) ve bilgisayara karşı oynanır. Oyun içi sohbet,
iki dil (Türkçe/İngilizce), ses ve hamle başına 20 saniye süre vardır.

## Dosyalar
- `server.js` — oyun sunucusu (odalar, botlar, sohbet, yeniden bağlanma)
- `public/index.html` — oyun seçme ekranı
- `public/ludo.html` — Ludo ekranı
- `public/kartlar.html` — Son Kart ekranı
- `public/engine.js` — Ludo kuralları (sunucu ve tarayıcı ortak kullanır)
- `public/cards.js` — Son Kart kuralları (sunucu ve tarayıcı ortak kullanır)
- `package.json` — Node.js ayarları

## Bilgisayarında denemek (isteğe bağlı)
Node.js 18 veya üstü kurulu olmalı.

```
npm install
npm start
```

Sonra tarayıcıda `http://localhost:3000` adresini aç.

## Notlar
- Sunucu yeniden başlarsa açık odalar silinir; yeni oda kurmak yeterli.
- Bağlantısı kopan oyuncu aynı sekmeden geri dönerse kaldığı yerden devam eder.
  15 saniyeden uzun yoksa yerine bot oynar.
- Kimsenin kalmadığı odalar 30 dakika sonra silinir.
- Kart oyununda eller gizlidir: sunucu her oyuncuya yalnızca kendi elini gönderir,
  deste ve rakip elleri tarayıcıya hiç gitmez.
- Eski `?oda=KOD` davet linkleri çalışmaya devam eder; ana sayfa kodun hangi oyuna
  ait olduğunu sunucuya sorup doğru sayfaya yönlendirir.
- Son Kart, UNO'nun oynanışıyla aynı kurallara sahiptir ama bağımsız bir oyundur;
  adı, kart tasarımı ve kodu bu projeye aittir.
