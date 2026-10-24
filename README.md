# ERP Birimi İş Takip

ERP biriminin hangi birime ne kadar süre ayırdığını ve yapılan işleri paylaşımlı olarak takip/raporlama uygulaması.

- **Arayüz:** Statik web sayfası (HTML/CSS/JS, derleme yok). GitHub Pages'ta yayınlanır.
- **Sunucu + veri:** Google E-Tablo + ona bağlı Google Apps Script (web uygulaması).
- **Giriş:** Google hesabı ile (izin verilen e-posta listesi = *Kullanıcılar* ekranı).

```
index.html, css/, js/        → arayüz (GitHub Pages)
js/config.js                 → sunucu URL'si ve Google Client ID
backend/Logic.js             → iş kuralları (sunucu ve demo modu ortak kullanır)
backend/Code.js              → Apps Script giriş noktası, E-Tablo deposu, token doğrulama
backend/appsscript.json      → Apps Script manifesti
serve.ps1                    → yerel geliştirme sunucusu (Windows)
```

## Özellikler

| Ekran | Kim görür | Özet |
|---|---|---|
| Dashboard | Herkes | Kişiye özel: kendisine atanmış proje/alt projeler öncelik sırasıyla (sürükle-bırak / oklarla sıralanır), canlı “Başlat / Bitir”, bugün-hafta-ay toplamları |
| İş Logu | Herkes | Sonradan kayıt ekleme/düzenleme. Personel oturum açan kişi olarak gelir; normal kullanıcı değiştiremez. Proje seçilince Birim projeden dolar (değiştirilebilir), “Günlük İş” seçilince boş gelir. Aynı kişinin kayıtları çakışamaz. |
| Projeler | Herkes | Otomatik kod (PRJ-000001…), alt proje, “Ait Olduğu Birim”, durum, atama (yönetici herkese, kullanıcı yalnız kendine), soft delete (“Silindi” etiketi; kullanıcı yalnız kendi eklediğini, yönetici hepsini siler; yönetici geri alabilir) |
| Raporlar | Herkes (normal kullanıcı yalnız kendi verisi) | İsteğe bağlı dönem (bugün, hafta, ay, çeyrek, yıl, özel), Birim / Proje / Personel bazında Geliştirme-Günlük İş kırılımı, detay, Excel (CSV) çıktısı |
| Birimler | Yönetici | Birim ekle/düzenle/sil (soft delete) |
| Kullanıcılar | Yönetici | İzinli e-postalar, “Yönetici” yetkisi, pasifleştirme |
| API Ayarları | Yönetici | Sunucu URL / Client ID, bağlantı testi, Google E-Tablo bağlantısı |

**Talep türü:** Projeye bağlı kayıt = *Geliştirme*, projesiz kayıt = *Günlük İş* (birim her kayıtta ayrıca seçilir).
**Canlı bildirim:** Çalışırken başka işe “Başlat” denirse önceki çalışma o anda otomatik kapanır; böylece ara verip başka işe geçme ayrı kayıtlar olarak tutulur.
**Veri gizliliği:** E-Tablo yalnızca sahibine ve *Yönetici* yetkili kullanıcılara paylaşılır; yetki değiştikçe paylaşım otomatik güncellenir. Diğer kullanıcılar veriye yalnızca API üzerinden, kendi yetkileri kadar erişir.

## Demo modu (kurulumsuz deneme)

`js/config.js` boşken uygulama demo modunda açılır: veriler tarayıcıda tutulur, giriş ekranında örnek kullanıcılar seçilir.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Ardından http://localhost:8080 adresini açın.

## Canlı kurulum

### 1. Google E-Tablo ve Apps Script
1. Yeni bir Google E-Tablo oluşturun (ör. “ERP İş Takip Veri”). Kimseyle paylaşmayın.
2. **Uzantılar › Apps Script**'i açın.
3. `Code.gs` içeriğini `backend/Code.js` ile değiştirin. **+ › Komut dosyası** ile `Logic` adında bir dosya ekleyip `backend/Logic.js` içeriğini yapıştırın.
4. **Proje Ayarları** › “appsscript.json manifest dosyasını düzenleyicide göster”i işaretleyin; içeriği `backend/appsscript.json` ile değiştirin (saat dilimi Europe/Istanbul).
5. Düzenleyicide `kurulum` fonksiyonunu seçip **Çalıştır**'a basın, izinleri onaylayın. Sayfalar oluşur ve siz ilk yönetici olarak eklenirsiniz.

### 2. Google OAuth istemci kimliği
1. https://console.cloud.google.com › yeni proje › **API'ler ve Hizmetler › OAuth izin ekranı** (Dahili ya da Harici; harici ise kullanıcıları test kullanıcısı olarak ekleyin veya yayınlayın).
2. **Kimlik bilgileri › Kimlik bilgisi oluştur › OAuth istemci kimliği › Web uygulaması**.
3. **Yetkili JavaScript kaynakları:** GitHub Pages adresi (ör. `https://kurum-adi.github.io`) ve yerel test için `http://localhost:8080`.
4. Oluşan *Client ID*'yi kopyalayın.
5. Apps Script › **Proje Ayarları › Komut dosyası özellikleri** › `GOOGLE_CLIENT_ID` = bu değer.

### 3. Web uygulaması olarak dağıtım
1. Apps Script › **Dağıt › Yeni dağıtım › Web uygulaması**.
2. *Şu kullanıcı olarak yürüt:* **Ben** · *Erişimi olanlar:* **Herkes**. (Kimlik doğrulama uygulama içinde Google token'ı ve izinli e-posta listesiyle yapılır.)
3. Verilen `https://script.google.com/macros/s/…/exec` adresini kopyalayın.
4. Kodda değişiklik yaptığınızda **Dağıt › Dağıtımları yönet › Düzenle › Yeni sürüm** ile aynı URL'yi güncelleyin.

### 4. Arayüz yapılandırması ve yayın
1. `js/config.js` içine `backendUrl` ve `googleClientId` değerlerini yazın.
2. GitHub'da kurum için bir **Organization** açın, depoyu oraya oluşturun/taşıyın (Settings › Transfer ownership).
3. Depoda **Settings › Pages › Deploy from a branch › main / (root)**.
4. Yayın adresini OAuth istemcisinin yetkili JavaScript kaynaklarına eklediğinizden emin olun.

### 5. Kullanıcılar
Yönetici olarak giriş yapın › **Kullanıcılar** › ekibin Google e-postalarını ekleyin, gerekenlere *Yönetici* verin › **Birimler** ekranında birimleri tanımlayın.

## Veri yapısı (E-Tablo sayfaları)

| Sayfa | Sütunlar |
|---|---|
| Kullanicilar | id, email, ad, yonetici, aktif, olusturma |
| Birimler | id, ad, aciklama, silindi, olusturma |
| Projeler | id, kod, ad, ustProjeId, birimId, durum, aciklama, olusturan, olusturma, silindi, silen, silinme |
| Atamalar | id, projeId, email, oncelik, atayan, olusturma |
| Loglar | id, personel, projeId, birimId, baslangic, bitis, aciklama, olusturan, olusturma, guncelleme, silindi |
| Sayaclar | id, deger (proje kod sayacı) |

Tarih-saatler `YYYY-MM-DDTHH:mm` metni olarak tutulur. Sütun sırasını değiştirmeyin; yeni sütunlar sona eklenmelidir.
