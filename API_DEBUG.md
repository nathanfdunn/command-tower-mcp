# API Debug Commands

Curl commands for debugging the APIs used by Command Tower MCP.

**Important:** Archidekt API requires a trailing slash on all endpoints!

## Archidekt API

Base URL: `https://archidekt.com/api`

### Login

```bash
curl -X POST "https://archidekt.com/api/rest-auth/login/" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"username": "YOUR_USERNAME", "password": "YOUR_PASSWORD"}'
```

Response includes `access_token` (JWT) and `user.rootFolder`.

### List Decks

```bash
curl "https://archidekt.com/api/decks/curated/self/" \
  -H "Accept: application/json" \
  -H "Authorization: JWT YOUR_ACCESS_TOKEN"
```

### Get Deck

```bash
# Authenticated (private decks)
curl "https://archidekt.com/api/decks/DECK_ID/" \
  -H "Accept: application/json" \
  -H "Authorization: JWT YOUR_ACCESS_TOKEN"

# Public decks (no auth needed)
curl "https://archidekt.com/api/decks/DECK_ID/"
```

### Create Deck

```bash
curl -X POST "https://archidekt.com/api/decks/v2/" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: JWT YOUR_ACCESS_TOKEN" \
  -d '{
    "name": "My New Deck",
    "deckFormat": 3,
    "description": "",
    "private": true,
    "unlisted": false,
    "theorycrafted": false,
    "parent_folder": YOUR_ROOT_FOLDER_ID,
    "extras": {
      "decksToInclude": [],
      "commandersToAdd": [],
      "forceCardsToSingleton": false,
      "ignoreCardsOutOfCommanderIdentity": true
    }
  }'
```

Deck formats: 1=Standard, 2=Modern, 3=Commander, 4=Legacy, 5=Vintage, 6=Pauper, 7=Pioneer, 8=Brawl, 9=Historic, 10=Oathbreaker

### Compute Card Diff

```bash
curl -X POST "https://archidekt.com/api/cards/massDeckEdit/" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: JWT YOUR_ACCESS_TOKEN" \
  -d '{
    "parser": "archidekt",
    "current": "1x Sol Ring (CMM)\n1x Command Tower (CMM)",
    "edit": "# Commander\n1 Atraxa, Praetors Voice\n# Ramp\n1 Sol Ring"
  }'
```

### Modify Cards in Deck

```bash
curl -X PATCH "https://archidekt.com/api/decks/DECK_ID/modifyCards/v2/" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: JWT YOUR_ACCESS_TOKEN" \
  -d '{
    "cards": [
      {
        "action": "add",
        "cardid": "12345",
        "customCardId": null,
        "categories": ["Commander"],
        "patchId": "randomstr1",
        "modifications": {
          "quantity": 1,
          "modifier": "Normal",
          "customCmc": null,
          "companion": false,
          "flippedDefault": false,
          "label": ",#656565"
        }
      }
    ]
  }'
```

Actions: `add`, `remove`, `modify`

---

## Scryfall API

Base URL: `https://api.scryfall.com`

Scryfall asks for 50-100ms delay between requests.

### Search Cards

```bash
curl "https://api.scryfall.com/cards/search?q=c%3Ablue+t%3Ainstant+cmc%3C3&order=name"
```

Common query parameters:
- `q` - Search query (URL encoded)
- `order` - Sort: name, set, released, rarity, color, cmc, power, toughness, edhrec
- `page` - Page number (175 cards per page)

### Lookup Cards by Name (Collection)

```bash
curl -X POST "https://api.scryfall.com/cards/collection" \
  -H "Content-Type: application/json" \
  -d '{
    "identifiers": [
      {"name": "Sol Ring"},
      {"name": "Command Tower"},
      {"name": "Lightning Bolt"}
    ]
  }'
```

Max 75 identifiers per request.

### Get Card by Name (Fuzzy)

```bash
curl "https://api.scryfall.com/cards/named?fuzzy=sol+ring"
```

### Get Card by Name (Exact)

```bash
curl "https://api.scryfall.com/cards/named?exact=Sol+Ring"
```

---

## Tips

**Pretty print JSON:**
```bash
curl ... | jq .
```

**Save response to file:**
```bash
curl ... > response.json
```

**Show headers:**
```bash
curl -i ...
```
