# Akış — yerel medya stüdyosu

YouTube video/ses; Instagram, X/Twitter ve Facebook gönderileri için yerel indirme arayüzü. Yalnızca kendi içeriğinizi veya indirme izniniz olan içerikleri kullanın. DRM, özel hesap veya erişim koruması aşılmaz.

## Kurulum ve çalıştırma

Windows 10/11 x64, Node.js 24 ve internet bağlantısı gerekir. Python gerekmez. Terminalde proje klasöründe:

```powershell
npm install
npm run setup:tools
npm run dev
```

Geliştirme arayüzü `http://127.0.0.1:5173`, API `http://127.0.0.1:3001`. Vite API isteklerini sunucuya yönlendirir. Üretim derlemesiyle tek sunucu:

```powershell
npm run build
npm start
```

Arayüzü `http://127.0.0.1:3001` üzerinden açın. İsteğe bağlı `PORT` ortam değişkeni API portunu değiştirir; geliştirmede Vite proxy portunu da eşleştirmek gerekir. Sunucu sadece `127.0.0.1` adresini dinler. Ağ geneline yayınlama desteklenmez.

## Gerçek indirme araçları

`npm run setup:tools`, resmî yayın API'lerinden uygun bağımsız yürütülebilirleri keşfeder, SHA256 manifestiyle doğrular ve sunucunun araç klasörüne atomik olarak yerleştirir. Kurulum sırasında indirilen araç sürümleri yazdırılır. Güncellemek için sunucuyu durdurup aynı komutu tekrar çalıştırın.

- yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/latest
- gallery-dl: geliştirme Codeberg'e taşındı; https://codeberg.org/mikf/gallery-dl/releases/latest
- FFmpeg: `ffmpeg-static` npm bağımlılığının platforma uygun gerçek yürütülebiliri.

Codeberg API geçici olarak erişilemiyorsa kurulumu, keşfedilip doğrulanmış resmî `v1.32.11` yayın adresinden tekrar dener. SHA256 dosyası da aynı resmî kaynaktan indirilir; bu aktarım bütünlüğü doğrulamasıdır, bağımsız imza doğrulaması değildir. Windows'ta Python'sız yt-dlp ve gallery-dl kurulumu desteklenir; macOS'ta gallery-dl otomatik kurulmaz. Araç eksikliği sağlık uç noktasında görünür; yt-dlp ve FFmpeg olmadan sistem hazır sayılmaz. gallery-dl olmadan fotoğraf fallback'i devre dışıdır.

## Kullanım ve platform sınırları

1. Platformu seçin ve tek bir video/gönderi bağlantısını yapıştırın.
2. Analiz sonucundan bir video veya albüm fotoğrafını seçin.
3. Kaynakta mevcut çözünürlük/FPS ve çıktı biçimini seçip indirmeyi başlatın.
4. İş tamamlandığında dosyayı kaydedin.

MP4 H.264/AAC, WebM VP9/Opus, MP3 128/192/320 kbps ve M4A AAC gerçek FFmpeg dönüşümleridir. Çözünürlük veya FPS büyütülmez; kaynakta olmayan birleşimler reddedilir. 29.97/59.94 kaynaklar seçimde 30/60 FPS ile eşleştirilir, çıktı kare hızı değiştirilmez. Yeniden kodlama zaman ve kalite kaybı yaratabilir. `original` dönüşüm yapmaz; ayrı video/ses akışları birleştirilmiş MKV olabilir.

Fotoğraflar gallery-dl metadata sonuçlarından alınır, JPG/PNG'ye dönüştürülebilir veya özgün biçiminde saklanabilir. Albümler en fazla 20 öğe içerir; her öğe ayrı indirilir, ZIP toplu indirme yoktur. Canlı yayın, kanal/profil arşivi ve sınırsız oynatma listesi desteklenmez. Instagram/X/Facebook fotoğraf ve albüm desteği gallery-dl'nin ilgili gönderiyi oturumsuz çözümleyebilmesine bağlıdır; her platformdaki her albüm destekleniyor değildir. Video ve fotoğraf analizi birbirinden bağımsız başarısız olabileceğinden karışık gönderilerde yalnızca çözümlenen öğeler gösterilebilir.

Platformlar IP, bölge, yaş, oturum, bot doğrulaması veya günlük kota nedeniyle herkese açık içerikleri bile engelleyebilir. Çerez/parola yükleme ve koruma aşma yoktur. Böyle durumlarda Türkçe hata gösterilir; uygulama sahte indirme veya başarı üretmez. Süresi dolmuş CDN bağlantılarında yeniden analiz edin. Küçük resimler tarayıcıdan doğrudan platform/CDN'ye yüklenir; reklam engelleyici veya kaynak politikası nedeniyle görünmeyebilir.

## API sözleşmesi

JSON istek ve yanıtlar kullanılır. Hatalar `{ "error": "Türkçe açıklama", "code": "STABLE_CODE" }` biçimindedir.

| Uç nokta | Davranış |
| --- | --- |
| `GET /api/health` | `{ready, tools:{ytDlp,galleryDl,ffmpeg}}`; araç varlık kontrolü, canlı platform erişim garantisi değil |
| `POST /api/inspect` | `{url,platform}`; platform: `youtube`, `instagram`, `twitter`, `facebook` |
| `POST /api/download` | `{mediaId,itemId,format,height,fps,bitrate}`; 202 `{id,status}` |
| `GET /api/jobs/:id` | `{id,status,progress,title,error?,downloadUrl?,filename?}` |
| `GET /api/jobs/:id/file` | Tamamlanmış dosya attachment olarak; hazır değilse 409 |

