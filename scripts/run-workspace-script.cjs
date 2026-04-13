const { spawn } = require("node:child_process");
const path = require("node:path");

const [, , workspace, scriptName] = process.argv;

if (!workspace || !scriptName) {
  console.error("Usage: node scripts/run-workspace-script.cjs <workspace> <script>");
  process.exit(1);
}

const workspaceDir = path.resolve(__dirname, "..", workspace);
const child =
  process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", "run", scriptName], {
        cwd: workspaceDir,
        stdio: "inherit",
        shell: false,
      })
    : spawn("npm", ["run", scriptName], {
        cwd: workspaceDir,
        stdio: "inherit",
        shell: false,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
