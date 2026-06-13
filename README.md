# outline-doc

`outline-doc` is an npm-installable CLI for the [Outline](https://www.getoutline.com/developers) API.

It stores your Outline API token locally so document and collection commands can be run without passing credentials every time.

## Install

From npm:

```sh
npm install -g outline-doc
```

From GitHub:

```sh
npm install -g https://github.com/simplebytes-com/outline-doc-cli/archive/refs/heads/main.tar.gz
```

From a local clone:

```sh
git clone https://github.com/simplebytes-com/outline-doc-cli.git
cd outline-doc-cli
npm install
npm link
```

For development without linking:

```sh
npm install
npm run build
node dist/cli.js --help
```

## Login

Create an API key in Outline, then run:

```sh
outline-doc login
```

The login command asks for your Outline URL and API token. For scripts, pass them explicitly:

```sh
outline-doc login --base-url https://outline.example.com
```

The token is saved to:

```text
~/.config/outline-doc/config.json
```

You can override configuration with:

```sh
OUTLINE_TOKEN=... outline-doc documents list
OUTLINE_BASE_URL=https://outline.example.com/api outline-doc whoami
OUTLINE_CONFIG=/path/to/config.json outline-doc config
```

To change the saved base URL later:

```sh
outline-doc config set-base-url https://outline.example.com
```

## Commands

```sh
outline-doc whoami
outline-doc config show
outline-doc config set-base-url https://outline.example.com

outline-doc collections list
outline-doc collections create --name "Engineering" --description "Team docs"

outline-doc documents list --collection-id COLLECTION_ID
outline-doc documents get DOCUMENT_ID
outline-doc documents create --title "Runbook" --file runbook.md --collection-id COLLECTION_ID --publish
outline-doc documents update DOCUMENT_ID --file updated.md --replace
outline-doc documents update DOCUMENT_ID --text "New section" --append
outline-doc documents search "incident response"
outline-doc documents export DOCUMENT_ID --output document.md
outline-doc documents delete DOCUMENT_ID
```

Anything not covered by a convenience command can be called directly:

```sh
outline-doc api /documents.list --data '{"limit":5}'
outline-doc api /users.list --data '{"limit":10}'
```

All Outline API endpoints are POST endpoints and use bearer authentication.

## Release

Publish a new version:

```sh
npm login
npm version patch
npm publish --access public
```
