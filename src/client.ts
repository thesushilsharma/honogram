import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: string;
  type: "message" | "file" | "system";
}

class HonoLanChatCLI {
  private ws: WebSocket | null = null;
  private username: string = "";
  private rl: readline.Interface;
  private serverUrl: string;
  private isConnected: boolean = false;

  constructor(serverUrl: string = "ws://localhost:3001") {
    this.serverUrl = serverUrl;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.setupDirectories();
    this.connectToServer();
  }

  private setupDirectories() {
    if (!fs.existsSync("received")) {
      fs.mkdirSync("received", { recursive: true });
    }
  }

  private connectToServer() {
    console.log(`\x1b[36m🔗 Connecting to ${this.serverUrl}...\x1b[0m`);

    this.ws = new WebSocket(this.serverUrl);

    this.ws.on("open", () => {
      this.isConnected = true;
      console.log("\x1b[32m✅ Connected to Hono Chat Server\x1b[0m");
      this.promptUsername();
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.log("\x1b[31m❌ Error parsing message\x1b[0m");
      }
    });

    this.ws.on("close", () => {
      this.isConnected = false;
      console.log("\x1b[31m❌ Disconnected from server\x1b[0m");
      console.log("\x1b[33m🔄 Reconnecting in 3 seconds...\x1b[0m");
      setTimeout(() => this.connectToServer(), 3000);
    });

    this.ws.on("error", (error) => {
      console.log("\x1b[31m❌ Connection failed:", error.message, "\x1b[0m");
    });
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case "joined":
        console.log(`\x1b[32m👤 Joined as: ${this.username}\x1b[0m`);
        if (data.chatHistory.length > 0) {
          console.log("\n\x1b[36m📜 Chat History:\x1b[0m");
          data.chatHistory.forEach((msg: ChatMessage) =>
            this.displayMessage(msg)
          );
          console.log("\x1b[36m--- End of History ---\x1b[0m\n");
        }
        console.log("\x1b[36mType /help for available commands\x1b[0m\n");
        this.startChatLoop();
        break;
      case "message":
        this.displayMessage(data.data);
        break;
      case "file_received":
        this.handleFileReceived(data.data);
        break;
    }
  }

  private promptUsername() {
    this.rl.question("Enter your username: ", (username) => {
      this.username = username.trim();
      if (this.username) {
        this.send({
          type: "join",
          username: this.username,
        });
      } else {
        console.log("\x1b[31m❌ Username cannot be empty\x1b[0m");
        this.promptUsername();
      }
    });
  }

  private startChatLoop() {
    const promptChat = () => {
      this.rl.question("", (input) => {
        this.handleInput(input.trim());
        promptChat();
      });
    };
    promptChat();
  }

  private handleInput(input: string) {
    if (input.startsWith("/")) {
      this.handleCommand(input);
    } else if (input.length > 0) {
      this.send({
        type: "message",
        message: input,
      });
    }
  }

  private handleCommand(command: string) {
    const [cmd, ...args] = command.split(" ");

    switch (cmd.toLowerCase()) {
      case "/help":
        this.showHelp();
        break;
      case "/send":
      case "/file":
        if (args.length > 0) {
          this.sendFile(args.join(" "));
        } else {
          console.log("\x1b[33m⚠️  Usage: /send <filepath>\x1b[0m");
        }
        break;
      case "/quit":
      case "/exit":
        console.log("\x1b[33m👋 Goodbye!\x1b[0m");
        process.exit(0);
        break;
      case "/clear":
        console.clear();
        break;
      default:
        console.log(
          "\x1b[31m❌ Unknown command. Type /help for available commands\x1b[0m"
        );
    }
  }

  private sendFile(filepath: string) {
    try {
      if (!fs.existsSync(filepath)) {
        console.log("\x1b[31m❌ File not found\x1b[0m");
        return;
      }

      const fileData = fs.readFileSync(filepath);
      const filename = path.basename(filepath);
      const fileSize = fs.statSync(filepath).size;

      console.log(
        `\x1b[36m📤 Sending file: ${filename} (${this.formatFileSize(
          fileSize
        )})\x1b[0m`
      );

      this.send({
        type: "file",
        data: {
          filename,
          fileData: fileData.toString("base64"),
          fileSize,
          sender: this.username,
        },
      });
    } catch (error) {
      console.log(
        "\x1b[31m❌ Error sending file:",
        (error as Error).message,
        "\x1b[0m"
      );
    }
  }

  private handleFileReceived(data: any) {
    try {
      const filePath = path.join("received", data.filename);
      const buffer = Buffer.from(data.fileData, "base64");
      fs.writeFileSync(filePath, buffer);

      console.log(
        `\x1b[35m📁 File received from ${data.sender}: ${data.filename} saved to received/\x1b[0m`
      );
    } catch (error) {
      console.log(
        "\x1b[31m❌ Error saving file:",
        (error as Error).message,
        "\x1b[0m"
      );
    }
  }

  private displayMessage(message: ChatMessage) {
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    const colors = {
      message: "\x1b[37m",
      file: "\x1b[35m",
      system: "\x1b[33m",
    };

    const color = colors[message.type] || "\x1b[37m";
    console.log(
      `${color}[${timestamp}] ${message.username}: ${message.message}\x1b[0m`
    );
  }

  private showHelp() {
    console.log("\n\x1b[36m📖 Available Commands:\x1b[0m");
    console.log("  /help          - Show this help message");
    console.log("  /send <file>   - Send a file to all users");
    console.log("  /file <file>   - Alias for /send");
    console.log("  /clear         - Clear the screen");
    console.log("  /quit          - Exit the chat");
    console.log("  /exit          - Exit the chat");
    console.log(
      '\n\x1b[36m📁 Files are automatically saved to the "received/" folder\x1b[0m\n'
    );
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

// Get server URL from command line args or use default
const serverUrl = process.argv[2] || "ws://localhost:3001";
new HonoLanChatCLI(serverUrl);
