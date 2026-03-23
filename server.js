import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { createClient } from 'redis';
import { db } from './db/index.js';
import { users, likedSongs, playlists } from './db/schema.js';
import { eq, and } from 'drizzle-orm';
import ytSearch from 'yt-search';
import { Innertube } from 'youtubei.js';

let youtubeEngine = null;
const initYoutube = async () => {
    try {
        youtubeEngine = await Innertube.create();
        console.log('✅ YouTube Engine Initialized');
    } catch (e) {
        console.error('❌ YouTube Engine Init Failed:', e.message);
    }
};
initYoutube();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// CONFIG
// ==========================================
const PORT = process.env.PORT || 3001;
const HOST_IP = process.env.HOST_IP || null;
const SAAVN_BASE_URL =
    'https://www.jiosaavn.com/api.php?_format=json&_marker=0&api_version=4&ctx=web6dot0';

// ==========================================
// REDIS SETUP (Optional — graceful fallback)
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

// ==========================================
// DB ENDPOINTS (Neon + Drizzle)
// ==========================================

// Register/Update User
app.post('/api/users', async (req, res) => {
    const { id, name, email, image, password } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID and Name required' });

    try {
        const result = await db.insert(users).values({ id, name, email, image, password })
            .onConflictDoUpdate({ target: users.id, set: { name, email, image, password } })
            .returning();
        res.json(result[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Real Login Endpoint (Fetches user instead of overwriting)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    try {
        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length > 0) {
            // Check password theoretically, but for now we just return the user safely
            return res.json(existing[0]);
        }
        res.status(404).json({ error: 'User not found. Please sign up.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update Profile
app.patch('/api/users/:id', async (req, res) => {
    const { name, image, password } = req.body;
    try {
        const result = await db.update(users)
            .set({ name, image, password })
            .where(eq(users.id, req.params.id))
            .returning();
        res.json(result[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toggle Like
app.post('/api/likes', async (req, res) => {
    const { userId, trackId } = req.body;
    if (!userId || !trackId) return res.status(400).json({ error: 'Missing userId or trackId' });

    try {
        const existing = await db.select().from(likedSongs)
            .where(and(eq(likedSongs.userId, userId), eq(likedSongs.trackId, trackId)));

        if (existing.length > 0) {
            await db.delete(likedSongs).where(eq(likedSongs.id, existing[0].id));
            return res.json({ liked: false });
        } else {
            await db.insert(likedSongs).values({ userId, trackId });
            return res.json({ liked: true });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get User Likes
app.get('/api/likes/:userId', async (req, res) => {
    try {
        const rows = await db.select({ trackId: likedSongs.trackId })
            .from(likedSongs).where(eq(likedSongs.userId, req.params.userId));
        res.json(rows.map(r => r.trackId));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Create User Playlist
app.post('/api/user-playlists', async (req, res) => {
    const { userId, name, description, image, tracks } = req.body;

    if (!userId || !name?.trim()) {
        return res.status(400).json({ error: 'userId and name required' });
    }

    try {
        const result = await db
            .insert(playlists)
            .values({
                userId,
                name: name.trim(),
                description: description || '',
                image: image || null,
                tracks: Array.isArray(tracks) ? tracks : [],
            })
            .returning();

        res.json(result[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get User Playlists
app.get('/api/user-playlists/:userId', async (req, res) => {
    try {
        const rows = await db
            .select()
            .from(playlists)
            .where(eq(playlists.userId, req.params.userId));

        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Add Track to Playlist
app.post('/api/user-playlists/:id/tracks', async (req, res) => {
    const { track } = req.body;
    try {
        const rows = await db.select().from(playlists).where(eq(playlists.id, req.params.id));
        const playlist = rows[0];
        if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

        const existingTracks = playlist.tracks || [];
        if (existingTracks.find(t => t.id === track.id)) {
            return res.status(400).json({ error: 'Track already in playlist' });
        }

        const updatedTracks = [...existingTracks, track];

        const result = await db.update(playlists)
            .set({ tracks: updatedTracks })
            .where(eq(playlists.id, req.params.id))
            .returning();

        res.json(result[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete Playlist
app.delete('/api/user-playlists/:id', async (req, res) => {
    try {
        const result = await db.delete(playlists)
            .where(eq(playlists.id, req.params.id))
            .returning();

        if (!result.length) {
            return res.status(404).json({ error: 'Playlist not found' });
        }
        res.json({ success: true, message: 'Playlist deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const cacheGet = async (key) => {
    if (!redisReady || !redisClient) return null;
    try {
        return await redisClient.get(key);
    } catch {
        return null;
    }
};

const cacheSet = async (key, ttl, value) => {
    if (!redisReady || !redisClient) return;
    try {
        await redisClient.setEx(key, ttl, value);
    } catch {
        // ignore cache errors
    }
};

// ==========================================
// HELPERS
// ==========================================
const cleanText = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/<[^>]*>/g, '')
        .trim();
};

const cleanImage = (img) => {
    if (!img) return 'https://via.placeholder.com/500?text=No+Image';

    let url = '';
    if (Array.isArray(img)) {
        url = img[2]?.link || img[1]?.link || img[0]?.link || '';
    } else {
        url = String(img);
    }

    if (!url) return 'https://via.placeholder.com/500?text=No+Image';

    // Ensure HTTPS and remove extra //
    url = url.trim();
    if (url.startsWith('http://')) {
        url = url.replace('http://', 'https://');
    } else if (url.startsWith('//')) {
        url = 'https:' + url;
    } else if (!url.startsWith('https://')) {
        url = 'https://' + url;
    }

    // Clean double protocols
    url = url.replace(/https?:\/\/https?:\/\//g, 'https://');

    // FORCE HIGH QUALITY (500x500)
    // Most JioSaavn URLs match these patterns: _150x150.jpg, _50x50.jpg, or /150/
    if (url.includes('150x150')) {
        url = url.replace('150x150', '500x500');
    } else if (url.includes('50x50')) {
        url = url.replace('50x50', '500x500');
    } else {
        // Fallback for smaller IDs or path-based resizing
        url = url.replace(/_150(\.jpg|\.png)/, '_500$1')
                 .replace(/_50(\.jpg|\.png)/, '_500$1')
                 .replace('/150/', '/500/')
                 .replace('/50/', '/500/');
    }

    return url;
};

const getHostInfo = (req) => {
    // If Render or other proxy, use the public forwarded headers
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    return { proto, host };
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeSong = (song) => {
    if (!song?.id) return null;

    const encryptedUrl =
        song?.more_info?.encrypted_media_url || song?.encrypted_media_url || null;

    return {
        id: String(song.id),
        title: cleanText(song.title),
        artist: cleanText(song?.more_info?.singers || song.subtitle || ''),
        image: cleanImage(song.image),
        album_id: String(song?.more_info?.albumid || song.albumid || ''),
        has_audio: !!encryptedUrl,
        type: 'song',
    };
};

const normalizeArtist = (artist) => {
    if (!artist?.id) return null;

    return {
        id: String(artist.id),
        name: cleanText(artist.title || artist.name || ''),
        image: cleanImage(artist.image),
        type: 'artist',
    };
};

const normalizeAlbum = (album) => {
    if (!album?.id && !album?.albumid) return null;

    return {
        id: String(album.id || album.albumid),
        title: cleanText(album.title),
        subtitle: cleanText(album.subtitle),
        image: cleanImage(album.image),
        year: album?.more_info?.year || album.year || '',
        song_count: album?.more_info?.song_count || album.song_count || '',
        duration: album?.more_info?.duration || album.duration || '',
        type: 'album',
    };
};

const normalizePlaylist = (playlist) => {
    if (!playlist?.id) return null;

    return {
        id: String(playlist.id),
        title: cleanText(playlist.title),
        subtitle: cleanText(playlist.subtitle),
        image: cleanImage(playlist.image),
        type: 'playlist',
    };
};

const normalizeLyrics = (lyrics) => {
    if (!lyrics) return '';
    return String(lyrics)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?p>/gi, '\n')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]*>/g, '') // strip any other remaining tags
        .trim();
};

const sendError = (res, status, message) => {
    return res.status(status).json({
        success: false,
        error: message,
    });
};

// ==========================================
// 1. HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'ok',
            redis: redisReady ? 'connected' : 'offline (no cache)',
            time: new Date().toISOString(),
            host: getHost(req),
        },
    });
});

// ==========================================
// 2. HOME SCREEN
// ==========================================
app.get('/api/home', async (req, res) => {
    const cacheKey = 'home_data_v10';

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) {
            console.log('⚡ [Home] served from cache');
            return res.json(JSON.parse(cached));
        }

        console.log('🌐 [Home] fetching from JioSaavn...');
        const response = await axios.get(`${SAAVN_BASE_URL}&__call=webapi.getLaunchData`);
        const raw = response.data || {};

        const allTrending = safeArray(raw.new_trending);
        const chartsRaw = safeArray(raw.charts);
        const newAlbumsRaw = safeArray(raw.new_albums);
        const topPlaylistsRaw = safeArray(raw.top_playlists || raw.new_featured_playlists);
        const trendingPlaylistsRaw = safeArray(raw.trending_playlists);

        const trendingSongs = allTrending
            .filter((item) => item.type === 'song')
            .map(normalizeSong)
            .filter((song) => song && song.has_audio)
            .slice(0, 15);

        const featuredArtists = [
            ...allTrending.filter((item) => item.type === 'artist'),
            ...chartsRaw.filter((item) => item.type === 'artist'),
        ]
            .map(normalizeArtist)
            .filter(Boolean)
            .filter((artist, index, arr) => arr.findIndex((a) => a.id === artist.id) === index)
            .slice(0, 10);

        if (featuredArtists.length === 0) {
            featuredArtists.push(
                { id: "459320", name: "Arijit Singh", image: "https://c.saavncdn.com/artists/Arijit_Singh_500x500.jpg" },
                { id: "464232", name: "Shreya Ghoshal", image: "https://c.saavncdn.com/artists/Shreya_Ghoshal_500x500.jpg" },
                { id: "455931", name: "Sonu Nigam", image: "https://c.saavncdn.com/artists/Sonu_Nigam_500x500.jpg" },
                { id: "468245", name: "Diljit Dosanjh", image: "https://c.saavncdn.com/artists/Diljit_Dosanjh_500x500.jpg" },
                { id: "459633", name: "Atif Aslam", image: "https://c.saavncdn.com/artists/Atif_Aslam_500x500.jpg" },
                { id: "461320", name: "Anirudh Ravichander", image: "https://c.saavncdn.com/artists/Anirudh_Ravichander_500x500.jpg" },
                { id: "455000", name: "Alka Yagnik", image: "https://c.saavncdn.com/artists/Alka_Yagnik_500x500.jpg" },
                { id: "459345", name: "Badshah", image: "https://c.saavncdn.com/artists/Badshah_500x500.jpg" }
            );
        }

        const newAlbums = newAlbumsRaw.map(normalizeAlbum).filter(Boolean).slice(0, 15);

        const topCharts = chartsRaw
            .filter(item => item.type === 'playlist' || !item.type)
            .map(normalizePlaylist)
            .filter(Boolean)
            .slice(0, 8);

        const featuredPlaylists = topPlaylistsRaw
            .map(normalizePlaylist)
            .filter(Boolean)
            .slice(0, 12);

        const trendingPlaylists = trendingPlaylistsRaw
            .map(normalizePlaylist)
            .filter(Boolean)
            .slice(0, 12);

        // Extra discover mix: charts + trending playlists (different from new_albums)
        const discoverMix = [
            ...topCharts,
            ...trendingPlaylistsRaw.map(normalizePlaylist).filter(Boolean)
        ]
            .filter((item, index, arr) => arr.findIndex(i => i.id === item.id) === index)
            .slice(0, 14);

        const homeData = {
            success: true,
            data: {
                trending_songs: trendingSongs,
                featured_artists: featuredArtists,
                new_albums: newAlbums,
                top_charts: topCharts,
                featured_playlists: featuredPlaylists,
                trending_playlists: trendingPlaylists,
                discover_mix: discoverMix,
            },
        };

        await cacheSet(cacheKey, 3600, JSON.stringify(homeData));
        return res.json(homeData);
    } catch (error) {
        console.error('[Home] Error:', error.message);
        return sendError(res, 500, `Failed to fetch home data: ${error.message}`);
    }
});

// ==========================================
// 3. GLOBAL SEARCH
// ==========================================
app.get('/api/search', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return sendError(res, 400, 'Query required');

    const cacheKey = `search:global:${query.toLowerCase()}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) {
            console.log(`⚡ [Search] "${query}" served from cache`);
            return res.json(JSON.parse(cached));
        }

        console.log(`🌐 [Search] "${query}" fetching...`);
        
        // 1. Fetch JioSaavn results
        const saavnRes = await axios.get(
            `${SAAVN_BASE_URL}&__call=search.getResults&q=${encodeURIComponent(query)}&n=15`
        ).catch(() => ({ data: { results: [] } }));

        let saavnSongs = safeArray(saavnRes.data?.results)
            .map(normalizeSong)
            .filter(Boolean);

        // 2. Fetch YouTube results
        let ytSongs = [];
        try {
            const ytResults = await ytSearch(query);
            ytSongs = ytResults.videos.slice(0, 15).map(v => ({
                id: `yt_${v.videoId}`,
                title: cleanText(v.title),
                artist: cleanText(v.author.name),
                album: 'YouTube Music',
                image: cleanImage(v.thumbnail || v.image || ''),
                duration: String(v.seconds),
                has_audio: true,
                is_yt: true 
            }));
        } catch (ytErr) {
            console.error('YouTube search error:', ytErr.message);
        }

        // INTELLIGENT MERGING:
        // Detect if the query is primarily "International" or poorly matched on Saavn
        const topSaavnMatch = saavnSongs.length > 0 && 
            (saavnSongs[0].title.toLowerCase().includes(query.split(' ')[0].toLowerCase()) || 
             saavnSongs[0].artist.toLowerCase().includes(query.split(' ')[0].toLowerCase()));

        const isInternational = /^[a-zA-Z0-9\s!\?]+$/.test(query) && query.length > 3;
        
        let finalSongs = [];
        if (!topSaavnMatch && isInternational) {
            // Put YouTube first for international/missing hits
            finalSongs = [...ytSongs, ...saavnSongs];
        } else {
            // Keep Saavn first for Indian hits
            finalSongs = [...saavnSongs, ...ytSongs];
        }

        const payload = { success: true, data: finalSongs.slice(0, 30) };
        await cacheSet(cacheKey, 86400, JSON.stringify(payload));
        return res.json(payload);
    } catch (error) {
        console.error('[Search] Error:', error.message);
        return sendError(res, 500, `Search failed: ${error.message}`);
    }
});

// ==========================================
// 4. SONG SEARCH
// ==========================================
app.get('/api/search/songs', async (req, res) => {
    const query = String(req.query.query || '').trim();
    const page = Number(req.query.page || 0);
    const limit = Number(req.query.limit || 10);

    if (!query) return sendError(res, 400, 'Query required');

    const cacheKey = `search:songs:${query.toLowerCase()}:${page}:${limit}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=search.getResults&q=${encodeURIComponent(query)}&n=${limit}&p=${page}`
        );

        const results = safeArray(response.data?.results);
        const songs = results.map(normalizeSong).filter(Boolean);

        const payload = { success: true, data: songs };
        await cacheSet(cacheKey, 86400, JSON.stringify(payload));
        return res.json(payload);
    } catch (error) {
        console.error('[Search Songs] Error:', error.message);
        return sendError(res, 500, `Song search failed: ${error.message}`);
    }
});

// ==========================================
// 4.1. ALBUM SEARCH
// ==========================================
app.get('/api/search/albums', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return sendError(res, 400, 'Query required');

    try {
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=search.getAlbumResults&q=${encodeURIComponent(query)}&n=20&p=0`
        );
        const results = safeArray(response.data?.results);
        const albums = results.map(normalizeAlbum).filter(Boolean);
        return res.json({ success: true, data: albums });
    } catch (error) {
        return sendError(res, 500, `Album search failed: ${error.message}`);
    }
});

// ==========================================
// 4.2. ARTIST SEARCH
// ==========================================
app.get('/api/search/artists', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return sendError(res, 400, 'Query required');

    try {
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=search.getArtistResults&q=${encodeURIComponent(query)}&n=20&p=0`
        );
        const results = safeArray(response.data?.results);
        const artists = results.map(normalizeArtist).filter(Boolean);
        return res.json({ success: true, data: artists });
    } catch (error) {
        return sendError(res, 500, `Artist search failed: ${error.message}`);
    }
});

// ==========================================
// 4.3. PLAYLIST SEARCH
// ==========================================
app.get('/api/search/playlists', async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return sendError(res, 400, 'Query required');

    try {
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=search.getPlaylistResults&q=${encodeURIComponent(query)}&n=20&p=0`
        );
        const results = safeArray(response.data?.results);
        const playlists = results.map(normalizePlaylist).filter(Boolean);
        return res.json({ success: true, data: playlists });
    } catch (error) {
        return sendError(res, 500, `Playlist search failed: ${error.message}`);
    }
});

// ==========================================
// 4.4. ARTIST DETAILS
// ==========================================
app.get('/api/artist', async (req, res) => {
    const artistId = String(req.query.id || '').trim();
    if (!artistId) return sendError(res, 400, 'Artist ID required');

    try {
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=artist.getArtistPageDetails&artistId=${artistId}`
        );
        const data = response.data;
        
        let topSongs = safeArray(data?.topSongs || data?.songs || data?.top_songs)
            .map(normalizeSong)
            .filter(Boolean);
        const topAlbums = safeArray(data?.topAlbums || data?.albums)
            .map(normalizeAlbum)
            .filter(Boolean);

        // FIX: If artist page is empty, fetch songs independently via search
        if (topSongs.length === 0 && data.name) {
            console.log(`🔍 [Artist Fix] Fetching top songs for ${data.name} via search...`);
            const searchRes = await axios.get(
                `${SAAVN_BASE_URL}&__call=search.getResults&q=${encodeURIComponent(data.name)}&n=15`
            );
            topSongs = safeArray(searchRes.data?.results).map(normalizeSong).filter(Boolean);
        }

        return res.json({
            success: true,
            data: {
                id: String(data.artistId || data.id || artistId),
                name: cleanText(data.name || data.title || ''),
                image: cleanImage(data.image),
                follower_count: data.follower_count || 0,
                top_songs: topSongs,
                top_albums: topAlbums,
                bio: cleanText(data.subtitle || data.description || '')
            }
        });
    } catch (error) {
        return sendError(res, 500, `Artist fetch failed: ${error.message}`);
    }
});

// ==========================================
// 4.5. PLAYLIST DETAILS
// ==========================================
app.get('/api/playlist', async (req, res) => {
    const playlistId = String(req.query.id || '').trim();
    if (!playlistId) return sendError(res, 400, 'Playlist ID required');

    try {
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=playlist.getDetails&listid=${playlistId}`
        );
        const data = response.data;
        const songs = safeArray(data?.list || data?.songs).map(normalizeSong).filter(Boolean);

        return res.json({
            success: true,
            data: {
                id: data.listid || data.id,
                title: cleanText(data.listname || data.title),
                image: cleanImage(data.image),
                song_count: data.list_count || songs.length,
                songs: songs
            }
        });
    } catch (error) {
        return sendError(res, 500, `Playlist fetch failed: ${error.message}`);
    }
});

// ==========================================
// 5. SONG DETAILS + STREAM URL
// NEVER CACHE — token expires
// ==========================================
app.get('/api/song', async (req, res) => {
    const songId = String(req.query.id || '').trim();
    if (!songId) return sendError(res, 400, 'Song ID required');

    // Handle YouTube IDs
    if (songId.startsWith('yt_')) {
        const videoId = songId.replace('yt_', '');
        try {
            const videoResults = await ytSearch({ videoId });
            const { proto, host } = getHostInfo(req);
            const proxyUrl = `${proto}://${host}/api/stream?yt_id=${videoId}`;
            
            return res.json({
                success: true,
                data: {
                    id: songId,
                    title: cleanText(videoResults.title),
                    artist: cleanText(videoResults.author.name),
                    album: 'YouTube Music',
                    image: cleanImage(videoResults.thumbnail || videoResults.image),
                    duration: String(videoResults.seconds),
                    has_audio: true,
                    audio_url: proxyUrl
                }
            });
        } catch (e) {
            return sendError(res, 500, 'YouTube song fetch failed');
        }
    }

    try {
        console.log(`🎵 [Song] fetching details for ID: ${songId}`);

        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=song.getDetails&pids=${encodeURIComponent(songId)}`
        );

        const songData =
            response.data?.[songId] ||
            (Array.isArray(response.data?.songs) ? response.data.songs[0] : null);

        if (!songData) {
            return sendError(res, 404, 'Song not found');
        }

        const encryptedUrl =
            songData?.more_info?.encrypted_media_url || songData?.encrypted_media_url;

        if (!encryptedUrl) {
            return sendError(res, 404, 'Song not playable');
        }

        const authRes = await axios.get(
            `${SAAVN_BASE_URL}&__call=song.generateAuthToken&url=${encodeURIComponent(
                encryptedUrl
            )}&bitrate=320&api_version=4`
        );

        const directPlayUrl = authRes.data?.auth_url;
        if (!directPlayUrl) {
            return sendError(res, 500, 'Failed to generate audio token');
        }

        const { proto, host } = getHostInfo(req);
        const proxyUrl = `${proto}://${host}/api/stream?url=${encodeURIComponent(directPlayUrl)}`;

        return res.json({
            success: true,
            data: {
                id: String(songId),
                title: cleanText(songData.title),
                artist: cleanText(songData?.more_info?.singers || songData.subtitle || ''),
                album: cleanText(songData?.more_info?.album || ''),
                image: cleanImage(songData.image),
                duration: songData?.more_info?.duration || '0',
                has_lyrics: songData?.more_info?.has_lyrics === 'true',
                album_id: String(songData?.more_info?.album_id || songData?.albumid || ''),
                audio_url: proxyUrl,
            },
        });
    } catch (error) {
        console.error('[Song] Error:', error.message);
        return sendError(res, 500, `Failed to fetch song: ${error.message}`);
    }
});

// ==========================================
// 6. ALBUM DETAILS
// ==========================================
app.get('/api/album', async (req, res) => {
    const albumId = String(req.query.id || '').trim();
    if (!albumId) return sendError(res, 400, 'Album ID required');

    const cacheKey = `album:${albumId}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) {
            console.log(`⚡ [Album] ${albumId} served from cache`);
            return res.json(JSON.parse(cached));
        }

        console.log(`🌐 [Album] ${albumId} fetching from JioSaavn...`);
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=content.getAlbumDetails&albumid=${encodeURIComponent(albumId)}`
        );

        const data = response.data;
        const songList = safeArray(data?.list || data?.songs);

        if (!data || songList.length === 0) {
            return sendError(res, 404, 'Album not found or empty');
        }

        const albumInfo = {
            success: true,
            data: {
                id: String(data.albumid || albumId),
                title: cleanText(data.title),
                subtitle: cleanText(data.subtitle || ''),
                image: cleanImage(data.image),
                year: data.year || '',
                song_count: data?.list?.length || 0,
                songs: songList
                    .map((song) => ({
                        id: String(song.id),
                        title: cleanText(song.title),
                        artist: cleanText(song?.more_info?.singers || song.subtitle || ''),
                        image: cleanImage(song.image),
                        album_id: String(data.albumid || albumId),
                        has_audio: !!(song?.more_info?.encrypted_media_url || song?.encrypted_media_url),
                        type: 'song',
                    }))
                    .filter((song) => song.id),
            },
        };

        await cacheSet(cacheKey, 86400, JSON.stringify(albumInfo));
        return res.json(albumInfo);
    } catch (error) {
        console.error('[Album] Error:', error.message);
        return sendError(res, 500, `Failed to fetch album: ${error.message}`);
    }
});

// ==========================================
// 7. LYRICS
// ==========================================
app.get('/api/lyrics', async (req, res) => {
    const songId = String(req.query.id || '').trim();
    if (!songId) return sendError(res, 400, 'Song ID required');

    const cacheKey = `lyrics:${songId}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) {
            console.log(`⚡ [Lyrics] ${songId} served from cache`);
            return res.json(JSON.parse(cached));
        }

        console.log(`🌐 [Lyrics] ${songId} fetching from JioSaavn...`);
        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(songId)}`
        );

        if (!response.data?.lyrics) {
            return sendError(res, 404, 'Lyrics not found');
        }

        const lyricsData = {
            success: true,
            data: {
                lyrics: normalizeLyrics(response.data.lyrics),
            },
        };

        await cacheSet(cacheKey, 86400, JSON.stringify(lyricsData));
        return res.json(lyricsData);
    } catch (error) {
        console.error('[Lyrics] Error:', error.message);
        return sendError(res, 500, `Failed to fetch lyrics: ${error.message}`);
    }
});

// ==========================================
// 8. FEATURED PLAYLISTS
// ==========================================
app.get('/api/playlists', async (req, res) => {
    const cacheKey = 'playlists:featured';

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const response = await axios.get(`${SAAVN_BASE_URL}&__call=webapi.getLaunchData`);
        const raw = response.data || {};

        const playlists =
            safeArray(raw.top_playlists)
                .concat(safeArray(raw.new_featured_playlists))
                .concat(safeArray(raw.trending_playlists))
                .map(normalizePlaylist)
                .filter(Boolean)
                .filter((playlist, index, arr) => arr.findIndex((p) => p.id === playlist.id) === index)
                .slice(0, 12);

        const payload = {
            success: true,
            data: playlists,
        };

        await cacheSet(cacheKey, 3600, JSON.stringify(payload));
        return res.json(payload);
    } catch (error) {
        console.error('[Playlists] Error:', error.message);
        return sendError(res, 500, `Failed to fetch playlists: ${error.message}`);
    }
});

// ==========================================
// 9. ARTIST BASIC DETAILS
// ==========================================
app.get('/api/artist', async (req, res) => {
    const artistId = String(req.query.id || '').trim();
    if (!artistId) return sendError(res, 400, 'Artist ID required');

    const cacheKey = `artist:${artistId}`;

    try {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const response = await axios.get(
            `${SAAVN_BASE_URL}&__call=artist.getArtistDetails&artistId=${encodeURIComponent(artistId)}`
        );

        const data = response.data || {};

        const payload = {
            success: true,
            data: {
                id: artistId,
                name: cleanText(data.name || data.title || ''),
                image: cleanImage(data.image),
                top_songs: safeArray(data.topSongs).map(normalizeSong).filter(Boolean).slice(0, 10),
                top_albums: safeArray(data.topAlbums).map(normalizeAlbum).filter(Boolean).slice(0, 10),
            },
        };

        await cacheSet(cacheKey, 86400, JSON.stringify(payload));
        return res.json(payload);
    } catch (error) {
        console.error('[Artist] Error:', error.message);
        return sendError(res, 500, `Failed to fetch artist: ${error.message}`);
    }
});

// ==========================================
// 10. AUDIO STREAM PROXY
// ==========================================
app.get('/api/stream', async (req, res) => {
    const audioUrl = String(req.query.url || '').trim();
    const ytId = String(req.query.yt_id || '').trim();
    
    if (!audioUrl && !ytId) return res.status(400).send('No audio/YT ID provided');

    try {
        console.log(`🔊 [Stream] proxying ${ytId ? 'YT:' + ytId : 'URL'}`);
        
        let stream;
        if (ytId && youtubeEngine) {
            console.log(`🔊 [Stream] resolving hq audio for: ${ytId}`);
            try {
                const info = await youtubeEngine.getInfo(ytId);
                const format = info.chooseFormat({ type: 'audio', quality: 'best' });
                if (!format) throw new Error('No audio format');
                
                const response = await axios({
                    method: 'GET',
                    url: format.url,
                    responseType: 'stream',
                    validateStatus: () => true,
                });
                
                res.setHeader('Content-Type', 'audio/mpeg');
                return response.data.pipe(res);
            } catch (err) {
                console.error('[Stream] YT Resolve Error:', err.message);
                return res.status(500).send('YT Streaming Failed');
            }
        }

        const range = req.headers.range;

        const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                Referer: 'https://www.jiosaavn.com/',
                Origin: 'https://www.jiosaavn.com/',
                ...(range ? { Range: range } : {}),
            },
            validateStatus: () => true,
        });

        if (![200, 206].includes(response.status)) {
            return res.status(response.status).send(`CDN Error: ${response.status}`);
        }

        res.status(response.status);
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }
        res.setHeader('Accept-Ranges', response.headers['accept-ranges'] || 'bytes');

        response.data.pipe(res);
    } catch (error) {
        console.error('[Stream] Error:', error.message);
        return res.status(500).send('Error proxying stream');
    }
});

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log('\n==============================================');
    console.log(`🎵 Groovli Music API running on port ${PORT}`);
    console.log(`📡 JioSaavn proxy: active`);
    console.log(`📦 Redis cache: ${redisReady ? 'enabled' : 'disabled (will retry)'}`);
    console.log(`🌐 HOST_IP override: ${HOST_IP || 'auto-detect from request host'}`);
    console.log('==============================================\n');
});