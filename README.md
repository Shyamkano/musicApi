# Music API (Groovli Backend) 🎵

A robust, performant Node.js API that serves as the backbone for the [**Groovli**](https://github.com/Shyamkano/groovli-app) music streaming application. It provides high-quality music metadata, user authentication, and personalized features like playlists and liked songs.

**🌍 Live API Status:** [https://musicapi-s1ci.onrender.com/api/health](https://musicapi-s1ci.onrender.com/api/health)


## 🚀 Key Features

-   **Metadata Wrapper**: Clean abstraction over the JioSaavn API for songs, albums, artists, and playlists.
-   **Streaming Logic**: Automatically generates high-quality (320kbps) audio stream URLs and provides proxy endpoints.
-   **User System**: Full support for user registration, login, and profile management.
-   **Personalization**: Persistent storage for liked songs and custom-created playlists.
-   **Intelligent Caching**: Redis-powered caching for lightning-fast response times.
-   **Geo-Bypass**: Custom request interceptors designed to bypass regional restrictions on cloud platforms (e.g., Render, Vercel).
-   **High-Res Assets**: Dynamic image processing to ensure all album art and artist images are high quality (500x500).

---

> [!TIP]
> This API was built to provide a modern, fast, and feature-rich backend for music discovery apps. It bridges the gap between raw metadata and a seamless user experience.


## 🛠️ Tech Stack

-   **Runtime**: [Node.js](https://nodejs.org/)
-   **Framework**: [Express.js](https://expressjs.com/)
-   **Database**: [Neon DB](https://neon.tech/) (Serverless Postgres)
-   **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
-   **Caching**: [Redis](https://redis.io/)
-   **External APIs**: JioSaavn, YouTube (yt-search, ytdl-core)

## 🏗️ Architecture

The API follows a modular structure:
-   `server.js`: Central endpoint definitions and middleware.
-   `db/`: Database schema, configuration, and migrations.
-   `db/schema.js`: Drizzle-defined tables for `users`, `liked_songs`, and `playlists`.

## ⚙️ Setup & Installation

### 1. Prerequisites
-   Node.js (v18+)
-   Redis (optional, but recommended for caching)
-   Neon.tech database account

### 2. Clone the repository
```bash
git clone https://github.com/Shyamkano/musicApi.git
cd musicApi
```

### 3. Install dependencies
```bash
npm install
```

### 4. Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3001
DATABASE_URL=your_neon_postgresql_url
REDIS_URL=your_redis_connection_url
```

### 5. Running the API
```bash
# Start development server
npm start
```

### 🗄️ Database Setup (Drizzle)
This project uses Drizzle Kit to manage schemas and migrations.
```bash
# Generate migrations
npx drizzle-kit generate

# Apply migrations
npx drizzle-kit push
```


## 🌐 Deployment

The API is optimized for deployment on platforms like **Render**, **Railway**, and **Heroku**. 

1.  **Environment Setup**: Ensure `DATABASE_URL` and `REDIS_URL` are set in your platform's dashboard.
2.  **Build Command**: `npm install`
3.  **Start Command**: `npm start`
4.  **Health Check**: Configure your hosting to ping `/api/health` to keep the instance active.


## 📡 API Endpoints (Prefix: `/api`)

All requests return a JSON object with a `success` boolean and a `data` or `error` field.

| Method | Endpoint | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | - | Health check, Redis status & server time. |
| `GET` | `/home` | `lang` (optional) | Trending songs, featured artists, albums & charts. |
| `GET` | `/search` | `query`, `lang` | Global search for music results. |
| `GET` | `/song` | `id` | Detailed song info + stream URL (proxy). |
| `GET` | `/album` | `id` | Album details and song list. |
| `GET` | `/artist` | `id` | Artist profile, top songs, and bio. |
| `GET` | `/playlist` | `id` | JioSaavn playlist content. |
| `POST` | `/users` | `id, name, email, image, password` | Register or update user profile. |
| `POST` | `/likes` | `userId, trackId` | Toggle like status for a song. |
| `GET` | `/likes/:userId` | - | Get all liked song IDs for a user. |
| `POST` | `/user-playlists`| `userId, name, description, tracks` | Create a custom user playlist. |

### 📝 Example Response (`/api/song?id=XYZ`)
```json
{
  "success": true,
  "data": {
    "id": "12345",
    "title": "Song Title",
    "artist": "Artist Name",
    "image": "https://.../500x500.jpg",
    "audio_url": "https://.../api/stream?url=...",
    "duration": "180"
  }
}
```


## 🛡️ License
This project is licensed under the ISC License.

## 🔗 Related Projects
- [**Groovli App**](https://github.com/Shyamkano/groovli-app): The officially supported mobile client for this API.

---
*Built with ❤️ for the Groovli ecosystem.*

