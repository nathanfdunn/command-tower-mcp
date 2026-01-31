const BASE_URL = 'https://archidekt.com/api';
const USER_AGENT = 'CommandTowerMCP/0.1.0';

// Cached auth state
let authCache = {
  accessToken: null,
  refreshToken: null,
  rootFolder: null,
  expiresAt: null,
};

/**
 * Get valid access token, logging in if needed
 * Uses ARCHIDEKT_USERNAME and ARCHIDEKT_PASSWORD env vars
 * @returns {Promise<{accessToken: string, rootFolder: number}>}
 */
export async function getAuth() {
  // Check if we have a valid cached token (with 5 min buffer)
  if (authCache.accessToken && authCache.expiresAt && Date.now() < authCache.expiresAt - 300000) {
    return { accessToken: authCache.accessToken, rootFolder: authCache.rootFolder };
  }

  const username = process.env.ARCHIDEKT_USERNAME;
  const password = process.env.ARCHIDEKT_PASSWORD;

  if (!username || !password) {
    throw new Error('ARCHIDEKT_USERNAME and ARCHIDEKT_PASSWORD environment variables are required');
  }

  const result = await login(username, password);

  // Cache the token (JWT typically expires in 1 hour, we'll assume 1 hour)
  authCache = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    rootFolder: result.rootFolder,
    expiresAt: Date.now() + 3600000, // 1 hour
  };

  return { accessToken: authCache.accessToken, rootFolder: authCache.rootFolder };
}

// Deck format constants
export const DECK_FORMATS = {
  STANDARD: 1,
  MODERN: 2,
  COMMANDER: 3,
  LEGACY: 4,
  VINTAGE: 5,
  PAUPER: 6,
  PIONEER: 7,
  BRAWL: 8,
  HISTORIC: 9,
  OATHBREAKER: 10,
};

/**
 * Login to Archidekt and get access token
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{accessToken: string, refreshToken: string, rootFolder: number, user: object}>}
 */
export async function login(username, password) {
  const response = await fetch(`${BASE_URL}/rest-auth/login/`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.non_field_errors?.[0] || `Login failed: ${response.status}`);
  }
  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    rootFolder: data.user.rootFolder,
    user: data.user,
  };
}

/**
 * List user's decks
 * @param {string} accessToken
 * @returns {Promise<Array>}
 */
export async function listDecks(accessToken) {
  const response = await fetch(`${BASE_URL}/decks/curated/self/`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `JWT ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list decks: ${response.status}`);
  }

  const data = await response.json();
  return data.results;
}

/**
 * Get a deck by ID
 * @param {string} accessToken
 * @param {number} deckId
 * @returns {Promise<object>}
 */
export async function getDeck(accessToken, deckId) {
  const response = await fetch(`${BASE_URL}/decks/${deckId}/`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `JWT ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get deck: ${response.status}`);
  }

  return response.json();
}

/**
 * Create a new deck
 * @param {string} accessToken
 * @param {object} options
 * @param {string} options.name - Deck name
 * @param {number} options.parentFolder - Parent folder ID (use rootFolder from login)
 * @param {number} [options.deckFormat=3] - Deck format (default: Commander)
 * @param {string} [options.description='']
 * @param {boolean} [options.private=true]
 * @param {boolean} [options.unlisted=false]
 * @returns {Promise<object>}
 */
export async function createDeck(accessToken, options) {
  const {
    name,
    parentFolder,
    deckFormat = DECK_FORMATS.COMMANDER,
    description = '',
    private: isPrivate = true,
    unlisted = false,
  } = options;

  const response = await fetch(`${BASE_URL}/decks/v2/`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `JWT ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      name,
      deckFormat,
      edhBracket: null,
      description,
      featured: '',
      playmat: '',
      private: isPrivate,
      unlisted,
      theorycrafted: false,
      game: null,
      parent_folder: parentFolder,
      cardPackage: null,
      extras: {
        decksToInclude: [],
        commandersToAdd: [],
        forceCardsToSingleton: false,
        ignoreCardsOutOfCommanderIdentity: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create deck: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Compute diff between current deck state and new edit
 * @param {string} accessToken
 * @param {string} currentDeckList - Current deck in Archidekt format
 * @param {string} editDeckList - New deck list to compare
 * @param {string} [parser='archidekt'] - Parser format
 * @returns {Promise<{toAdd: Array, toRemove: Array, cardErrors: Array, syntaxErrors: Array, categories: object}>}
 */
export async function computeDiff(accessToken, currentDeckList, editDeckList, parser = 'archidekt') {
  const response = await fetch(`${BASE_URL}/cards/massDeckEdit/`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `JWT ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      parser,
      current: currentDeckList,
      edit: editDeckList,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to compute diff: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Modify cards in a deck (add, remove, or update)
 * @param {string} accessToken
 * @param {number} deckId
 * @param {Array<object>} cards - Array of card modifications
 * @returns {Promise<{add: Array, createdCategories: Array}>}
 */
export async function modifyCards(accessToken, deckId, cards) {
  const response = await fetch(`${BASE_URL}/decks/${deckId}/modifyCards/v2/`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `JWT ${accessToken}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ cards }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to modify cards: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Helper to create an "add" card action
 * @param {object} options
 * @param {string} options.cardId - Archidekt card ID
 * @param {number} [options.quantity=1]
 * @param {Array<string>} [options.categories=[]]
 * @param {string} [options.modifier='Normal'] - 'Normal' or 'Foil'
 * @param {string} [options.label=',#656565'] - Label and color
 * @returns {object}
 */
export function createAddCardAction(options) {
  const {
    cardId,
    quantity = 1,
    categories = [],
    modifier = 'Normal',
    label = ',#656565',
  } = options;

  return {
    action: 'add',
    cardid: cardId,
    customCardId: null,
    categories,
    patchId: generatePatchId(),
    modifications: {
      quantity,
      modifier,
      customCmc: null,
      companion: false,
      flippedDefault: false,
      label,
    },
  };
}

/**
 * Helper to create a "remove" card action
 * @param {object} options
 * @param {string} options.cardId - Archidekt card ID
 * @param {string} options.deckRelationId - The deck relation ID from the deck
 * @param {number} [options.quantity=1]
 * @param {Array<string>} [options.categories=[]]
 * @param {string} [options.modifier='Normal']
 * @param {string} [options.label=',#656565']
 * @returns {object}
 */
export function createRemoveCardAction(options) {
  const {
    cardId,
    deckRelationId,
    quantity = 1,
    categories = [],
    modifier = 'Normal',
    label = ',#656565',
  } = options;

  return {
    action: 'remove',
    cardid: cardId,
    customCardId: null,
    categories,
    patchId: generatePatchId(),
    modifications: {
      quantity,
      modifier,
      customCmc: null,
      companion: false,
      flippedDefault: false,
      label,
    },
    deckRelationId,
  };
}

/**
 * Generate a random patch ID for card operations
 * @returns {string}
 */
function generatePatchId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
