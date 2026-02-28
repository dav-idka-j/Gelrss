const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const cacheService = process.env.DATABASE_URL
  ? require("./cache/databaseCache")
  : require("./cache/inMemoryCache");

const app = express();
const port = process.env.PORT || 3000;

const {
  GELBOORU_API_KEY,
  GELBOORU_USER_ID,
  UPDATE_INTERVAL_MINUTES = 10,
  BASE_URL = "localhost",
  GELBOORU_FETCH_LIMIT = 20,
  ARTIST_CACHE_SIZE = 200,
  DATABASE_URL,
} = process.env;

const FULL_BASE_URL = `http://${BASE_URL}:${port}`;

const feedConfigs = new Map();

async function loadArtistConfigs() {
  try {
    const configDir = path.join(__dirname, "configs");

    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
      console.log("📁 configs/ directory created");
    }

    const files = await fs.readdir(configDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(configDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const config = JSON.parse(content);
        const artistId = path.basename(file, ".json");

        // Basic validation
        if (!config.GELBOORU_TAG) {
          console.warn(`⚠️ Config ${file}: GELBOORU_TAG is required`);
          continue;
        }

        feedConfigs.set(artistId, {
          ARTIST_NAME: config.ARTIST_NAME || artistId,
          GELBOORU_TAG: config.GELBOORU_TAG,
          ICON_URL: config.ICON_URL || "",
          FEED_TITLE:
            config.FEED_TITLE ||
            `Posts of ${config.ARTIST_NAME || artistId} from Gelbooru`,
          FEED_LINK:
            config.FEED_LINK ||
            `https://gelbooru.com/index.php?page=post&s=list&tags=${config.GELBOORU_TAG}+`,
          MIN_SCORE: config.MIN_SCORE,
        });

        console.log(`✅ Config loaded: ${artistId}`);
      } catch (error) {
        console.error(`❌ Error loading config ${file}:`, error.message);
      }
    }

    if (feedConfigs.size === 0) {
      console.log("🔍 No configuration found. Creating examples...");
      await createExampleConfigs();
    } else {
      console.log(`🎨 ${feedConfigs.size} artist configuration(s) loaded`);
    }

    const activeArtistIds = Array.from(feedConfigs.keys());
    await cacheService.pruneStaleFeeds(activeArtistIds);
    console.log("🧹 Pruned stale feeds from cache.");
  } catch (error) {
    console.error("❌ Error loading configurations:", error);
  }
}

async function createExampleConfigs() {
  const configDir = path.join(__dirname, "configs");

  const exampleConfigs = [
    {
      file: "khyle.json",
      config: {
        ARTIST_NAME: "Khyle",
        GELBOORU_TAG: "khyle_(artist)",
        ICON_URL: "https://img.gelbooru.com/icon.png",
        FEED_TITLE: "Posts of Khyle from Gelbooru",
        FEED_LINK:
          "https://gelbooru.com/index.php?page=post&s=list&tags=khyle_(artist)+",
        MIN_SCORE: 20,
      },
    },
    {
      file: "optionaltypo.json",
      config: {
        ARTIST_NAME: "OptionalTypo",
        GELBOORU_TAG: "optionaltypo",
        ICON_URL:
          "https://pbs.twimg.com/profile_images/1333723296584462336/p9ApAZjk_400x400.jpg",
        FEED_TITLE: "Posts of OptionalTypo from Gelbooru",
        FEED_LINK:
          "https://gelbooru.com/index.php?page=post&s=list&tags=optionaltypo+",
        MIN_SCORE: 10,
      },
    },
  ];

  for (const { file, config } of exampleConfigs) {
    const filePath = path.join(configDir, file);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    console.log(`📄 Example file created: ${file}`);
  }

  await loadArtistConfigs();
}

async function fetchGelbooruPosts(tags, limit = GELBOORU_FETCH_LIMIT) {
  try {
    const params = {
      page: "dapi",
      s: "post",
      q: "index",
      json: "1",
      tags: tags,
      limit: limit,
    };

    if (GELBOORU_API_KEY && GELBOORU_USER_ID) {
      params.api_key = GELBOORU_API_KEY;
      params.user_id = GELBOORU_USER_ID;
    }

    const response = await axios.get("https://gelbooru.com/index.php", {
      params: params,
    });

    return response.data;
  } catch (error) {
    console.error("❌ Error fetching Gelbooru posts:", error.message);
    return null;
  }
}

