import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { createClient } from 'redis';
import { db } from './db/index.js';
import { users, likedSongs, playlists } from './db/schema.js';
import { eq, and } from 'drizzle-orm';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// CONFIG
// ==========================================
const PORT = process.env.PORT || 3001;
const HOST_IP = process.env.HOST_IP || null;
const SAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php?_format=json&_marker=0&api_version=4&ctx=web6dot0';

// Fallback Piped Instances for YouTube
const PIPED_INSTANCES =[
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://pipedapi.syncpundit.io'
];

// ==========================================
// REDIS SETUP (Graceful fallback)
// ==========================================
let redisClient = null;
let redisReady = false;

const initRedis = async () => {
    try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        redisClient = createClient({ url: redisUrl });
        
        redisClient.on('error', (err) => {
            if (redisReady) console.log('⚠️ Redis disconnected:', err.message);
            redisReady = false;
        });
        redisClient.on('connect', () => {
            console.log('📦 Redis connected');
            redisReady = true;
        });
        await redisClient.connect();
    } catch (e) {
        console.log('⚠️ Redis setup error:', e.message);
    }
};
initRedis();

const cacheGet = async (key) => {
    if (!redisReady || !redisClient) return null;
    try { return await redisClient.get(key); } catch { return null; }
};

const cacheSet = async (key, ttl, value) => {
    if (!redisReady || !redisClient) return;
    try { await redisClient.setEx(key, ttl, value); } catch { }
};

