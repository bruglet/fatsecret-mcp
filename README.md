# FatSecret MCP Server <img src="https://cdn.prod.website-files.com/6854cb4b7a1b8e39612d89cf/685543fddca41e9e9ce5ae5f_fatsecret_logo-op.png" alt="FatSecret Logo" height="28" />

> [!IMPORTANT]
> This is **not an official MCP server** by FatSecret.
> It uses the [FatSecret Platform API](https://platform.fatsecret.com/) which requires a free developer account.

An MCP (Model Context Protocol) server that connects Claude/Cursor to the [FatSecret Platform API](https://platform.fatsecret.com/). Search foods, track your diet, manage recipes, and monitor weight directly from your AI assistant.

**Available on NPM**: `npx fatsecret-mcp` | **Claude Desktop Extension**: [fatsecret-mcp.mcpb](https://github.com/fliptheweb/fatsecret-mcp/releases/latest/download/fatsecret-mcp.mcpb)

## ✨ Features

- 🔐 **Authentication** — Interactive credential setup and OAuth authorization
- 🔍 **Food Search** — Search FatSecret's extensive food database with detailed nutrition data
- 📷 **Barcode Lookup** — Find foods by GTIN-13 barcode
- 🍳 **Recipe Search** — Browse and filter recipes by calories, macros, and prep time
- 📝 **Food Diary** — Add, edit, copy, and delete food diary entries
- 🍽️ **Saved Meals** — Create and manage reusable meal templates
- ⚖️ **Weight Tracking** — Record and view weight history
- 🏃‍♂️ **Exercise Tracking** — View exercises and manage activity entries
- ⭐ **Favorites** — Manage favorite foods and recipes

## 🚀 Quick Start

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "fatsecret": {
      "command": "npx",
      "args": ["-y", "fatsecret-mcp"]
    }
  }
}
```

That's it! On first use, the AI will guide you through setup:

1. **`check_auth_status`** — detects missing credentials and tells you what to do
2. **`setup_credentials`** — you provide your API keys (saved to `~/.fatsecret-mcp/config.json`)
3. **`start_auth`** → **`complete_auth`** — authorize your FatSecret account for diary/weight tools

Alternatively, you can pass credentials as environment variables:

```json
{
  "mcpServers": {
    "fatsecret": {
      "command": "npx",
      "args": ["-y", "fatsecret-mcp"],
      "env": {
        "FATSECRET_CLIENT_ID": "your_client_id",
        "FATSECRET_CLIENT_SECRET": "your_client_secret",
        "FATSECRET_CONSUMER_SECRET": "your_consumer_secret"
      }
    }
  }
}
```

### 🔑 Where to Get Credentials

1. Create a free account at [platform.fatsecret.com](https://platform.fatsecret.com/)
2. Navigate to **My Account → API Keys**
3. You'll see three values:
   - **Client ID** (used for both OAuth 2.0 and OAuth 1.0)
   - **Client Secret** (OAuth 2.0 - for public food/recipe search)
   - **Consumer Secret** (OAuth 1.0 - for user profile/diary access)

📖 Step-by-step guide: [Getting Started with FatSecret API](https://github.com/fatsecret-group/postman-fatsecret-apis)

### Claude Desktop (Extension)

Download and open [fatsecret-mcp.mcpb](https://github.com/fliptheweb/fatsecret-mcp/releases/latest/download/fatsecret-mcp.mcpb) with Claude Desktop. You'll be prompted to enter your FatSecret credentials — secrets are stored securely in the OS keychain.

See [Building Desktop Extensions with MCPB](https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb) for more details.

### Claude Desktop (Manual)

`~/Library/Application Support/Claude/claude_desktop_config.json`

### Claude Code (CLI)

```bash
claude mcp add fatsecret -- npx -y fatsecret-mcp
```

Or with env vars:

```bash
claude mcp add fatsecret \
  -e FATSECRET_CLIENT_ID=your_client_id \
  -e FATSECRET_CLIENT_SECRET=your_client_secret \
  -e FATSECRET_CONSUMER_SECRET=your_consumer_secret \
  -- npx -y fatsecret-mcp
```

Verify with `claude mcp list`.

### Cursor

- **Settings UI** — `Settings → MCP → + Add new MCP server`, then fill in the command, args, and env
- **Project config** — add JSON to `.cursor/mcp.json` in your project root
- **Global config** — add JSON to `~/.cursor/mcp.json`

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| **🔐 Setup & Auth** | |
| `check_auth_status` | Check if credentials and profile auth are configured. **Call this first.** |
| `setup_credentials` | Save FatSecret API credentials to persistent config |
| `start_auth` | Start OAuth 1.0 authorization — returns URL for user to visit |
| `complete_auth` | Complete OAuth with verifier PIN from authorization page |
| | |
| **🔍 Food Search** *(public)* | |
| `search_foods` | Search the food database |
| `get_food` | Get detailed nutrition info for a food |
| `find_food_by_barcode` | Find food by GTIN-13 barcode |
| `autocomplete_foods` | Get search autocomplete suggestions |
| | |
| **🍳 Recipes** *(public)* | |
| `search_recipes` | Search recipes with filters |
| `get_recipe` | Get recipe details with ingredients and directions |
| | |
| **📚 Reference** *(public)* | |
| `get_food_categories` | Get food categories |
| `get_food_sub_categories` | Get food sub categories |
| `get_brands` | Get food brands |
| `get_recipe_types` | Get recipe types |
| | |
| **📝 Food Diary** *(profile auth)* | |
| `get_food_entries` | Get food diary entries for a date |
| `get_food_entries_month` | Get monthly nutrition summary (calories & macros per day) |
| `create_food_entry` | Add a food diary entry |
| `edit_food_entry` | Edit a food diary entry |
| `delete_food_entry` | Delete a food diary entry |
| `copy_food_entries` | Copy entries from one date to another |
| `copy_saved_meal_entries` | Copy a saved meal to a date |
| | |
| **⭐ Favorites** *(profile auth)* | |
| `get_favorite_foods` | Get favorite foods |
| `delete_favorite_food` | Remove food from favorites |
| `get_most_eaten_foods` | Get most eaten foods |
| `get_recently_eaten_foods` | Get recently eaten foods |
| `get_favorite_recipes` | Get favorite recipes |
| `add_favorite_recipe` | Add recipe to favorites |
| `delete_favorite_recipe` | Remove recipe from favorites |
| | |
| **🍽️ Saved Meals** *(profile auth)* | |
| `get_saved_meals` | Get saved meals |
| `create_saved_meal` | Create a saved meal |
| `edit_saved_meal` | Edit a saved meal |
| `delete_saved_meal` | Delete a saved meal |
| `get_saved_meal_items` | Get items in a saved meal |
| `add_saved_meal_item` | Add food to a saved meal |
| `edit_saved_meal_item` | Edit saved meal item |
| `delete_saved_meal_item` | Remove item from saved meal |
| | |
| **⚖️ Weight** *(profile auth)* | |
| `update_weight` | Record weight for a date |
| `get_weight_month` | Get weight history for a month |
| | |
| **🏃‍♂️ Exercise** *(profile auth)* | |
| `get_exercises` | Get exercise types |
| `edit_exercise_entries` | Shift exercise time between activities |
| `get_exercise_entries_month` | Get exercise data for a month |
| `save_exercise_template` | Save exercise template for weekdays |
| | |
| **👤 Profile** *(profile auth)* | |
| `get_profile` | Get user profile info |
| `create_food` | Create a custom food (Premier) |

<sub>API reference: [FatSecret Postman Collection](https://www.postman.com/fatsecret/fatsecret-public-apis/)</sub>

## 🧪 Test Connection

```bash
npx fatsecret-mcp
```

Or with env vars:

```bash
FATSECRET_CLIENT_ID='...' FATSECRET_CLIENT_SECRET='...' FATSECRET_CONSUMER_SECRET='...' npx fatsecret-mcp
```

## 📋 Requirements

- Node.js 18+
- FatSecret Platform API account ([platform.fatsecret.com](https://platform.fatsecret.com/))
- MCP-compatible client (Claude Desktop, Cursor, etc.)

## 🔧 Development

1. Clone the repository
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. `npm run dev` to run in development mode

Debugging with MCP Inspector:

```bash
FATSECRET_CLIENT_ID=X FATSECRET_CLIENT_SECRET=X FATSECRET_CONSUMER_SECRET=X npx -y @modelcontextprotocol/inspector npx <local-path>/fatsecret-mcp
## 🐳 Deployment with Podman Quadlet & Cloudflare Tunnel

Deploy the MCP server as a rootless container managed by systemd and exposed securely through a Cloudflare Tunnel with Cloudflare Access Managed OAuth.

### Architecture

```
[ AI Client / Claude / Cursor ]
               │
               ▼  (OAuth 2.0 / HTTPS)
[ Cloudflare Access & Managed OAuth ]
               │
               ▼  (Tunnel with Cf-Access-Jwt-Assertion)
[ cloudflared on Server ]
               │
               ▼  (HTTP reverse proxy to 127.0.0.1:3000)
[ Rootless Podman Quadlet (fatsecret-mcp) ]
  ├── GET  /health (Public health check)
  └── POST /mcp    (Streamable HTTP - JWT verified)
```

### 1. Prepare Environment and Storage

Create the configuration directory and storage mount:

```bash
mkdir -p ~/.config/containers/systemd
mkdir -p ~/.config/fatsecret-mcp/data
cp .env.example ~/.config/fatsecret-mcp/.env
```

Edit `~/.config/fatsecret-mcp/.env` with your credentials:
- `CF_ACCESS_TEAM_DOMAIN`: your Cloudflare Access team name or domain (e.g. `myteam.cloudflareaccess.com`)
- `CF_ACCESS_AUD`: your application audience tag from Cloudflare Zero Trust
- `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, `FATSECRET_CONSUMER_SECRET`: from [platform.fatsecret.com](https://platform.fatsecret.com/)

### 2. Install the Quadlet

Copy the Quadlet definition to the user systemd directory:

```bash
cp quadlet/fatsecret-mcp.container ~/.config/containers/systemd/
```

### 3. Start the Service

Reload the systemd user daemon and start the container:

```bash
systemctl --user daemon-reload
systemctl --user start fatsecret-mcp
```

Check status and logs:

```bash
systemctl --user status fatsecret-mcp
journalctl --user -u fatsecret-mcp -f
```

To enable starting automatically on user login / boot:

```bash
systemctl --user enable fatsecret-mcp
loginctl enable-linger $USER
```

### 4. Cloudflare Tunnel Configuration

Add an ingress rule in your `cloudflared` configuration (`config.yml`):

```yaml
ingress:
  - hostname: mcp.yourdomain.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

In the Cloudflare Zero Trust dashboard:
1. Navigate to **Access → Applications**.
2. Add an application protecting `mcp.yourdomain.com`.
3. Enable **Managed OAuth** to allow non-browser MCP clients to authenticate.
4. Copy the **Audience Tag (AUD)** into your `.env` file as `CF_ACCESS_AUD`.

### 5. Connect Your MCP Client

Configure your MCP client (such as Claude Desktop or Cursor) to connect via Streamable HTTP:

```json
{
  "mcpServers": {
    "fatsecret": {
      "url": "https://mcp.yourdomain.com/mcp"
    }
  }
}
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
