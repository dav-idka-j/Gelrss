const knex = require("knex");

const ARTIST_CACHE_SIZE = parseInt(process.env.ARTIST_CACHE_SIZE, 10) || 200;

let db;

async function initialize() {
  const dbPath = process.env.DATABASE_URL.replace("sqlite://", "");
  db = knex({
    client: "sqlite3",
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
  });

  await db.schema.hasTable("feeds").then(async (exists) => {
    if (!exists) {
      await db.schema.createTable("feeds", (table) => {
        table.string("artist_id").primary();
        table.datetime("last_update");
        table.integer("post_count");
        table.boolean("is_updating").defaultTo(false);
      });
    }
  });

  // Set all feeds to not be updating on startup (to clean up after a crash e.g.)
  await db("feeds").update({ is_updating: false });

  await db.schema.hasTable("posts").then(async (exists) => {
    if (!exists) {
      await db.schema.createTable("posts", (table) => {
        table.integer("post_id").primary();
        table
          .string("artist_id")
          .references("artist_id")
          .inTable("feeds")
          .onDelete("CASCADE");
        table.datetime("created_at");
        table.json("post_data");
      });
    }
  });
}

function rowToFeed(row) {
  return {
    artistId: row.artist_id,
    lastUpdate: row.last_update,
    postCount: row.post_count,
    isUpdating: row.is_updating,
  };
}

async function getFeed(artistId) {
  const feedRow = await db("feeds").where("artist_id", artistId).first();
  if (feedRow) {
    const posts = await db("posts")
      .where("artist_id", artistId)
      .orderBy("created_at", "desc");
    let feed = rowToFeed(feedRow);
    feed.posts = posts.map((p) => JSON.parse(p.post_data));
    return feed;
  }
  return null;
}

async function updateArtistCache({ artistId, posts, postCount }) {
  return db.transaction(async (trx) => {
    const feedData = {
      artist_id: artistId,
      last_update: new Date().toISOString(),
      post_count: postCount,
      is_updating: false,
    };

    await trx("feeds").insert(feedData).onConflict("artist_id").merge();

    if (posts && posts.length > 0) {
      const postRecords = posts.map((p) => ({
        post_id: p.id,
        artist_id: artistId,
        created_at: p.created_at,
        post_data: JSON.stringify(p),
      }));

      await trx("posts").insert(postRecords).onConflict("post_id").merge();
    }

    const oldestAllowedPost = await trx("posts")
      .where({ artist_id: artistId })
      .orderBy("created_at", "desc")
      .offset(ARTIST_CACHE_SIZE)
      .first("created_at");

    if (oldestAllowedPost) {
      await trx("posts")
        .where({ artist_id: artistId })
        .andWhere("created_at", "<", oldestAllowedPost.created_at)
        .del();
    }
  });
}

async function setFeedUpdatingStatus(artistId, isUpdating) {
  return db("feeds")
    .where("artist_id", artistId)
    .update({ is_updating: isUpdating });
}

async function getAllFeeds() {
  const feedRows = await db("feeds").select("*");
  const postRows = await db("posts").orderBy("created_at", "desc");

  return feedRows.map((row) => {
    const feedPosts = postRows
      .filter((p) => p.artist_id === row.artist_id)
      .map((p) => JSON.parse(p.post_data));

    const feed = rowToFeed(row);
    feed.posts = feedPosts;
    return feed;
  });
}

async function pruneStaleFeeds(activeArtistIds) {
  return db("feeds").whereNotIn("artist_id", activeArtistIds).del();
}

module.exports = {
  initialize,
  getFeed,
  updateArtistCache,
  setFeedUpdatingStatus,
  getAllFeeds,
  pruneStaleFeeds,
};
