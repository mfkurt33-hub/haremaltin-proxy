const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

let sonFiyatlar   = null;
let sonGuncelleme = null;
let tarayici      = null;
let sayfa         = null;

async function haremBaglan() {
  try {
    console.log('🔄 Tarayıcı başlatılıyor...');

    tarayici = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    sayfa = await tarayici.newPage();

    // WebSocket mesajlarını yakala
    const client = await sayfa.target().createCDPSession();
    await client.send('Network.enable');

    // Sayfa WebSocket mesajlarını dinle
    await sayfa.evaluateOnNewDocument(() => {
      const origWS = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        const ws = new origWS(url, protocols);
        ws.addEventListener('message', (event) => {
          window._wsMessages = window._wsMessages || [];
          window._wsMessages.push(event.data);
        });
        return ws;
      };
      window.WebSocket.prototype = origWS.prototype;
    });

    console.log('🌐 Haremaltin sayfası açılıyor...');
    await sayfa.goto('https://www.haremaltin.com/altin-fiyatlari', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('✅ Sayfa açıldı! Fiyatlar bekleniyor...');

    // DOM'dan fiyatları periyodik olarak oku
    setInterval(async () => {
      try {
        const fiyatlar = await sayfa.evaluate(() => {
          const result = {};
          // Haremaltin'in DOM yapısına göre fiyatları çek
          const satirlar = document.querySelectorAll('[data-code], .price-row, tr[id]');
          satirlar.forEach(el => {
            const code  = el.getAttribute('data-code') || el.id;
            if (!code) return;
            const alis  = el.querySelector('.alis, [data-alis], .buying')?.textContent?.trim();
            const satis = el.querySelector('.satis, [data-satis], .selling')?.textContent?.trim();
            if (alis && satis) {
              result[code] = { alis, satis, code };
            }
          });
          return result;
        });

        if (Object.keys(fiyatlar).length > 0) {
          sonFiyatlar   = fiyatlar;
          sonGuncelleme = new Date().toISOString();
          io.emit('price_changed', { data: fiyatlar, meta: { time: Date.now() } });
          console.log(`✅ ${Object.keys(fiyatlar).length} fiyat güncellendi`);
        }

        // WS mesajlarını da kontrol et
        const wsMessages = await sayfa.evaluate(() => {
          const msgs = window._wsMessages || [];
          window._wsMessages = [];
          return msgs;
        });

        for (const msg of wsMessages) {
          if (msg.startsWith('42')) {
            try {
              const arr = JSON.parse(msg.substring(2));
              if (arr[0] === 'price_changed' && arr[1]?.data) {
                sonFiyatlar   = arr[1].data;
                sonGuncelleme = new Date().toISOString();
                io.emit('price_changed', arr[1]);
                console.log('📨 WS fiyat alındı:', new Date().toLocaleTimeString());
              }
            } catch(_) {}
          }
        }
      } catch (e) {
        console.log('⚠️ Fiyat okuma hatası:', e.message);
      }
    }, 3000);

  } catch (e) {
    console.log('❌ Tarayıcı hatası:', e.message);
    setTimeout(haremBaglan, 10000);
  }
}

app.get('/', (req, res) => {
  res.json({ durum: 'çalışıyor', guncelleme: sonGuncelleme, fiyatSayisi: sonFiyatlar ? Object.keys(sonFiyatlar).length : 0 });
});

app.get('/fiyatlar', (req, res) => {
  if (!sonFiyatlar) return res.status(503).json({ hata: 'Henüz fiyat alınamadı' });
  res.json({ data: sonFiyatlar, guncelleme: sonGuncelleme });
});

app.get('/health', (req, res) => res.json({ durum: 'ok' }));

io.on('connection', (socket) => {
  console.log('📱 Uygulama bağlandı:', socket.id);
  if (sonFiyatlar) {
    socket.emit('price_changed', { meta: { time: Date.now() }, data: sonFiyatlar });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Port ${PORT}'de çalışıyor`);
  haremBaglan();
});
