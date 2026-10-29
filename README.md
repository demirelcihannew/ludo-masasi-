# Ludo Masası

Arkadaşlarınla davet linkiyle oynanan online Ludo. Hesap gerekmez: linke tıkla, adını yaz, oyna.

## Modlar
- **Online oda:** Oda kur, linki gönder. Boş yerlere bot ekleyebilirsin. 2–4 oyuncu.
- **Bilgisayara karşı:** 1–3 botla.
- **Aynı cihazda:** Telefonu elden ele vererek.

## Dosyalar
- `server.js` — oyun sunucusu (odalar, botlar, yeniden bağlanma)
- `public/engine.js` — oyun kuralları (sunucu ve tarayıcı ortak kullanır)
- `public/index.html` — oyun ekranı
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
- Bağlantısı kopan oyuncu aynı sekmeden geri dönerse yerine kaldığı yerden devam eder. 15 saniyeden uzun yoksa onun yerine bot oynar.
- Kimsenin kalmadığı odalar 30 dakika sonra silinir.