// ==========================================
// DB ENDPOINTS (Neon + Drizzle) - UNTOUCHED
// ==========================================
app.post('/api/users', async (req, res) => {
    const { id, name, email, image, password } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID and Name required' });
    try {
        const result = await db.insert(users).values({ id, name, email, image, password })
            .onConflictDoUpdate({ target: users.id, set: { name, email, image, password } }).returning();
        res.json(result[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length > 0) return res.json(existing[0]);
        res.status(404).json({ error: 'User not found. Please sign up.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    const { name, image, password } = req.body;
    try {
        const result = await db.update(users).set({ name, image, password }).where(eq(users.id, req.params.id)).returning();
        res.json(result[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/likes', async (req, res) => {
    const { userId, trackId } = req.body;
    if (!userId || !trackId) return res.status(400).json({ error: 'Missing userId or trackId' });
    try {
        const existing = await db.select().from(likedSongs).where(and(eq(likedSongs.userId, userId), eq(likedSongs.trackId, trackId)));
        if (existing.length > 0) {
            await db.delete(likedSongs).where(eq(likedSongs.id, existing[0].id));
            return res.json({ liked: false });
        } else {
            await db.insert(likedSongs).values({ userId, trackId });
            return res.json({ liked: true });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/likes/:userId', async (req, res) => {
    try {
        const rows = await db.select({ trackId: likedSongs.trackId }).from(likedSongs).where(eq(likedSongs.userId, req.params.userId));
        res.json(rows.map(r => r.trackId));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user-playlists', async (req, res) => {
    const { userId, name, description, image, tracks } = req.body;
    if (!userId || !name?.trim()) return res.status(400).json({ error: 'userId and name required' });
    try {
        const result = await db.insert(playlists).values({ userId, name: name.trim(), description: description || '', image: image || null, tracks: Array.isArray(tracks) ? tracks :[] }).returning();
        res.json(result[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user-playlists/:userId', async (req, res) => {
    try {
        const rows = await db.select().from(playlists).where(eq(playlists.userId, req.params.userId));
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/user-playlists/:id/tracks', async (req, res) => {
    const { track } = req.body;
    try {
        const rows = await db.select().from(playlists).where(eq(playlists.id, req.params.id));
        const playlist = rows[0];
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
        const existingTracks = playlist.tracks ||[];
        if (existingTracks.find(t => t.id === track.id)) return res.status(400).json({ error: 'Track already in playlist' });
        const updatedTracks = [...existingTracks, track];
        const result = await db.update(playlists).set({ tracks: updatedTracks }).where(eq(playlists.id, req.params.id)).returning();
        res.json(result[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/user-playlists/:id', async (req, res) => {
    try {
        const result = await db.delete(playlists).where(eq(playlists.id, req.params.id)).returning();
        if (!result.length) return res.status(404).json({ error: 'Playlist not found' });
        res.json({ success: true, message: 'Playlist deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// UTILS & HELPERS
// ==========================================
const sendError = (res, status, message) => res.status(status).json({ success: false, error: message });
const safeArray = (value) => (Array.isArray(value) ? value :[]);
const cleanText = (text) => text ? String(text).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/<[^>]*>/g, '').trim() : '';

const getHostInfo = (req) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    return { proto, host };
};

// YouTube Fetcher
const pipedFetch = async (endpoint) => {
    for (const baseUrl of PIPED_INSTANCES) {
        try {
            const response = await axios.get(`${baseUrl}${endpoint}`, { timeout: 8000 });
            return response.data;
        } catch (err) { console.log(`⚠️ Piped failed: ${baseUrl}. Trying next...`); }
    }
    throw new Error('All Piped instances are down.');
};

// Saavn Normalizers
const cleanImage = (img) => {
    if (!img) return 'https://via.placeholder.com/500?text=No+Image';
    let url = Array.isArray(img) ? (img[2]?.link || img[1]?.link || img[0]?.link || '') : String(img);
    if (!url) return 'https://via.placeholder.com/500?text=No+Image';
    url = url.trim().replace('http://', 'https://').replace(/https?:\/\/https?:\/\//g, 'https://');
    if (url.startsWith('//')) url = 'https:' + url;
    return url.replace('150x150', '500x500').replace('50x50', '500x500').replace(/_150(\.jpg|\.png)/, '_500$1');
};

const normalizeSaavnSong = (song) => {
    if (!song?.id) return null;
    return {
        id: String(song.id),
        title: cleanText(song.title),
        artist: cleanText(song?.more_info?.singers || song.subtitle || ''),
        image: cleanImage(song.image),
        album_id: String(song?.more_info?.albumid || song.albumid || ''),
        has_audio: !!(song?.more_info?.encrypted_media_url || song?.encrypted_media_url),
        source: 'saavn',
        type: 'song',
    };
};

const normalizeSaavnPlaylist = (playlist) => {
    if (!playlist?.id) return null;
    return {
        id: String(playlist.id), title: cleanText(playlist.title), subtitle: cleanText(playlist.subtitle), image: cleanImage(playlist.image), source: 'saavn', type: 'playlist',
    };
};

// YouTube Normalizers
const extractYtId = (url) => {
    if (!url) return null;
    if (url.includes('?v=')) return url.split('?v=')[1].split('&')[0];
    return url.replace('/watch?v=', '').replace('/playlist?list=', '');
};

const normalizeYtSong = (item) => {
    if (!item || !item.url) return null;
    return {
        id: extractYtId(item.url),
        title: cleanText(item.title),
        artist: cleanText(item.uploaderName || 'Unknown Artist'),
        image: item.thumbnail || '',
        duration: item.duration || 0,
        has_audio: true,
        source: 'yt',
        type: 'song',
    };
};

const normalizeYtPlaylist = (item) => {
    if (!item || !item.url) return null;
    return {
        id: extractYtId(item.url), title: cleanText(item.title), subtitle: cleanText(item.uploaderName || 'YouTube Playlist'), image: item.thumbnail || '', source: 'yt', type: 'playlist',
    };
};

// Check if request is asking for YouTube data
const isYT = (req) => req.query.source === 'yt' || req.query.source === 'youtube';

// ==========================================
// 1. HOME SCREEN
// ==========================================
app.get('/api/home', async (req, res) => {
    const cacheKey = isYT(req) ? 'home_yt_v1' : 'home_saavn_v10';

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        let homeData = {};

        if (isYT(req)) {
            // YOUTUBE HOME
            const trendingRaw = await pipedFetch('/trending?region=IN'); 
            const chartsRaw = await pipedFetch('/search?q=top+music+hits+2024&filter=music_playlists');

            const trendingSongs = (trendingRaw ||[]).filter(item => item.url && item.url.includes('/watch?v=')).map(normalizeYtSong).filter(Boolean).slice(0, 15);
            const topCharts = (chartsRaw.items ||[]).map(normalizeYtPlaylist).filter(Boolean).slice(0, 8);

            homeData = { success: true, data: { trending_songs: trendingSongs, top_charts: topCharts, discover_mix: topCharts.slice(4, 8) } };
        } else {
            // SAAVN HOME
            const response = await axios.get(`${SAAVN_BASE_URL}&__call=webapi.getLaunchData`);
            const raw = response.data || {};
            const trendingSongs = safeArray(raw.new_trending).filter((item) => item.type === 'song').map(normalizeSaavnSong).filter((s) => s && s.has_audio).slice(0, 15);
            const topCharts = safeArray(raw.charts).filter(item => item.type === 'playlist' || !item.type).map(normalizeSaavnPlaylist).filter(Boolean).slice(0, 8);
            
            homeData = { success: true, data: { trending_songs: trendingSongs, top_charts: topCharts, discover_mix: topCharts } };
        }

        await cacheSet(cacheKey, 3600, JSON.stringify(homeData));
        return res.json(homeData);
    } catch (error) {
        return sendError(res, 500, `Failed to fetch home data: ${error.message}`);
    }
});

// ==========================================
// 2. SEARCH SONGS
// ==========================================
app.get('/api/search/songs', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return sendError(res, 400, 'Query required');

    const cacheKey = isYT(req) ? `search:yt:songs:${query.toLowerCase()}` : `search:saavn:songs:${query.toLowerCase()}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        let songs =[];

        if (isYT(req)) {
            const data = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=music_songs`);
            songs = (data.items ||[]).map(normalizeYtSong).filter(Boolean);
        } else {
            const response = await axios.get(`${SAAVN_BASE_URL}&__call=search.getResults&q=${encodeURIComponent(query)}&n=20`);
            songs = safeArray(response.data?.results).map(normalizeSaavnSong).filter(Boolean);
        }

        const payload = { success: true, data: songs };
        await cacheSet(cacheKey, 86400, JSON.stringify(payload));
        return res.json(payload);
    } catch (error) {
        return sendError(res, 500, `Song search failed: ${error.message}`);
    }
});

// ==========================================
// 3. GET SONG AUDIO URL & DETAILS
// NEVER CACHE (URLs Expire)
// ==========================================
app.get('/api/song', async (req, res) => {
    const id = String(req.query.id || '').trim();
    if (!id) return sendError(res, 400, 'Song ID required');

    try {
        if (isYT(req)) {
            // YOUTUBE SONG FETCH
            const data = await pipedFetch(`/streams/${encodeURIComponent(id)}`);
            if (!data || !data.audioStreams || data.audioStreams.length === 0) return sendError(res, 404, 'Audio stream not found');
            
            const bestAudio = data.audioStreams.sort((a, b) => b.bitrate - a.bitrate)[0];
            return res.json({
                success: true,
                data: {
                    id: id,
                    title: cleanText(data.title),
                    artist: cleanText(data.uploader),
                    image: data.thumbnailUrl,
                    audio_url: bestAudio.url, // Direct URL for mobile
                    source: 'yt'
                },
            });

        } else {
            // JIOSAAVN SONG FETCH
            const response = await axios.get(`${SAAVN_BASE_URL}&__call=song.getDetails&pids=${encodeURIComponent(id)}`);
            const songData = response.data?.[id] || (Array.isArray(response.data?.songs) ? response.data.songs[0] : null);
            if (!songData) return sendError(res, 404, 'Song not found');

            const encryptedUrl = songData?.more_info?.encrypted_media_url || songData?.encrypted_media_url;
            const authRes = await axios.get(`${SAAVN_BASE_URL}&__call=song.generateAuthToken&url=${encodeURIComponent(encryptedUrl)}&bitrate=320&api_version=4`);
            
            const directPlayUrl = authRes.data?.auth_url;
            const { proto, host } = getHostInfo(req);
            const proxyUrl = `${proto}://${host}/api/stream?url=${encodeURIComponent(directPlayUrl)}`;

            return res.json({
                success: true,
                data: {
                    id: String(id),
                    title: cleanText(songData.title),
                    artist: cleanText(songData?.more_info?.singers || songData.subtitle || ''),
                    image: cleanImage(songData.image),
                    audio_url: proxyUrl, // Proxy URL
                    source: 'saavn'
                },
            });
        }
    } catch (error) {
        return sendError(res, 500, `Failed to fetch song: ${error.message}`);
    }
});

// ==========================================
// 4. LYRICS (Smart Switching)
// ==========================================
app.get('/api/lyrics', async (req, res) => {
    try {
        if (isYT(req)) {
            // LRCLIB for YouTube
            const { track, artist } = req.query;
            if (!track || !artist) return sendError(res, 400, 'track and artist params required for YouTube lyrics');
            
            const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
            const response = await axios.get(url);
            if (response.data && response.data.length > 0) {
                return res.json({ success: true, data: { lyrics: response.data[0].syncedLyrics || response.data[0].plainLyrics || '' } });
            }
            return sendError(res, 404, 'Lyrics not found');
        } else {
            // SAAVN Lyrics
            const id = req.query.id;
            if (!id) return sendError(res, 400, 'id required for Saavn lyrics');
            const response = await axios.get(`${SAAVN_BASE_URL}&__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(id)}`);
            if (!response.data?.lyrics) return sendError(res, 404, 'Lyrics not found');
            return res.json({ success: true, data: { lyrics: String(response.data.lyrics).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim() } });
        }
    } catch (error) {
        return sendError(res, 500, `Failed to fetch lyrics: ${error.message}`);
    }
});

// ==========================================
// 5. AUDIO STREAM PROXY (ONLY FOR SAAVN)
// ==========================================
app.get('/api/stream', async (req, res) => {
    const audioUrl = String(req.query.url || '').trim();
    if (!audioUrl) return res.status(400).send('No audio URL provided');

    try {
        const range = req.headers.range;
        const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                Referer: 'https://www.jiosaavn.com/',
                Origin: 'https://www.jiosaavn.com/',
                ...(range ? { Range: range } : {}),
            },
            validateStatus: () => true,
        });

        res.status(response.status);
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mp4');
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        res.setHeader('Accept-Ranges', response.headers['accept-ranges'] || 'bytes');

        response.data.pipe(res);
    } catch (error) {
        return res.status(500).send('Error proxying stream');
    }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log('\n==============================================');
    console.log(`🎵 Groovli HYBRID API running on port ${PORT}`);
    console.log(`🇮🇳 JioSaavn: ACTIVE`);
    console.log(`🌍 YouTube (Piped): ACTIVE`);
    console.log('==============================================\n');
});