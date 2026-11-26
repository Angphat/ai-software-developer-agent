# AI Software Developer Agent

DevOps course project. An AI agent that uses tools through MCP, and runs on Docker.

## What it does

You type a request in a web page, for example "create a file" or "write a Python program and run it".
The agent asks an AI model what to do. The model picks a tool. The tool runs. The result comes back to the page.

## How it works

    Browser
       |  HTTP (streaming)
       v
    Web App (Node.js, port 3100)
       |  HTTP API  (/v1/chat/completions)
       v
    OpenClaw Gateway (port 18789)  <---- HTTPS API ---->  LLM on OpenRouter (Flint, free)
       |  MCP (stdio)
       v
    MCP server (4 tools)  --->  files in Docker volume "mcp-files"

| Part | What it is | Its job |
|---|---|---|
| Web App | Node.js, port 3100 | Chat page. Keeps the gateway token on the server. Streams the answer. |
| OpenClaw Gateway | port 18789 | Runs the agent. Calls the model. Calls the tools. |
| LLM | Flint (recursive/flint-v1.0:free) on OpenRouter | Decides which tool to use. It runs on the internet, not on this computer. |
| MCP server | mcp-tools/src/server.ts | Gives the agent 4 tools. |
| Docker | docker compose | Runs every part in its own container. A volume keeps the files. |

OpenClaw's own control page talks to the gateway over WebSocket on the same port.

## The 4 MCP tools

| Tool | What it does |
|---|---|
| create_file | Creates a text file (overwrites if it exists). |
| read_file | Reads a text file. |
| list_files | Lists the file names in a folder. |
| run_command | Runs a shell command. It stops after 15 seconds. |

All tools work only inside one folder: /home/node/mcp-tools/files (a Docker volume).
A path that tries to leave this folder is rejected.

## Run it

You need Docker Desktop, and OpenClaw set up once with an OpenRouter API key.

    1. Copy webapp/.env.example to webapp/.env and put your OpenClaw gateway token in it.
    2. cd openclaw
    3. docker compose up -d --build openclaw-gateway webapp
    4. Open http://localhost:3100

Check that it works:

    docker compose ps
    docker exec openclaw-openclaw-gateway-1 openclaw mcp doctor local-tools --probe

Change the model:

    docker exec openclaw-openclaw-gateway-1 openclaw models set openrouter/recursive/flint-v1.0:free

## Project files

    openclaw/    docker-compose.yml (original), docker-compose.override.yml (my changes), Dockerfile.gateway-mcp
    mcp-tools/   src/server.ts  (the MCP server)
    webapp/      server.js, index.html, Dockerfile

## Choosing the model

I started with Hermes 4 70B. On 24 Oct 2026 OpenRouter had no provider for it (its endpoint list was empty).
Every request got a 404 error, then fell back to a slower model. One question took about 130 seconds.
I checked OpenRouter for a model that has a provider and supports tools, and chose the free model Flint.
My rule: first correct (all tool tests pass), then fastest.

## Results (measured on my computer)

- Tool tests: 5 of 5 passed (create file, list files, read file, run command, write and run Python code).
- About 30 seconds per task after warm-up (26 to 33 seconds). The first request after start took about 65 seconds.
- 1,000 tasks, one at a time: about 8 hours 20 minutes. 10 at the same time: about 50 minutes, if the provider allows it.
- The free model allows only 50 requests per day, and one task needs at least 2 requests. So the free model cannot do 1,000 tasks.

## Limits and next steps

- run_command has no list of allowed commands.
- The web page has no login.
- Not on the cloud yet. Plan: rent a Linux server, install Docker, run docker compose up -d with the same files, keep keys as secrets, add a login.

## สรุปภาษาไทย

ระบบนี้ให้ AI ใช้เครื่องมือผ่าน MCP: พิมพ์คำสั่งที่หน้าเว็บ OpenClaw ถามโมเดล โมเดลเลือกเครื่องมือ MCP ทำงานจริง แล้วส่งผลกลับ
ทุกส่วนรันใน Docker ด้วยคำสั่งเดียว ไฟล์เก็บใน volume จึงไม่หาย
โมเดลที่ใช้คือ Flint (ฟรี) เพราะ Hermes 4 70B ถูก OpenRouter เอาออก
ข้อจำกัด: ยังไม่จำกัดคำสั่งใน run_command, หน้าเว็บยังไม่มีล็อกอิน, ยังไม่ได้ขึ้น Cloud

## Credits

openclaw/docker-compose.yml comes from the OpenClaw project: https://github.com/openclaw/openclaw
