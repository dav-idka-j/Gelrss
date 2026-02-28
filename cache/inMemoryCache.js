const feedCache = new Map();

const ARTIST_CACHE_SIZE = parseInt(process.env.ARTIST_CACHE_SIZE, 10) || 200;

async function initialize() {
  // No-op for in-memory cache
  return Promise.resolve();
}

async function getFeed(artistId) {
  return Promise.resolve(feedCache.get(artistId));
}

async function updateArtistCache({ artistId, posts, postCount }) {
  const existingFeed = feedCache.get(artistId) || {};

  const allPosts = [...(existingFeed.posts || []), ...posts];
  const uniquePosts = Array.from(
    new Map(allPosts.map((post) => [post.id, post])).values(),
  ); // Deduplicate by post.id
  const sortedAndLimitedPosts = uniquePosts
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, ARTIST_CACHE_SIZE);

  const updatedFeed = {
    ...existingFeed,
    artistId: artistId,
    postCount: postCount,
    posts: sortedAndLimitedPosts,
    lastUpdate: new Date().toISOString(),
  };
  feedCache.set(artistId, updatedFeed);
  return Promise.resolve();
}

async function setFeedUpdatingStatus(artistId, isUpdating) {
  const feed = feedCache.get(artistId);
  if (feed) {
    feed.isUpdating = isUpdating;
    feedCache.set(artistId, feed);
  }
  return Promise.resolve();
}

async function getAllFeeds() {
  return Promise.resolve(Array.from(feedCache.values()));
}

async function pruneStaleFeeds(activeArtistIds) {
  const staleKeys = Array.from(feedCache.keys()).filter(
    (key) => !activeArtistIds.includes(key),
  );
  staleKeys.forEach((key) => feedCache.delete(key));
  return Promise.resolve();
}

module.exports = {
  initialize,
  getFeed,
  updateArtistCache,
  setFeedUpdatingStatus,
  getAllFeeds,
  pruneStaleFeeds,
};