function getEffectiveTags(artistId, config) {
  let tags = config.GELBOORU_TAG;
  if (config.MIN_SCORE !== undefined) {
    if (config.MIN_SCORE > 0) {
      tags += ` score:>${config.MIN_SCORE - 1}`;
    } else if (config.MIN_SCORE < 0) {
      console.warn(
        `⚠️ Config for ${artistId}: MIN_SCORE must be non-negative. Current value: ${config.MIN_SCORE}`,
      );
    }
  }
  return tags;
}

function toRFC822Date(dateString) {
  const date = new Date(dateString);
  return date.toUTCString();
}

async function needsUpdate(artistId) {
  const cacheData = await cacheService.getFeed(artistId);
  if (!cacheData || !cacheData.lastUpdate || !cacheData.rssContent) return true;

  const now = new Date();
  const lastUpdate = new Date(cacheData.lastUpdate);
  const diffMinutes = (now - lastUpdate) / (1000 * 60);
  return diffMinutes >= UPDATE_INTERVAL_MINUTES;
}

async function updateArtistCache(artistId) {
  const config = feedConfigs.get(artistId);
  if (!config) {
    console.error(`❌ Configuration not found for: ${artistId}`);
    return;
  }

  const cacheData = (await cacheService.getFeed(artistId)) || {
    isUpdating: false,
  };
  if (cacheData.isUpdating) {
    console.log(`🔄 Update already in progress for: ${artistId}`);
    return;
  }

  console.log(`🔄 Updating cache for: ${artistId}...`);
  await cacheService.setFeedUpdatingStatus(artistId, true);

  try {
    const tags = getEffectiveTags(artistId, config);
    const apiResponse = await fetchGelbooruPosts(tags);
    const posts = apiResponse?.post ?? [];

    if (posts.length > 0) {
      await cacheService.updateArtistCache({
        artistId,
        posts,
        postCount: posts.length,
      });
      console.log(`✅ Cache updated for ${artistId}: ${posts.length} posts`);
    } else {
      console.log(`⚠️ No new posts found for: ${artistId}`);
      await cacheService.setFeedUpdatingStatus(artistId, false);
    }
  } catch (error) {
    console.error(`❌ Error updating cache for ${artistId}:`, error.message);
  } finally {
    await cacheService.setFeedUpdatingStatus(artistId, false);
  }
}

function generateRSSFeed(posts, config, artistId) {
  if (!posts || posts.length === 0) {
    return null;
  }

  const rssItems = posts.map((post) => {
    const postId = post.id;
    const createdAt = post.created_at;
    const imageUrl = post.file_url;
    const tags = post.tags ? post.tags.replace(/\s+/g, " ").trim() : "";

    const title = post.title || `Post ${postId}`;

    const postLink = `https://gelbooru.com/index.php?page=post&s=view&id=${postId}`;

    const guid = `gelbooru:${artistId}:${postId}`;

    return {
      title: title,
      description: `<img src="${imageUrl}" referrerpolicy="no-referrer"><br/>Tags: ${tags}`,
      link: postLink,
      guid: {
        _: guid,
        $: { isPermaLink: "false" },
      },
      pubDate: toRFC822Date(createdAt),
      author: config.ARTIST_NAME,
    };
  });

  const rssData = {
    rss: {
      $: {
        version: "2.0",
        "xmlns:atom": "http://www.w3.org/2005/Atom",
      },
      channel: {
        title: config.FEED_TITLE,
        link: config.FEED_LINK,
        "atom:link": {
          $: {
            href: `${FULL_BASE_URL}/rss/${artistId}`,
            rel: "self",
            type: "application/rss+xml",
          },
        },
        description: `${config.FEED_TITLE} - Powered by Gelbooru RSS Generator`,
        generator: "Gelbooru RSS Generator v2.0",
        webMaster: "admin@example.com (RSS Generator)",
        language: "en",
        image: config.ICON_URL
          ? {
              url: config.ICON_URL,
              title: config.FEED_TITLE,
              link: config.FEED_LINK,
            }
          : undefined,
        lastBuildDate: new Date().toUTCString(),
        ttl: UPDATE_INTERVAL_MINUTES.toString(),
        item: rssItems,
      },
    },
  };

  if (!config.ICON_URL) {
    delete rssData.rss.channel.image;
  }

  const builder = new xml2js.Builder({
    xmldec: { version: "1.0", encoding: "UTF-8" },
  });

  return builder.buildObject(rssData);
}

