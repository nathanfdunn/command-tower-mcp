const BASE_URL = 'https://api.scryfall.com';
const USER_AGENT = 'CommandTowerMCP/0.1.0';

// Scryfall asks for 50-100ms between requests
const RATE_LIMIT_MS = 100;
let lastRequestTime = 0;

// Cache for paginated search results
// Key: "query|order" -> { cards: [], totalCards: number, fullyLoaded: boolean, timestamp: number }
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function rateLimitedFetch(url, options = {}) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
      ...options.headers,
    },
  });

  return response;
}

/**
 * Search for cards using Scryfall query syntax
 * @param {string} query - Scryfall query (e.g., "c:blue t:instant cmc<3")
 * @param {object} [options]
 * @param {string} [options.order='name'] - Sort order
 * @param {number} [options.page=1] - Page number
 * @returns {Promise<{data: Array, has_more: boolean, total_cards: number}>}
 */
export async function search(query, options = {}) {
  const { order = 'name', page = 1 } = options;

  const params = new URLSearchParams({
    q: query,
    order,
    page,
  });

  const response = await rateLimitedFetch(`${BASE_URL}/cards/search?${params}`);

  if (!response.ok) {
    if (response.status === 404) {
      return { data: [], has_more: false, total_cards: 0 };
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.details || `Scryfall search error: ${response.status}`);
  }

  return response.json();
}

const SCRYFALL_PAGE_SIZE = 175;

/**
 * Search with caching and proper pagination
 * @param {string} query - Scryfall query
 * @param {object} options
 * @param {number} [options.offset=0] - Starting result index
 * @param {number} [options.limit=20] - Number of results to return
 * @param {string} [options.order='name'] - Sort order
 * @returns {Promise<{cards: Array, totalCards: number, hasMore: boolean}>}
 */
export async function searchPaginated(query, options = {}) {
  const { offset = 0, limit = 20, order = 'name' } = options;
  const cacheKey = `${query}|${order}`;

  // Check cache
  let cached = searchCache.get(cacheKey);
  const now = Date.now();

  // Invalidate expired cache
  if (cached && (now - cached.timestamp) > CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    cached = null;
  }

  // Initialize cache entry if needed
  if (!cached) {
    cached = { cards: [], totalCards: 0, fullyLoaded: false, timestamp: now };
    searchCache.set(cacheKey, cached);
  }

  const endIndex = offset + limit;

  // Fetch more pages if needed
  while (!cached.fullyLoaded && cached.cards.length < endIndex) {
    const nextPage = Math.floor(cached.cards.length / SCRYFALL_PAGE_SIZE) + 1;

    const result = await search(query, { order, page: nextPage });

    if (!result.data || result.data.length === 0) {
      cached.fullyLoaded = true;
      break;
    }

    cached.cards.push(...result.data);
    cached.totalCards = result.total_cards;

    if (!result.has_more) {
      cached.fullyLoaded = true;
    }
  }

  // Slice the requested range
  const cards = cached.cards.slice(offset, endIndex);

  return {
    cards,
    totalCards: cached.totalCards,
    hasMore: endIndex < cached.totalCards,
  };
}

/**
 * Look up multiple cards by name in a single request (max 75 per batch)
 * @param {Array<string>} cardNames - Array of card names
 * @returns {Promise<{found: Array, notFound: Array<string>}>}
 */
export async function lookupCollection(cardNames) {
  if (!cardNames || cardNames.length === 0) {
    return { found: [], notFound: [] };
  }

  // Scryfall allows max 75 identifiers per request
  const MAX_BATCH = 75;
  const allFound = [];
  const allNotFound = [];

  for (let i = 0; i < cardNames.length; i += MAX_BATCH) {
    const batch = cardNames.slice(i, i + MAX_BATCH);
    const identifiers = batch.map(name => ({ name }));

    const response = await rateLimitedFetch(`${BASE_URL}/cards/collection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifiers }),
    });

    if (!response.ok) {
      throw new Error(`Scryfall API error: ${response.status}`);
    }

    const result = await response.json();
    allFound.push(...(result.data || []));
    allNotFound.push(...(result.not_found || []).map(nf => nf.name));
  }

  return { found: allFound, notFound: allNotFound };
}
