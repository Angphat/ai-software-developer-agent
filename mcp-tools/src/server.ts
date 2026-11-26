import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// โฟลเดอร์ทำงานของ Agent: ทุกไฟล์ที่สร้างจะอยู่ที่นี่
// (เป็น Docker volume จึงไม่หายเมื่อสร้าง container ใหม่)
const WORKDIR = "/home/node/mcp-tools/files";

// ---------- ส่วนที่ 1: สร้างตัว MCP server ----------
const server = new Server(
  { name: "openclaw-tools", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

// ---------- ส่วนที่ 2: ประกาศรายการเครื่องมือ ----------
// AI อ่านชื่อและคำอธิบายตรงนี้ เพื่อรู้ว่ามีเครื่องมืออะไร และเรียกอย่างไร
const tools = [
  {
    name: "create_file",
    description:
      "Create a text file (overwrites if it exists). Use a relative path such as demo.py.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file and return its content.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "List file names in a folder (default: the workspace root).",
    inputSchema: { type: "object", properties: { dir: { type: "string" } } },
  },
  {
    name: "run_command",
    description:
      "Run a shell command inside the workspace folder (15 second timeout) and return its output.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// ป้องกันไม่ให้พาธหลุดออกนอกโฟลเดอร์ทำงาน (เช่น ../)
function safePath(p: string): string {
  const full = path.resolve(WORKDIR, p);
  if (full !== WORKDIR && !full.startsWith(WORKDIR + path.sep)) {
    throw new Error("path must stay inside the workspace folder");
  }
  return full;
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

// ---------- ส่วนที่ 3: ลงมือทำจริงเมื่อ AI สั่งเรียกเครื่องมือ ----------
server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {}; // AI บางตัวไม่ส่ง arguments มาเลย
  try {
    switch (name) {
      case "create_file": {
        if (typeof args.path !== "string" || typeof args.content !== "string") {
          throw new Error("create_file needs string arguments: path, content");
        }
        const p = safePath(args.path);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, args.content, "utf-8");
        return ok(`Created ${args.path} at ${p}`);
      }
      case "read_file": {
        if (typeof args.path !== "string")
          throw new Error("read_file needs a string argument: path");
        return ok(await fs.readFile(safePath(args.path), "utf-8"));
      }
      case "list_files": {
        const dir = typeof args.dir === "string" && args.dir ? args.dir : ".";
        const items = await fs.readdir(safePath(dir));
        return ok(items.join("\n") || "(empty folder)");
      }
      case "run_command": {
        if (typeof args.command !== "string")
          throw new Error("run_command needs a string argument: command");
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: WORKDIR,
          timeout: 15000,
        });
        return ok(stdout || stderr || "(no output)");
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    // ส่งข้อความ error จริงกลับให้ AI เห็น แทนที่จะพังเงียบๆ
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error: ${e.message}` }],
    };
  }
});

// ---------- ส่วนที่ 4: เริ่มทำงาน ----------
await fs.mkdir(WORKDIR, { recursive: true });
const transport = new StdioServerTransport(); // คุยกับ OpenClaw ผ่าน stdin/stdout
await server.connect(transport);
