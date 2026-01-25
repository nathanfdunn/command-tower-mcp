#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as archidekt from './utils/archidekt.js';
import * as scryfall from './utils/scryfall.js';

const server = new Server(
  {
    name: 'command-tower-mcp',
    version: '0.1.0',
    description: 'Magic: The Gathering deck building tools for Archidekt and Scryfall. For additional research, use web search/fetch to access EDHREC.com (commander staples, synergies), CommanderSpellbook.com (combos), and MTGGoldfish.com (meta, prices).',
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_deck',
        description: 'Create a new deck on Archidekt.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the new deck',
            },
            format: {
              type: 'string',
              description: 'Deck format: commander, standard, modern, legacy, vintage, pauper, pioneer, brawl, historic, oathbreaker',
              default: 'commander',
            },
            description: {
              type: 'string',
              description: 'Optional deck description',
            },
            private: {
              type: 'boolean',
              description: 'Whether the deck should be private (default: true)',
              default: true,
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'list_decks',
        description: 'List all decks in your Archidekt account.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'read_deck',
        description: 'Read the contents of an Archidekt deck. Returns a formatted list of card names.',
        inputSchema: {
          type: 'object',
          properties: {
            deck_id: {
              type: 'number',
              description: 'The Archidekt deck ID to read',
            },
          },
          required: ['deck_id'],
        },
      },
      {
        name: 'update_deck',
        description: 'Update cards in an Archidekt deck. Provide cards to add and/or remove as text lists.',
        inputSchema: {
          type: 'object',
          properties: {
            deck_id: {
              type: 'number',
              description: 'The Archidekt deck ID to update',
            },
            cards_to_add: {
              type: 'string',
              description: 'Cards to add. Use # headers for categories, e.g.:\n# Commander\n1 Kenrith, the Returned King\n# Ramp\n1 Sol Ring\n1 Arcane Signet',
            },
            cards_to_remove: {
              type: 'string',
              description: 'Cards to remove, one per line. Format: "2 Sol Ring" or "1x Lightning Bolt"',
            },
          },
          required: ['deck_id'],
        },
      },
      {
        name: 'lookup_cards',
        description: 'Look up Magic: The Gathering cards by name. Returns oracle text, mana cost, type, and other details. Use this to learn about unfamiliar cards.',
        inputSchema: {
          type: 'object',
          properties: {
            card_names: {
              type: 'string',
              description: 'Card names to look up, one per line (max 150)',
            },
          },
          required: ['card_names'],
        },
      },
      {
        name: 'search_cards',
        description: 'Search for Magic: The Gathering cards using Scryfall query syntax. Examples: "ci:simic t:creature cmc<=3" (Simic creatures 3 or less), "o:\\"draw a card\\" c:blue" (blue cards with draw), "otag:ramp ci:green" (green ramp cards), "t:legendary t:creature" (legendary creatures).',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Scryfall query string. Common filters: c: (color), ci: (color identity), t: (type), o: (oracle text), otag: (EDHREC tag), cmc: (mana value), pow: (power), tou: (toughness)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default 20, max 175)',
            },
            page: {
              type: 'number',
              description: 'Page number for paginated results (default 1)',
            },
            order: {
              type: 'string',
              description: 'Sort order: name, released (by date), edhrec (by popularity), cmc, color, rarity, power, toughness (default: name)',
            },
            include_text: {
              type: 'boolean',
              description: 'Include oracle text in results (default false)',
            },
            format: {
              type: 'string',
              description: 'Filter to cards legal in format: commander (default), modern, legacy, standard, pioneer, pauper, vintage, etc. Use "all" for no filter.',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Helper to map format string to Archidekt format ID
function getFormatId(format) {
  const formats = {
    standard: 1,
    modern: 2,
    commander: 3,
    legacy: 4,
    vintage: 5,
    pauper: 6,
    pioneer: 7,
    brawl: 8,
    historic: 9,
    oathbreaker: 10,
  };
  return formats[format?.toLowerCase()] || formats.commander;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // create_deck
  if (name === 'create_deck') {
    try {
      const { accessToken, rootFolder } = await archidekt.getAuth();
      server.sendLoggingMessage({ level: 'info', data: `Creating deck: ${args.name}` });

      const deck = await archidekt.createDeck(accessToken, {
        name: args.name,
        parentFolder: rootFolder,
        deckFormat: getFormatId(args.format),
        description: args.description || '',
        private: args.private !== false,
      });

      return {
        content: [{
          type: 'text',
          text: `Created deck "${deck.name}" (ID: ${deck.id})\nURL: https://archidekt.com/decks/${deck.id}`,
        }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `Create deck error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to create deck: ${error.message}` }],
        isError: true,
      };
    }
  }

  // list_decks
  if (name === 'list_decks') {
    try {
      const { accessToken } = await archidekt.getAuth();
      server.sendLoggingMessage({ level: 'info', data: 'Fetching deck list...' });

      const decks = await archidekt.listDecks(accessToken);

      if (!decks || decks.length === 0) {
        return {
          content: [{ type: 'text', text: 'No decks found.' }],
        };
      }

      const formatNames = { 1: 'Standard', 2: 'Modern', 3: 'Commander', 4: 'Legacy', 5: 'Vintage', 6: 'Pauper', 7: 'Pioneer', 8: 'Brawl', 9: 'Historic', 10: 'Oathbreaker' };
      const deckList = decks.map(d => {
        const format = formatNames[d.deckFormat] || 'Unknown';
        const privacy = d.private ? '(private)' : '(public)';
        return `- ${d.name} (ID: ${d.id}) - ${format} ${privacy}`;
      }).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${decks.length} deck(s):\n\n${deckList}`,
        }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `List decks error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to list decks: ${error.message}` }],
        isError: true,
      };
    }
  }

  // read_deck
  if (name === 'read_deck') {
    try {
      const { accessToken } = await archidekt.getAuth();
      server.sendLoggingMessage({ level: 'info', data: `Reading deck ${args.deck_id}...` });

      const deck = await archidekt.getDeck(accessToken, args.deck_id);
      const cards = deck.cards || [];

      if (cards.length === 0) {
        return {
          content: [{ type: 'text', text: `Deck "${deck.name}" is empty.` }],
        };
      }

      // Group cards by category
      const byCategory = {};
      for (const c of cards) {
        const category = c.categories?.[0] || 'Uncategorized';
        if (!byCategory[category]) byCategory[category] = [];
        byCategory[category].push(c);
      }

      // Calculate total card count
      const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);

      // Format output
      let output = `# ${deck.name} (${totalCards} cards)\n\n`;
      for (const [category, categoryCards] of Object.entries(byCategory)) {
        const categoryCount = categoryCards.reduce((sum, c) => sum + c.quantity, 0);
        output += `# ${category} (${categoryCount})\n`;
        for (const c of categoryCards) {
          const cardName = c.card.oracleCard.name;
          const qty = c.quantity;
          output += `${qty}x ${cardName}\n`;
        }
        output += '\n';
      }

      return {
        content: [{ type: 'text', text: output.trim() }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `Read deck error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to read deck: ${error.message}` }],
        isError: true,
      };
    }
  }

  // update_deck
  if (name === 'update_deck') {
    const { deck_id, cards_to_add, cards_to_remove } = args;

    if (!cards_to_add && !cards_to_remove) {
      return {
        content: [{ type: 'text', text: 'Please provide cards_to_add and/or cards_to_remove.' }],
        isError: true,
      };
    }

    try {
      const { accessToken } = await archidekt.getAuth();
      server.sendLoggingMessage({ level: 'info', data: `Fetching deck ${deck_id}...` });

      // Get current deck state
      const deck = await archidekt.getDeck(accessToken, deck_id);

      // Build current deck list string from deck cards
      const currentCards = deck.cards || [];
      const currentDeckList = currentCards.map(c => {
        const card = c.card;
        const qty = c.quantity;
        const edition = card.edition?.editioncode || '';
        const categories = c.categories?.length ? ` [${c.categories.join(', ')}]` : '';
        return `${qty}x ${card.oracleCard.name} (${edition})${categories}`;
      }).join('\n');

      // Build edit string: add the new cards
      let editList = cards_to_add || '';

      server.sendLoggingMessage({ level: 'info', data: 'Computing diff...' });

      // Use diff to figure out what cards to add
      const diffResult = await archidekt.computeDiff(
        accessToken,
        currentDeckList,
        editList
      );

      // Build the card actions array
      const cardActions = [];

      // Process cards to add from diff result
      if (diffResult.toAdd && diffResult.toAdd.length > 0) {
        for (const item of diffResult.toAdd) {
          cardActions.push(archidekt.createAddCardAction({
            cardId: String(item.card.id),
            quantity: item.quantity,
            categories: item.categories || [],
            modifier: item.modifier || 'Normal',
          }));
        }
      }

      // Process cards to remove - we need to find them in the current deck
      if (cards_to_remove) {
        const removeLines = cards_to_remove.split('\n').filter(l => l.trim());

        for (const line of removeLines) {
          // Parse line like "2 Sol Ring" or "1x Lightning Bolt"
          const match = line.match(/^(\d+)x?\s+(.+?)(?:\s+\([\w]+\))?(?:\s+\[.+\])?$/i);
          if (!match) continue;

          const qty = parseInt(match[1], 10);
          const cardName = match[2].trim();

          // Find this card in the current deck
          const deckCard = currentCards.find(c =>
            c.card.oracleCard.name.toLowerCase() === cardName.toLowerCase()
          );

          if (deckCard) {
            cardActions.push(archidekt.createRemoveCardAction({
              cardId: String(deckCard.card.id),
              deckRelationId: String(deckCard.id),
              quantity: qty,
              categories: deckCard.categories || [],
              modifier: deckCard.modifier || 'Normal',
            }));
          } else {
            server.sendLoggingMessage({ level: 'warning', data: `Card not found in deck: ${cardName}` });
          }
        }
      }

      if (cardActions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No valid card changes to make.' }],
        };
      }

      server.sendLoggingMessage({ level: 'info', data: `Applying ${cardActions.length} card changes...` });

      // Apply the changes
      const result = await archidekt.modifyCards(accessToken, deck_id, cardActions);

      // Fetch updated deck for card count
      const updatedDeck = await archidekt.getDeck(accessToken, deck_id);
      const totalCards = (updatedDeck.cards || []).reduce((sum, c) => sum + c.quantity, 0);

      // Build summary
      const added = result.add?.length || 0;
      const removed = cardActions.filter(a => a.action === 'remove').length;

      let summary = `Updated deck ${deck_id}:\n`;
      if (added > 0) summary += `- Added ${added} card(s)\n`;
      if (removed > 0) summary += `- Removed ${removed} card(s)\n`;
      summary += `- Total: ${totalCards} cards`;

      if (diffResult.cardErrors?.length > 0) {
        summary += `\n\nWarnings:\n${diffResult.cardErrors.map(e => `- ${e}`).join('\n')}`;
      }

      return {
        content: [{ type: 'text', text: summary }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `Update deck error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to update deck: ${error.message}` }],
        isError: true,
      };
    }
  }

  // lookup_cards
  if (name === 'lookup_cards') {
    const cardNamesInput = args.card_names;

    if (!cardNamesInput || !cardNamesInput.trim()) {
      return {
        content: [{ type: 'text', text: 'Please provide at least one card name.' }],
        isError: true,
      };
    }

    // Parse newline-separated list
    const cardNames = cardNamesInput.split('\n').map(l => l.trim()).filter(l => l);

    if (cardNames.length === 0) {
      return {
        content: [{ type: 'text', text: 'Please provide at least one card name.' }],
        isError: true,
      };
    }

    try {
      server.sendLoggingMessage({ level: 'info', data: `Looking up ${cardNames.length} card(s)...` });

      const { found, notFound } = await scryfall.lookupCollection(cardNames);

      if (found.length === 0) {
        return {
          content: [{ type: 'text', text: `No cards found for: ${cardNames.join(', ')}` }],
        };
      }

      // Format each card concisely
      let output = '';
      for (const card of found) {
        output += `## ${card.name}\n`;
        output += `${card.mana_cost || 'No mana cost'} · ${card.type_line}\n`;
        if (card.oracle_text) {
          output += `${card.oracle_text}\n`;
        }
        if (card.power && card.toughness) {
          output += `**${card.power}/${card.toughness}**\n`;
        }
        if (card.loyalty) {
          output += `Loyalty: ${card.loyalty}\n`;
        }
        output += '\n';
      }

      if (notFound.length > 0) {
        output += `---\nNot found: ${notFound.join(', ')}\n`;
      }

      return {
        content: [{ type: 'text', text: output.trim() }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `Lookup cards error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to look up cards: ${error.message}` }],
        isError: true,
      };
    }
  }

  // search_cards
  if (name === 'search_cards') {
    const { query, limit = 20, page = 1, order = 'name', include_text = false, format = 'commander' } = args;

    if (!query || !query.trim()) {
      return {
        content: [{ type: 'text', text: 'Please provide a search query.' }],
        isError: true,
      };
    }

    // Build full query with format filter
    let fullQuery = query.trim();
    if (format && format.toLowerCase() !== 'all') {
      fullQuery += ` format:${format}`;
    }

    const maxResults = Math.min(limit, 175);
    const offset = (page - 1) * maxResults;

    try {
      server.sendLoggingMessage({ level: 'info', data: `Searching: ${fullQuery} (page ${page}, offset ${offset}, order: ${order})` });

      const result = await scryfall.searchPaginated(fullQuery, { offset, limit: maxResults, order });

      if (!result.cards || result.cards.length === 0) {
        if (offset > 0) {
          return {
            content: [{ type: 'text', text: `No more results. Total: ${result.totalCards}` }],
          };
        }
        return {
          content: [{ type: 'text', text: `No cards found for query: ${fullQuery}` }],
        };
      }

      const cards = result.cards;
      const totalFound = result.totalCards;
      const startNum = offset + 1;
      const endNum = offset + cards.length;

      // Format results
      let output = `Found ${totalFound} card(s). Showing ${startNum}-${endNum}:\n\n`;

      for (const card of cards) {
        output += `**${card.name}** · ${card.mana_cost || 'No cost'} · ${card.type_line}\n`;
        if (include_text && card.oracle_text) {
          output += `${card.oracle_text}\n`;
        }
        if (include_text) {
          output += '\n';
        }
      }

      if (result.hasMore) {
        output += `\n---\nMore results available. Use page=${page + 1} to see next page.`;
      }

      return {
        content: [{ type: 'text', text: output.trim() }],
      };
    } catch (error) {
      server.sendLoggingMessage({ level: 'error', data: `Search cards error: ${error.message}` });
      return {
        content: [{ type: 'text', text: `Failed to search cards: ${error.message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Command Tower MCP Server running');
}

main().catch(console.error);