Analiz yanıtı `{id,title,author,thumbnail,duration,platform,items}`. Öğeler `{id,type,title,thumbnail,formats}`; biçimler `{id,ext,height,fps,hasAudio}`. Süre saniye, yükseklik piksel, bilinmeyen süre/yükseklik/FPS/thumbnail `null`. Biçim kimlikleri kaynak kimlikleridir; indirme API'si bunları istemciden yürütülebilir argüman olarak almaz, sunucuda saklanan metadata üzerinden seçer. `hasAudio` tek kaynak biçiminde ses olup olmadığını belirtir; ayrı ses varsa indirmede birleştirilebilir.

İş durumları `queued`, `downloading`, `processing`, `completed`, `failed`. İlerleme 0–100; kaynak indirme yüzdesi ilk %80'e eşlenir, dönüşüm süresince %85 gösterilir; dönüşüm için sahte zaman tahmini yoktur. Varsayılan bitrate 192, height/fps `null`. Kalite uyuşmazlığı 400, süresi dolmuş metadata/iş 404, araç eksikliği 503, analiz zaman aşımı 504, kaynak erişim hatası 502, kapasite doluluğu 429.

## Güvenlik, sınırlar ve yaşam döngüsü

- Mutasyonlar JSON ve aynı kaynak gerektirir; yalnızca yerel Vite 5173 geliştirme kaynaklarına istisna tanınır. Origin'siz yerel CLI istekleri kabul edilir. CORS açılmaz; localhost Host doğrulaması DNS rebinding saldırılarını sınırlar.
- İzin verilen platform ana makineleri tam eşleşir; kullanıcı bilgisi, özel port, IP adresi ve benzer görünen sahte alan adları reddedilir.
- Araçlar shell olmadan argüman dizileriyle çalışır. Kullanıcı yerel config'i yok sayılır. Çıktı yolları rastgele iş kimliklerinden türetilir.
- Araç HTTP/HTTPS trafiği yerel doğrulayıcı proxy üzerinden geçer; her hedef ve yönlendirme için DNS sonuçları kontrol edilir, özel/loopback/link-local adresler engellenir ve bağlantı doğrulanmış IP'ye sabitlenir. Fotoğraf indirmesi de aynı DNS sabitlemesini kullanır. Bu, güvenilmeyen araçlara karşı işletim sistemi sandbox'ı değildir; yalnızca güvenilir resmî araçları çalıştırın.
- En fazla 3 eşzamanlı analiz, 2 indirme/dönüşüm, toplam 12 iş ve 100 metadata kaydı. JSON 8 KiB, metadata araç çıktısı 8 MiB, albüm 20 öğe. API dakikada 240 istek ile sınırlıdır.
- Analiz 120 saniye; ağ soketleri 20–30 saniye; kaynak indirme 12 dakika; dönüşüm 15 dakika; toplam iş 28 dakika ile sınırlıdır. İstemci analiz sırasında ayrılırsa analiz iptal edilir. Kabul edilmiş indirme, tarayıcı kapansa da devam eder.
- Kaynak için yt-dlp 512 MiB sınırı, fotoğraf 100 MiB, bitmiş çıktı 768 MiB. İş dizini saniyelik kontrolle 1.5 GiB sınırında durdurulur; kontrol aralığında kısa aşım mümkündür. Diskte en az 2 GiB boşluk gerekir. Toplam en fazla 12 iş olduğundan saklama sınırlıdır; bu katı OS disk kotası değildir. Ağdan boyutu belirsiz kaynak ve paralel yazımlar için boş disk payı bırakın.
- Metadata ve bitmiş/başarısız işler 1 saat sonra dakikalık temizleyiciyle kaldırılır. Aktif dosya transferi sırasında silinmez. Aynı seçeneklerle yinelenen indirme, süresi dolmamış aktif/tamamlanmış iş kimliğini geri verir; başarısız iş yeniden denenebilir. Farklı istemciler yerel uygulamanın aynı iş havuzunu paylaşır.
- İşler bellektedir, kalıcı kuyruk yoktur. Süreç kapanır/çökerse işlemler devam ettirilemez. Sonraki açılışta yalnızca uygulamanın `job-UUID` biçimindeki çalışma dizinleri temizlenir. Yeniden analiz edip indirin. Bir veri dizinine aynı anda birden fazla sunucu açmayın.
- SIGINT/SIGTERM kabulü durdurur ve çalışan işleri iptal eder. Alt araçları iptal etmek bağımsız araç çocuk süreçlerine OS seviyesinde süreç-ağacı garantisi vermez. Yeniden başlatma öncesi takılı kalmış harici süreçleri kontrol edin. Veritabanı veya migration yoktur.

## Testler ve doğrulama

```powershell
npm run test:backend
npm run test:frontend
npm run build
```

Backend testleri gerçek yerel HTTP sunucusunu ve mock araç çalıştırıcısını kullanır: sözleşmeler, sahte URL/Host/Origin, özel IP, gövde sınırı, metadata gizliliği, kalite seçimi, yinelenen iş, hata gizliliği, galeri fallback'i, dönüşüm argümanları ve süreç süre/çıktı/iptal sınırları. Node testleri için Go race detector uygulanmaz.

Bu kurulumda yt-dlp `2026.08.19`, gallery-dl `1.32.11`, FFmpeg `6.1.1` sürümleri çalıştırılarak doğrulandı. YouTube'un herkese açık “Me at the zoo” videosu gerçek araçla analiz edildi (12 kaynak biçimi); MP3 128 kbps indirme ve dönüşümü 304941 bayt dosya üretti. Instagram/X/Facebook için canlı içerik indirme doğrulaması yapılmadı; oturum ve platform sınırlamaları yukarıdaki gibi geçerlidir. Otomatik testler harici platform erişimine bağımlı değildir.
