const BASE_URL = 'https://json.edhrec.com';
const USER_AGENT = 'CommandTowerMCP/0.1.0';

// TODO: EDHREC API utilities
// EDHREC has an unofficial JSON API that can be accessed at:
// - https://json.edhrec.com/pages/commanders/{commander-name}.json
// - https://json.edhrec.com/pages/cards/{card-name}.json
// - https://json.edhrec.com/pages/themes/{theme}.json
// - https://json.edhrec.com/pages/combos/{commander-name}.json

/**
 * Get commander recommendations
 * @param {string} commanderName - Commander name (hyphenated, e.g., "atraxa-praetors-voice")
 * @returns {Promise<object>}
 */
export async function getCommanderRecs(commanderName) {
  const slug = commanderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const response = await fetch(`${BASE_URL}/pages/commanders/${slug}.json`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Commander not found: ${commanderName}`);
    }
    throw new Error(`EDHREC API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get card usage data
 * @param {string} cardName - Card name (hyphenated, e.g., "sol-ring")
 * @returns {Promise<object>}
 */
export async function getCardData(cardName) {
  const slug = cardName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const response = await fetch(`${BASE_URL}/pages/cards/${slug}.json`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Card not found: ${cardName}`);
    }
    throw new Error(`EDHREC API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get combos for a commander
 * @param {string} commanderName - Commander name (hyphenated)
 * @returns {Promise<object>}
 */
export async function getCommanderCombos(commanderName) {
  const slug = commanderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const response = await fetch(`${BASE_URL}/pages/combos/${slug}.json`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Combos not found for: ${commanderName}`);
    }
    throw new Error(`EDHREC API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Convert card name to EDHREC slug
 * @param {string} name - Card name
 * @returns {string} EDHREC slug
 */
export function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
