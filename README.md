# Music API (Groovli Backend) 🎵

A robust, performant Node.js API that serves as the backbone for the [**Groovli**](https://github.com/Shyamkano/groovli-app) music streaming application. It provides high-quality music metadata, user authentication, and personalized features like playlists and liked songs.


## 🚀 Key Features

-   **Metadata Wrapper**: Clean abstraction over the JioSaavn API for songs, albums, artists, and playlists.
-   **Streaming Logic**: Automatically generates high-quality (320kbps) audio stream URLs and provides proxy endpoints.
-   **User System**: Full support for user registration, login, and profile management.
-   **Personalization**: Persistent storage for liked songs and custom-created playlists.
-   **Intelligent Caching**: Redis-powered caching for lightning-fast response times.
-   **Geo-Bypass**: Custom request interceptors designed to bypass regional restrictions on cloud platforms (e.g., Render, Vercel).
-   **High-Res Assets**: Dynamic image processing to ensure all album art and artist images are high quality (500x500).

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

## 📡 API Endpoints (Prefix: `/api`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | API Health check & Redis status |
| `GET` | `/home` | Trending songs, featured artists, albums & charts |
| `GET` | `/search` | Global search for music results |
| `GET` | `/song?id={id}` | Detailed song info + high-res image + stream URL |
| `GET` | `/album?id={id}` | Album details and song list |
| `GET` | `/artist?id={id}` | Artist profile, top songs, and bio |
| `POST` | `/users` | Register or update a user |
| `POST` | `/likes` | Toggle like status for a song |
| `POST` | `/user-playlists` | Create a new user playlist |

## 🛡️ License
This project is licensed under the ISC License.

## 🔗 Related Projects
- [**Groovli App**](https://github.com/Shyamkano/groovli-app): The officially supported mobile client for this API.

---
*Built with ❤️ for the Groovli ecosystem.*

