# 🎨 Gelrss

A powerful RSS feed generator for Gelbooru posts based on artist tags. Supports multiple independent feeds with individual configuration and intelligent caching system.

## 📋 Description

The Gelrss is a Node.js application that allows you to create personalized RSS feeds to track specific artists' posts on Gelbooru. Each artist can have their own configuration, independent cache, and custom URL.

### ✨ Key Features

- 🎭 **Multi-Feed Support**: Multiple artists with independent feeds
- ⚡ **Smart Caching**: Per-artist caching system with automatic updates
- 🔧 **Individual Configuration**: Specific JSON file for each artist
- 🌐 **Web Interface**: Control panel with status for all feeds
- 📱 **Custom URLs**: `/rss/artist-name` for each feed
- 🔄 **Flexible Updates**: Automatic or manual updates per feed
- 🛡️ **Rate Limiting**: Optional Gelbooru credentials support

## 🚀 Quick Start

### Prerequisites
- Node.js >= 14.0.0
- npm or yarn

### Installation

1. **Clone the repository**:
```bash
git clone https://github.com/Bakalhau/Gelrss
cd Gelrss
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
cp .env.example .env
# Edit the .env file as needed
```

4. **Create configs directory**:
```bash
mkdir configs
```

5. **Start the server**:
```bash
npm start
```

6. **Access**: `http://localhost:24454`

## ⚙️ Configuration

### Global Configuration (.env)

```env
# Gelbooru credentials (OPTIONAL - but recommended)
GELBOORU_API_KEY=your_gelbooru_api_key
GELBOORU_USER_ID=your_gelbooru_id

# Cache update interval in minutes (default: 10)
UPDATE_INTERVAL_MINUTES=10

# Server base URL (IP/domain only, without port)
BASE_URL=localhost

# Server port
PORT=24454

# Cache Persistence (OPTIONAL)
# Connection string for database persistance. (default: in-memory)
# For SQLite, use a file path like: sqlite://./data/gelrss.db
# DATABASE_URL=sqlite://./data/gelrss.db

# Finetuning Fetch and Cache Limits (OPTIONAL)
# Number of posts to fetch from Gelbooru API (default: 20)
GELBOORU_FETCH_LIMIT=20
# Maximum number of posts to keep in the cache for each tag (default: 200)
ARTIST_CACHE_SIZE=200
```
## 🌐 API Endpoints

### RSS Feeds
- `GET /rss/{artistId}` - Specific artist RSS feed
- **Example**: `http://localhost:24454/rss/khyle`

### Web Interface
- `GET /` - Main page with list of all feeds
- `GET /test/{artistId}` - Test specific configuration
- **Example**: `http://localhost:24454/test/khyle`

### Cache Control
- `GET /refresh/{artistId}` - Force update specific feed
- `GET /refresh-all` - Update all feeds
- **Example**: `http://localhost:24454/refresh/khyle`

### Cache Persistence

Gelrss supports two caching modes:

1.  **In-Memory (Default)**:
    -   If `DATABASE_URL` is commented out or missing from `.env`, the application will store the cache in memory.
    -   This is the simplest mode and requires no extra configuration.
    -   **Caveat**: All cached data will be lost when the application restarts.

2.  **SQLite (Persistent)**:
    -   To enable, set a path for `DATABASE_URL` in your `.env`.
    -   Example: `DATABASE_URL=sqlite://./data/gelrss.db`
    -   The application will automatically create and manage the SQLite database file.
    -   **Benefit**: The cache is saved to disk, so feed data persists across application restarts, reducing initial load times.

## 📁 Project Structure

```
gelbooru-rss-generator/
├── cache/                 # Cache service implementations
│   ├── inMemoryCache.js
│   └── databaseCache.js
├── configs/               # Per-artist configurations
│   ├── khyle.json         # Khyle configuration
│   ├── optionaltypo.json  # OptionalTypo configuration
│   └── ...                # Other artists
├── .env                   # Global settings
├── .env.example           # Configuration example
├── package.json           # Project dependencies
├── server.js              # Main application
└── README.md              # This file
```

## 🎯 Usage

### Adding a New Artist

1. **Create configuration file**:
```bash
# Example for artist "sakimichan"
touch configs/sakimichan.json
```

2. **Configure the artist**:
```json
{
  "ARTIST_NAME": "Sakimichan",
  "GELBOORU_TAG": "sakimichan",
  "ICON_URL": "https://example.com/sakimichan-icon.png",
  "FEED_TITLE": "Posts of Sakimichan from Gelbooru"
}
```

3. **Restart the server** or access `/refresh/sakimichan`

4. **Access the feed**: `http://localhost:24454/rss/sakimichan`

### Getting Gelbooru Credentials (Optional)

To avoid rate limiting and improve performance:

1. Create an account at [gelbooru.com](https://gelbooru.com)
2. Go to **Account** → **Options**
3. Find your **API Key** and **User ID**
4. Add to `.env` file:
```env
GELBOORU_API_KEY=your_api_key_here
GELBOORU_USER_ID=your_user_id_here
```

## 🔧 NPM Scripts

```bash
# Start the server
npm start

# Development mode (with auto-restart)
npm run dev

# Basic test
npm test
```

## 📊 Monitoring

### Web Interface
Access `http://localhost:24454` to see:
- Status of all feeds
- Last update time for each cache
- Post count per feed
- Direct links for RSS, test, and refresh

### Console Logs
The system provides detailed logs about:
- Configuration loading
- Cache updates
- Feed-specific errors
- Post statistics

## 📄 License

This project is licensed under the GPLv3 License. See the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the project
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Open a Pull Request

---

**Gelrss** - Transforming tags into personalized RSS feeds! 🎨✨