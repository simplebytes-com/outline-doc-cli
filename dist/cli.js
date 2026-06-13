#!/usr/bin/env node
import { password } from "@inquirer/prompts";
import { Command, InvalidArgumentError } from "commander";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
const DEFAULT_BASE_URL = "https://app.getoutline.com/api";
const APP_NAME = "outline-doc";
class ApiError extends Error {
    status;
    statusText;
    body;
    constructor(status, statusText, body) {
        super(`${status} ${statusText}${body.trim() ? `: ${body.trim()}` : ""}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
    }
}
const program = new Command();
program
    .name("outline-doc")
    .description("Command line client for the Outline API")
    .version("0.1.0");
program
    .command("login")
    .description("Persist an Outline API token for future commands")
    .option("--base-url <url>", "Outline API base URL", process.env.OUTLINE_BASE_URL ?? DEFAULT_BASE_URL)
    .option("--token <token>", "Outline API token. If omitted, you will be prompted.")
    .option("--no-validate", "Save credentials without calling /auth.info")
    .action(async (options) => {
    const token = (options.token ?? process.env.OUTLINE_TOKEN ?? await password({ message: "Outline API token" })).trim();
    if (!token) {
        throw new Error("Token is required");
    }
    const config = { baseUrl: normalizeBaseUrl(options.baseUrl), token };
    if (options.validate) {
        await post(config, "/auth.info", {});
    }
    await saveConfig(config);
    console.log(`Logged in to ${config.baseUrl}`);
});
program
    .command("logout")
    .description("Remove the persisted login")
    .action(async () => {
    await rm(configPath(), { force: true });
    console.log("Logged out");
});
program
    .command("whoami")
    .description("Show the authenticated Outline user and workspace")
    .action(async () => {
    const client = await loadClientConfig();
    printJson(await post(client, "/auth.info", {}));
});
program
    .command("config [action] [url]")
    .description("Show or update local configuration")
    .option("--no-validate", "Save base URL without calling /auth.info")
    .action(async (action = "show", url, options) => {
    if (action === "show") {
        if (url)
            throw new Error("Usage: outline-doc config show");
        const stored = await loadConfig();
        const baseUrl = normalizeBaseUrl(process.env.OUTLINE_BASE_URL ?? stored.baseUrl ?? DEFAULT_BASE_URL);
        const token = process.env.OUTLINE_TOKEN ?? stored.token ?? "";
        printJson({ baseUrl, token: token ? redact(token) : "", configPath: configPath() });
        return;
    }
    if (action !== "set-base-url") {
        throw new Error("Usage: outline-doc config [show|set-base-url] [url]");
    }
    if (!url) {
        throw new Error("Usage: outline-doc config set-base-url <url>");
    }
    const stored = await loadConfig();
    const config = {
        baseUrl: normalizeBaseUrl(url),
        token: stored.token ?? "",
    };
    if (options.validate && config.token) {
        await post(config, "/auth.info", {});
    }
    await saveConfig(config);
    console.log(`Base URL set to ${config.baseUrl}`);
    if (options.validate && !config.token) {
        console.log("No token is saved yet; run `outline-doc login` to authenticate.");
    }
});
const collections = program.command("collections").description("Manage Outline collections");
collections
    .command("list")
    .description("List collections")
    .option("--query <text>", "Filter collections by name")
    .option("--limit <n>", "Result limit", parseInteger, 25)
    .option("--offset <n>", "Result offset", parseInteger, 0)
    .option("--json", "Print the full JSON response")
    .action(async (options) => {
    const body = compact({
        query: options.query,
        limit: options.limit,
        offset: options.offset,
    });
    const response = await call("/collections.list", body);
    if (options.json)
        return printJson(response);
    printTable(["ID", "NAME"], response.data.map((item) => [
        String(item.id ?? ""),
        String(item.name ?? ""),
    ]));
});
collections
    .command("create")
    .description("Create a collection")
    .requiredOption("--name <name>", "Collection name")
    .option("--description <markdown>", "Markdown description")
    .option("--permission <permission>", "Default permission, for example read or read_write")
    .option("--json", "Print the full JSON response")
    .action(async (options) => {
    const response = await call("/collections.create", compact({
        name: options.name,
        description: options.description,
        permission: options.permission,
    }));
    if (options.json)
        return printJson(response);
    printResource("collection", response);
});
const documents = program.command("documents").alias("docs").description("Manage Outline documents");
documents
    .command("list")
    .description("List documents")
    .option("--collection-id <id>", "Filter to a collection")
    .option("--parent-document-id <id>", "Filter to a parent document")
    .option("--status <statuses>", "Comma-separated statuses: draft,published,archived", splitCsv)
    .option("--limit <n>", "Result limit", parseInteger, 25)
    .option("--offset <n>", "Result offset", parseInteger, 0)
    .option("--json", "Print the full JSON response")
    .action(async (options) => {
    const response = await call("/documents.list", compact({
        collectionId: options.collectionId,
        parentDocumentId: options.parentDocumentId,
        statusFilter: options.status,
        limit: options.limit,
        offset: options.offset,
    }));
    if (options.json)
        return printJson(response);
    printDocumentRows(response.data);
});
documents
    .command("get")
    .description("Print a document as Markdown")
    .argument("<id>", "Document UUID or urlId")
    .option("--json", "Print the full JSON response")
    .action(async (id, options) => {
    const response = await call("/documents.info", { id });
    if (options.json)
        return printJson(response);
    const document = response.data;
    console.log(`# ${document.title ?? ""}\n`);
    process.stdout.write(String(document.text ?? ""));
    if (!String(document.text ?? "").endsWith("\n"))
        console.log();
});
documents
    .command("create")
    .description("Create a document")
    .requiredOption("--title <title>", "Document title")
    .option("--text <markdown>", "Markdown content")
    .option("--file <path>", "Read Markdown content from a file")
    .option("--collection-id <id>", "Collection UUID. Required to publish unless using parent document.")
    .option("--parent-document-id <id>", "Parent document UUID")
    .option("--publish", "Publish immediately", false)
    .option("--icon <icon>", "Emoji or icon")
    .option("--json", "Print the full JSON response")
    .action(async (options) => {
    const response = await call("/documents.create", compact({
        title: options.title,
        text: await readTextOption(options.text, options.file),
        collectionId: options.collectionId,
        parentDocumentId: options.parentDocumentId,
        publish: options.publish,
        icon: options.icon,
    }));
    if (options.json)
        return printJson(response);
    printResource("document", response);
});
documents
    .command("update")
    .description("Update a document")
    .argument("<id>", "Document UUID or urlId")
    .option("--title <title>", "New title")
    .option("--text <markdown>", "Markdown content")
    .option("--file <path>", "Read Markdown content from a file")
    .option("--append", "Append text to the existing document")
    .option("--prepend", "Prepend text to the existing document")
    .option("--replace", "Replace the document text", false)
    .option("--publish", "Publish the document if it is a draft")
    .option("--json", "Print the full JSON response")
    .action(async (id, options) => {
    let editMode;
    if (options.append)
        editMode = "append";
    if (options.prepend)
        editMode = "prepend";
    if (options.replace)
        editMode = "replace";
    const hasText = Boolean(options.text || options.file);
    const response = await call("/documents.update", compact({
        id,
        title: options.title,
        text: hasText ? await readTextOption(options.text, options.file) : undefined,
        editMode: hasText ? editMode ?? "replace" : undefined,
        publish: options.publish ? true : undefined,
    }));
    if (options.json)
        return printJson(response);
    printResource("document", response);
});
documents
    .command("delete")
    .description("Delete a document")
    .argument("<id>", "Document UUID or urlId")
    .option("--permanent", "Destroy permanently instead of moving to trash", false)
    .action(async (id, options) => {
    printJson(await call("/documents.delete", { id, permanent: Boolean(options.permanent) }));
});
documents
    .command("export")
    .description("Export a document as Markdown")
    .argument("<id>", "Document UUID or urlId")
    .option("--output <path>", "Write Markdown to a file instead of stdout")
    .action(async (id, options) => {
    const response = await call("/documents.export", { id });
    const text = String(response.data ?? "");
    if (options.output) {
        await writeFile(options.output, text, "utf8");
        console.log(`Wrote ${options.output}`);
        return;
    }
    process.stdout.write(text);
});
documents
    .command("search")
    .description("Search documents")
    .argument("<query>", "Search query")
    .option("--collection-id <id>", "Filter to a collection")
    .option("--limit <n>", "Result limit", parseInteger, 10)
    .option("--json", "Print the full JSON response")
    .action(async (query, options) => {
    const response = await call("/documents.search", compact({
        query,
        collectionId: options.collectionId,
        limit: options.limit,
    }));
    if (options.json)
        return printJson(response);
    printTable(["ID", "URL_ID", "TITLE", "CONTEXT"], response.data.map((result) => {
        const document = (result.document ?? {});
        return [
            String(document.id ?? ""),
            String(document.urlId ?? ""),
            String(document.title ?? ""),
            String(result.context ?? "").replace(/\s+/g, " ").trim(),
        ];
    }));
});
program
    .command("api")
    .description("Call any Outline API endpoint with a JSON body")
    .argument("<endpoint>", "Endpoint such as /documents.list")
    .option("--data <json>", "JSON request body")
    .option("--file <path>", "Read JSON request body from a file")
    .action(async (endpoint, options) => {
    printJson(await call(endpoint, await readJsonOption(options.data, options.file)));
});
program.parseAsync(process.argv).catch((error) => {
    if (error instanceof ApiError) {
        console.error(`error: Outline API returned ${error.message}`);
    }
    else if (error instanceof Error) {
        console.error(`error: ${error.message}`);
    }
    else {
        console.error("error:", error);
    }
    process.exit(1);
});
async function call(endpoint, body) {
    return post(await loadClientConfig(), endpoint, body);
}
async function post(config, endpoint, body) {
    const url = joinUrl(config.baseUrl, endpoint);
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "authorization": `Bearer ${config.token}`,
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": `${APP_NAME}/0.1.0`,
        },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new ApiError(response.status, response.statusText, text);
    }
    if (!text.trim())
        return {};
    return JSON.parse(text);
}
async function loadClientConfig() {
    const stored = await loadConfig();
    const baseUrl = normalizeBaseUrl(process.env.OUTLINE_BASE_URL ?? stored.baseUrl ?? DEFAULT_BASE_URL);
    const token = process.env.OUTLINE_TOKEN ?? stored.token;
    if (!token) {
        throw new Error("Not logged in. Run `outline-doc login` or set OUTLINE_TOKEN.");
    }
    return { baseUrl, token };
}
async function loadConfig() {
    try {
        return JSON.parse(await readFile(configPath(), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return {};
        throw error;
    }
}
async function saveConfig(config) {
    const file = configPath();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
function configPath() {
    if (process.env.OUTLINE_CONFIG)
        return process.env.OUTLINE_CONFIG;
    const xdg = process.env.XDG_CONFIG_HOME;
    const base = xdg && xdg.trim() ? xdg : path.join(homedir(), ".config");
    return path.join(base, APP_NAME, "config.json");
}
function normalizeBaseUrl(input) {
    const trimmed = input.trim().replace(/\/+$/, "");
    if (!trimmed)
        return DEFAULT_BASE_URL;
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}
function joinUrl(baseUrl, endpoint) {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return `${baseUrl.replace(/\/+$/, "")}/${cleanEndpoint}`;
}
async function readTextOption(text, file) {
    if (text && file)
        throw new Error("Use either --text or --file, not both.");
    if (!file)
        return text ?? "";
    return readFile(file, "utf8");
}
async function readJsonOption(data, file) {
    if (data && file)
        throw new Error("Use either --data or --file, not both.");
    if (!data && !file)
        return {};
    const raw = file ? await readFile(file, "utf8") : data ?? "{}";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON body must be an object.");
    }
    return parsed;
}
function compact(input) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}
function splitCsv(value) {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
}
function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new InvalidArgumentError("Must be a non-negative integer.");
    }
    return parsed;
}
function printJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
function printResource(label, response) {
    const data = (response.data ?? {});
    console.log(`${label}: ${data.title ?? data.name ?? ""}`);
    console.log(`id: ${data.id ?? ""}`);
    if (data.url)
        console.log(`url: ${data.url}`);
}
function printDocumentRows(items) {
    printTable(["ID", "URL_ID", "TITLE"], items.map((item) => [
        String(item.id ?? ""),
        String(item.urlId ?? ""),
        String(item.title ?? ""),
    ]));
}
function printTable(headers, rows) {
    const widths = headers.map((header, index) => {
        return Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
    });
    const format = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
    console.log(format(headers));
    for (const row of rows)
        console.log(format(row));
}
function redact(token) {
    if (token.length <= 8)
        return "********";
    return `${token.slice(0, 4)}${"*".repeat(token.length - 8)}${token.slice(-4)}`;
}
//# sourceMappingURL=cli.js.map