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
 * Search for a card by fuzzy name matching
 * @param {string} name - Card name (fuzzy matching)
 * @param {string} [set] - Optional set code to filter by
 * @returns {Promise<object>} Card object
 */
export async function searchByName(name, set) {
  const params = new URLSearchParams({ fuzzy: name });
  if (set) params.append('set', set);

  const response = await rateLimitedFetch(`${BASE_URL}/cards/named?${params}`);

  if (!response.ok) {
    if (response.status === 404) {
      const error = await response.json();
      throw new Error(error.details || `Card not found: ${name}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Search for a card by exact name
 * @param {string} name - Exact card name
 * @param {string} [set] - Optional set code to filter by
 * @returns {Promise<object>} Card object
 */
export async function searchByExactName(name, set) {
  const params = new URLSearchParams({ exact: name });
  if (set) params.append('set', set);

  const response = await rateLimitedFetch(`${BASE_URL}/cards/named?${params}`);

  if (!response.ok) {
    if (response.status === 404) {
      const error = await response.json();
      throw new Error(error.details || `Card not found: ${name}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Search for cards using Scryfall query syntax
 * @param {string} query - Scryfall query (e.g., "c:blue t:instant cmc<3")
 * @param {object} [options]
 * @param {string} [options.order='name'] - Sort order: name, set, released, rarity, color, usd, tix, eur, cmc, power, toughness, edhrec, penny, artist, review
 * @param {string} [options.dir='auto'] - Sort direction: auto, asc, desc
 * @param {boolean} [options.includeExtras=false] - Include tokens, emblems, etc.
 * @param {boolean} [options.includeMultilingual=false] - Include non-English prints
 * @param {boolean} [options.includeVariations=true] - Include alternate art variations
 * @param {string} [options.unique='cards'] - cards, art, or prints
 * @param {number} [options.page=1] - Page number for paginated results
 * @returns {Promise<{data: Array, has_more: boolean, next_page?: string, total_cards: number}>}
 */
export async function search(query, options = {}) {
  const {
    order = 'name',
    dir = 'auto',
    includeExtras = false,
    includeMultilingual = false,
    includeVariations = true,
    unique = 'cards',
    page = 1,
  } = options;

  const params = new URLSearchParams({
    q: query,
    order,
    dir,
    include_extras: includeExtras,
    include_multilingual: includeMultilingual,
    include_variations: includeVariations,
    unique,
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

/**
 * Get all cards matching a query (auto-paginate)
 * @param {string} query - Scryfall query
 * @param {object} [options] - Same as search()
 * @param {number} [maxPages=10] - Maximum pages to fetch
 * @returns {Promise<Array>} All matching cards
 */
export async function searchAll(query, options = {}, maxPages = 10) {
  const allCards = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const result = await search(query, { ...options, page });
    allCards.push(...result.data);
    hasMore = result.has_more;
    page++;
  }

  return allCards;
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
  const hasMore = cached.fullyLoaded
    ? endIndex < cached.cards.length
    : true;

  return {
    cards,
    totalCards: cached.totalCards,
    hasMore: endIndex < cached.totalCards,
  };
}

/**
 * Get a card by Scryfall ID
 * @param {string} id - Scryfall UUID
 * @returns {Promise<object>} Card object
 */
export async function getCardById(id) {
  const response = await rateLimitedFetch(`${BASE_URL}/cards/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Card not found: ${id}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a card by set code and collector number
 * @param {string} setCode - Set code (e.g., "cmm")
 * @param {string} collectorNumber - Collector number
 * @param {string} [lang] - Language code (optional)
 * @returns {Promise<object>} Card object
 */
export async function getCardBySetAndNumber(setCode, collectorNumber, lang) {
  const path = lang
    ? `/cards/${setCode}/${collectorNumber}/${lang}`
    : `/cards/${setCode}/${collectorNumber}`;

  const response = await rateLimitedFetch(`${BASE_URL}${path}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Card not found: ${setCode} #${collectorNumber}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a card by multiverse ID (Gatherer)
 * @param {number} multiverseId - Gatherer multiverse ID
 * @returns {Promise<object>} Card object
 */
export async function getCardByMultiverseId(multiverseId) {
  const response = await rateLimitedFetch(`${BASE_URL}/cards/multiverse/${multiverseId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Card not found: multiverse ${multiverseId}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

// /**
//  * Get a card by MTGO ID
//  * @param {number} mtgoId - Magic: The Gathering Online ID
//  * @returns {Promise<object>} Card object
//  */
// export async function getCardByMtgoId(mtgoId) {
//   const response = await rateLimitedFetch(`${BASE_URL}/cards/mtgo/${mtgoId}`);
//
//   if (!response.ok) {
//     if (response.status === 404) {
//       throw new Error(`Card not found: MTGO ${mtgoId}`);
//     }
//     throw new Error(`Scryfall API error: ${response.status}`);
//   }
//
//   return response.json();
// }

// /**
//  * Get a card by Arena ID
//  * @param {number} arenaId - MTG Arena card ID
//  * @returns {Promise<object>} Card object
//  */
// export async function getCardByArenaId(arenaId) {
//   const response = await rateLimitedFetch(`${BASE_URL}/cards/arena/${arenaId}`);
//
//   if (!response.ok) {
//     if (response.status === 404) {
//       throw new Error(`Card not found: Arena ${arenaId}`);
//     }
//     throw new Error(`Scryfall API error: ${response.status}`);
//   }
//
//   return response.json();
// }

// /**
//  * Get a card by TCGPlayer ID
//  * @param {number} tcgplayerId - TCGPlayer product ID
//  * @returns {Promise<object>} Card object
//  */
// export async function getCardByTcgplayerId(tcgplayerId) {
//   const response = await rateLimitedFetch(`${BASE_URL}/cards/tcgplayer/${tcgplayerId}`);
//
//   if (!response.ok) {
//     if (response.status === 404) {
//       throw new Error(`Card not found: TCGPlayer ${tcgplayerId}`);
//     }
//     throw new Error(`Scryfall API error: ${response.status}`);
//   }
//
//   return response.json();
// }

/**
 * Get a random card
 * @param {string} [query] - Optional query to constrain random card
 * @returns {Promise<object>} Card object
 */
export async function getRandomCard(query) {
  const params = query ? `?q=${encodeURIComponent(query)}` : '';
  const response = await rateLimitedFetch(`${BASE_URL}/cards/random${params}`);

  if (!response.ok) {
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Autocomplete card names
 * @param {string} query - Partial card name (minimum 2 characters)
 * @param {boolean} [includeExtras=false] - Include tokens, emblems, etc.
 * @returns {Promise<{data: Array<string>}>} Array of card names
 */
export async function autocomplete(query, includeExtras = false) {
  const params = new URLSearchParams({
    q: query,
    include_extras: includeExtras,
  });

  const response = await rateLimitedFetch(`${BASE_URL}/cards/autocomplete?${params}`);

  if (!response.ok) {
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get card image URL
 * @param {object} card - Card object from Scryfall
 * @param {string} [size='large'] - Image size: small, normal, large, png, art_crop, border_crop
 * @param {number} [faceIndex=0] - For double-faced cards, which face to get
 * @returns {string|null} Image URL or null if not available
 */
export function getCardImageUrl(card, size = 'large', faceIndex = 0) {
  // Single-faced cards
  if (card.image_uris) {
    return card.image_uris[size] || card.image_uris.large || card.image_uris.normal;
  }

  // Double-faced cards
  if (card.card_faces && card.card_faces[faceIndex]?.image_uris) {
    const face = card.card_faces[faceIndex];
    return face.image_uris[size] || face.image_uris.large || face.image_uris.normal;
  }

  return null;
}

/**
 * Fetch card image as base64
 * @param {object} card - Card object from Scryfall
 * @param {string} [size='large'] - Image size
 * @param {number} [faceIndex=0] - For double-faced cards
 * @returns {Promise<{data: string, mimeType: string}|null>}
 */
export async function fetchCardImage(card, size = 'large', faceIndex = 0) {
  const url = getCardImageUrl(card, size, faceIndex);
  if (!url) return null;

  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';

  return { data: base64, mimeType: contentType };
}

/**
 * Get all sets
 * @returns {Promise<{data: Array}>} Array of set objects
 */
export async function getSets() {
  const response = await rateLimitedFetch(`${BASE_URL}/sets`);

  if (!response.ok) {
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a specific set by code
 * @param {string} code - Set code (e.g., "cmm")
 * @returns {Promise<object>} Set object
 */
export async function getSet(code) {
  const response = await rateLimitedFetch(`${BASE_URL}/sets/${code}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Set not found: ${code}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get card rulings by Scryfall ID
 * @param {string} id - Scryfall UUID
 * @returns {Promise<{data: Array}>} Array of rulings
 */
export async function getRulings(id) {
  const response = await rateLimitedFetch(`${BASE_URL}/cards/${id}/rulings`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Rulings not found for card: ${id}`);
    }
    throw new Error(`Scryfall API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Parse Scryfall mana cost to color array
 * @param {string} manaCost - Mana cost string (e.g., "{2}{U}{U}")
 * @returns {Array<string>} Array of colors (W, U, B, R, G)
 */
export function parseManaCostColors(manaCost) {
  if (!manaCost) return [];
  const colors = new Set();
  const regex = /\{([WUBRG])\}/g;
  let match;
  while ((match = regex.exec(manaCost)) !== null) {
    colors.add(match[1]);
  }
  return [...colors];
}

/**
 * Look up multiple cards by name in a single request (max 75)
 * @param {Array<string>} cardNames - Array of card names
 * @returns {Promise<{found: Array, notFound: Array<string>}>} Found cards and not found names
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

/**
 * Format card for display
 * @param {object} card - Scryfall card object
 * @returns {object} Simplified card info
 */
export function formatCardForDisplay(card) {
  return {
    name: card.name,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    oracleText: card.oracle_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    colors: card.colors,
    colorIdentity: card.color_identity,
    set: card.set_name,
    setCode: card.set,
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    scryfallId: card.id,
    scryfallUri: card.scryfall_uri,
    prices: card.prices,
    legalities: card.legalities,
    edhrecRank: card.edhrec_rank,
  };
}
