const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Son fiyatları hafızada tut
let sonFiyatlar = null;
let sonGuncelleme = null;

// ── Haremaltin WebSocket bağlantısı ──────────────────
const { io: ioClient } = require('socket.io-client');

function haremBaglan() {
  console.log('🔄 Haremaltin\'e bağlanılıyor...');

  const harem = ioClient('wss://hrmsocketonly.haremaltin.com', {
    path: '/socket.io/',
    transports: ['websocket'],
    extraHeaders: {
      'Origin':          'https://www.haremaltin.com',
      'Referer':         'https://www.haremaltin.com/altin-fiyatlari',
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9',
    },
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  });

  harem.on('connect', () => {
    console.log('✅ Haremaltin bağlandı!');
  });

  harem.on('price_changed', (payload) => {
    if (!payload || !payload.data) return;
    sonFiyatlar   = payload.data;
    sonGuncelleme = new Date().toISOString();
    // Bağlı tüm uygulama istemcilerine ilet
    io.emit('price_changed', payload);
    console.log('📨 Fiyat güncellendi:', new Date().toLocaleTimeString('tr-TR'));
  });

  harem.on('disconnect', (reason) => {
    console.log('⚠️ Haremaltin bağlantısı kesildi:', reason);
  });

  harem.on('connect_error', (err) => {
    console.log('❌ Bağlantı hatası:', err.message);
  });
}

// ── REST API endpoint'leri ───────────────────────────
app.get('/', (req, res) => {
  res.json({
    durum:    'çalışıyor',
    versiyon: '1.0.0',
    guncelleme: sonGuncelleme,
    fiyatSayisi: sonFiyatlar ? Object.keys(sonFiyatlar).length : 0,
  });
});

// Son fiyatları HTTP ile al (WebSocket bağlanamayan durumlar için)
app.get('/fiyatlar', (req, res) => {
  if (!sonFiyatlar) {
    return res.status(503).json({ hata: 'Henüz fiyat alınamadı' });
  }
  res.json({
    data:       sonFiyatlar,
    guncelleme: sonGuncelleme,
  });
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.json({ durum: 'ok', zaman: new Date().toISOString() });
});

// ── Uygulama istemci Socket.IO ───────────────────────
io.on('connection', (socket) => {
  console.log('📱 Uygulama bağlandı:', socket.id);

  // Bağlanınca hemen son fiyatları gönder
  if (sonFiyatlar) {
    socket.emit('price_changed', {
      meta: { time: Date.now(), tarih: sonGuncelleme },
      data: sonFiyatlar,
    });
  }

  socket.on('disconnect', () => {
    console.log('📱 Uygulama ayrıldı:', socket.id);
  });
});

// ── Başlat ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Proxy sunucu port ${PORT}'de çalışıyor`);
  haremBaglan();
});