app.get("/rss/:artistId", async (req, res) => {
  try {
    const artistId = req.params.artistId;
    const config = feedConfigs.get(artistId);

    if (!config) {
      return res.status(404).send(`Feed not found for: ${artistId}`);
    }

    if (await needsUpdate(artistId)) {
      console.log(`⏰ Cache expired for ${artistId}, updating...`);
      await updateArtistCache(artistId);
    }

    const cacheData = await cacheService.getFeed(artistId);
    if (!cacheData || !cacheData.posts || cacheData.posts.length === 0) {
      return res.status(404).send(`No posts available for: ${artistId}`);
    }

    res.set("Content-Type", "application/rss+xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${UPDATE_INTERVAL_MINUTES * 60}`);
    const rssContent = generateRSSFeed(cacheData.posts, config, artistId);
    res.send(rssContent);
  } catch (error) {
    console.error(`❌ Error serving RSS for ${req.params.artistId}:`, error);
    res.status(500).send("Internal server error");
  }
});

app.get("/test/:artistId", async (req, res) => {
  try {
    const artistId = req.params.artistId;
    const config = feedConfigs.get(artistId);

    if (!config) {
      return res
        .status(404)
        .json({ error: `Configuration not found for: ${artistId}` });
    }

    const tags = getEffectiveTags(artistId, config);

    const [posts, cacheData] = await Promise.all([
      fetchGelbooruPosts(tags, 5),
      cacheService.getFeed(artistId),
    ]);

    res.json({
      artistId: artistId,
      config: config,
      cache: {
        hasCache: !!(
          cacheData &&
          cacheData.posts &&
          cacheData.posts.length > 0
        ),
        lastUpdate: cacheData?.lastUpdate || null,
        needsUpdate: await needsUpdate(artistId),
        isUpdating: cacheData?.isUpdating || false,
        postCount: cacheData?.post_count || 0,
      },
      postsFound: posts ? posts.post?.length || 0 : 0,
      firstPost: posts?.post?.[0] || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/refresh/:artistId", async (req, res) => {
  try {
    const artistId = req.params.artistId;
    const config = feedConfigs.get(artistId);

    if (!config) {
      return res
        .status(404)
        .json({ error: `Configuration not found for: ${artistId}` });
    }

    await updateArtistCache(artistId);
    const cacheData = await cacheService.getFeed(artistId);

    res.json({
      success: true,
      artistId,
      message: "Cache updated successfully",
      lastUpdate: cacheData?.lastUpdate,
      nextUpdate: cacheData?.lastUpdate
        ? new Date(
            new Date(cacheData.lastUpdate).getTime() +
              UPDATE_INTERVAL_MINUTES * 60 * 1000,
          ).toISOString()
        : null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/refresh-all", async (req, res) => {
  try {
    const artistIds = Array.from(feedConfigs.keys());
    const results = [];

    for (const artistId of artistIds) {
      try {
        await updateArtistCache(artistId);
        results.push({ artistId, status: "success" });
      } catch (error) {
        results.push({ artistId, status: "error", error: error.message });
      }
    }

    res.json({
      success: true,
      message: "Update of all feeds completed",
      results: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/", async (req, res) => {
  const allFeeds = await cacheService.getAllFeeds();
  const feedList = Array.from(feedConfigs.entries()).map(
    ([artistId, config]) => {
      const cacheData = allFeeds.find((f) => f.artistId === artistId);
      const nextUpdate = cacheData?.lastUpdate
        ? new Date(
            new Date(cacheData.lastUpdate).getTime() +
              UPDATE_INTERVAL_MINUTES * 60 * 1000,
          )
        : null;

      return {
        artistId,
        config,
        cache: cacheData,
        nextUpdate,
      };
    },
  );

  const feedRows = feedList
    .map(
      ({ artistId, config, cache, nextUpdate }) => `
        <tr>
            <td><strong>${config.ARTIST_NAME}</strong></td>
            <td><code>${config.GELBOORU_TAG}</code></td>
            <td>${config.MIN_SCORE !== undefined ? `<code>${config.MIN_SCORE}</code>` : "None"}</td>
            <td>${cache && cache.posts && cache.posts.length > 0 ? "✅" : "❌"}</td>
            <td>${cache ? new Date(cache.lastUpdate).toLocaleString("en-US") : "Never"}</td>
            <td>${cache && cache.isUpdating ? "🔄" : "⏸️"}</td>
            <td>
                <a href="/rss/${artistId}" target="_blank">RSS</a> |
                <a href="/test/${artistId}" target="_blank">Test</a> |
                <a href="/refresh/${artistId}" target="_blank">Refresh</a>
            </td>
        </tr>
    `,
    )
    .join("");

  res.send(`
        <html>
        <head>
            <title>Gelbooru RSS Generator v2.2</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                table { border-collapse: collapse; width: 100%; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background-color: #f2f2f2; }
                .config { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; }
                a { color: #0066cc; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>🎨 Gelbooru RSS Generator v2.2</h1>

            <h2>📊 Global Status</h2>
            <p><strong>Configured Feeds:</strong> ${feedConfigs.size}</p>
            <p><strong>Base URL:</strong> ${FULL_BASE_URL}</p>
            <p><strong>Update Interval:</strong> ${UPDATE_INTERVAL_MINUTES} minutes</p>
            <p><strong>API Key:</strong> ${GELBOORU_API_KEY ? "✅ Configured" : "❌ Not configured"}</p>
            <p><strong>User ID:</strong> ${GELBOORU_USER_ID ? "✅ Configured" : "❌ Not configured"}</p>
            <p><strong>Cache:</strong> ${DATABASE_URL ? `Database (${DATABASE_URL})` : "In-Memory"}</p>

            <h2>🎭 Available Feeds</h2>
            ${
              feedConfigs.size > 0
                ? `
                <table>
                    <thead>
                        <tr>
                            <th>Artist</th>
                            <th>Tag</th>
                            <th>Min Score</th>
                            <th>Cache</th>
                            <th>Last Update</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${feedRows}
                    </tbody>
                </table>
                <p><a href="/refresh-all">🔄 Update All Feeds</a></p>
            `
                : "<p>❌ No feeds configured. Check the configs/ directory</p>"
            }

            <h2>📝 How to Add a New Feed</h2>
            <div class="config">
                <p>1. Create a JSON file at <code>configs/artist-name.json</code></p>
                <p>2. Use this format:</p>
                <pre>{
  "ARTIST_NAME": "Artist Name",
  "GELBOORU_TAG": "artist_tag",
  "ICON_URL": "https://example.com/icon.png",
  "FEED_TITLE": "Posts of Artist from Gelbooru",
  "MIN_SCORE": 20
}</pre>
                <p>3. Restart the server or access <code>/refresh/artist-name</code></p>
                <p>4. Access the feed at <code>/rss/artist-name</code></p>
            </div>

            <h2>🔗 Global Endpoints</h2>
            <ul>
                <li><a href="/refresh-all">🔄 Update all feeds</a></li>
                <li><code>/rss/{artistId}</code> - Specific RSS feed</li>
                <li><code>/test/{artistId}</code> - Test specific configuration</li>
                <li><code>/refresh/{artistId}</code> - Force specific update</li>
            </ul>
        </body>
        </html>
    `);
});

async function initializeAllCaches() {
  console.log("🚀 Initializing caches...");
  const artistIds = Array.from(feedConfigs.keys());

  for (const artistId of artistIds) {
    try {
      if (await needsUpdate(artistId)) {
        await updateArtistCache(artistId);
      }
    } catch (error) {
      console.error(
        `❌ Error initializing cache for ${artistId}:`,
        error.message,
      );
    }
  }

  const intervalMs = UPDATE_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    console.log("⏰ Running automatic update...");
    for (const artistId of Array.from(feedConfigs.keys())) {
      if (await needsUpdate(artistId)) {
        await updateArtistCache(artistId);
      }
    }
  }, intervalMs);

  console.log(
    `✅ System configured to update every ${UPDATE_INTERVAL_MINUTES} minutes`,
  );
}

async function startServer() {
  await cacheService.initialize();
  await loadArtistConfigs();

  app.listen(port, () => {
    console.log("=".repeat(60));
    console.log("🎨 Gelbooru RSS Generator v2.2");
    console.log("=".repeat(60));
    console.log(`🌐 Server running at: ${FULL_BASE_URL}`);
    console.log(`📁 Available feeds: ${feedConfigs.size}`);
    console.log(`⚙️ Settings:`);
    console.log(`   - Base URL: ${BASE_URL}`);
    console.log(`   - Port: ${port}`);
    console.log(
      `   - API Key: ${GELBOORU_API_KEY ? "Configured" : "Not configured"}`,
    );
    console.log(
      `   - User ID: ${GELBOORU_USER_ID ? "Configured" : "Not configured"}`,
    );
    console.log(`   - Interval: ${UPDATE_INTERVAL_MINUTES} minutes`);
    console.log(
      `   - Cache: ${DATABASE_URL ? `Database (${DATABASE_URL})` : "In-Memory"}`,
    );
    console.log("=".repeat(60));

    if (feedConfigs.size > 0) {
      console.log("📡 Available feeds:");
      for (const [artistId, config] of feedConfigs.entries()) {
        console.log(
          `   - ${FULL_BASE_URL}/rss/${artistId} (${config.ARTIST_NAME})`,
        );
      }
    } else {
      console.log("⚠️ No feeds configured. Check configs/");
    }
    console.log("=".repeat(60));
  });

  if (feedConfigs.size > 0) {
    await initializeAllCaches();
  }
}

startServer().catch(console.error);

module.exports = app;
