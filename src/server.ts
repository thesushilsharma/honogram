import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";

interface User {
  id: string;
  username: string;
  ws: WebSocket;
}

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: string;
  type: "message" | "file" | "system";
}

interface FileTransfer {
  filename: string;
  fileData: string; // base64 encoded
  fileSize: number;
  sender: string;
}

class HonoLanChatServer {
  private app: Hono;
  private users: Map<string, User> = new Map();
  private chatLog: ChatMessage[] = [];
  private wss!: WebSocketServer;
  private port: number = 3001;

  constructor() {
    this.app = new Hono();
    this.setupDirectories();
    this.setupRoutes();
    this.startServer();
  }

  private setupDirectories() {
    const dirs = ["received", "logs", "public"];
    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    this.createWebInterface();
  }

  private setupRoutes() {
    // CORS for all routes
    this.app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "PUT", "DELETE"],
        allowHeaders: ["Content-Type", "Authorization"],
      })
    );

    // Serve static files
    this.app.use("/static/*", serveStatic({ root: "./" }));

    // Main chat interface
    this.app.get("/", (c) => {
      const html = fs.readFileSync("public/index.html", "utf-8");
      return c.html(html);
    });

    // API endpoints
    this.app.get("/api/health", (c) => {
      return c.json({
        status: "healthy",
        users: this.users.size,
        messages: this.chatLog.length,
      });
    });

    this.app.get("/api/chat-history", (c) => {
      return c.json(this.chatLog);
    });

    this.app.get("/api/users", (c) => {
      const userList = Array.from(this.users.values()).map(
        (user) => user.username
      );
      return c.json(userList);
    });

    // File download endpoint
    this.app.get("/api/download/:filename", (c) => {
      const filename = c.req.param("filename");
      const filePath = path.join("received", filename);

      if (!fs.existsSync(filePath)) {
        return c.notFound();
      }

      const file = fs.readFileSync(filePath);
      return new Response(file, {
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Type": "application/octet-stream",
        },
      });
    });
  }

  private startServer() {
    const server = createServer();
  
    // Let ws attach its own upgrade listener
    this.wss = new WebSocketServer({ server });
    this.setupWebSocketHandlers();
  
    server.on("request", async (req, res) => {
      if (req.headers.upgrade === "websocket") return;
  
      const chunks: any[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", async () => {
        const body = Buffer.concat(chunks);
        const request = new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers as any,
          body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
        });
  
        const honoRes = await this.app.fetch(request);
        res.writeHead(honoRes.status, Object.fromEntries(honoRes.headers.entries()));
        const responseBody = await honoRes.arrayBuffer();
        res.end(Buffer.from(responseBody));
      });
    });
  
    server.listen(this.port, () => {
      this.logToConsole(`🚀 Hono LAN Chat Server running on port ${this.port}`, "SUCCESS");
      this.logToConsole(`🌐 Web interface: http://localhost:${this.port}`, "INFO");
      this.logToConsole(`📡 WebSocket ready for connections...`, "INFO");
    });
  }
  

  private setupWebSocketHandlers() {
    this.wss.on("connection", (ws: WebSocket) => {
      const userId = nanoid();
      this.logToConsole(`🔗 New WebSocket connection: ${userId}`, "INFO");

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, userId, message);
        } catch (error) {
          this.logToConsole(
            `❌ Invalid message format from ${userId}`,
            "ERROR"
          );
        }
      });

      ws.on("close", () => {
        this.handleUserDisconnect(userId);
      });

      ws.on("error", (error) => {
        this.logToConsole(
          `❌ WebSocket error for ${userId}: ${error.message}`,
          "ERROR"
        );
      });
    });
  }

  private handleWebSocketMessage(ws: WebSocket, userId: string, message: any) {
    switch (message.type) {
      case "join":
        this.handleUserJoin(ws, userId, message.username);
        break;
      case "message":
        this.handleChatMessage(userId, message.message);
        break;
      case "file":
        this.handleFileTransfer(userId, message.data);
        break;
      default:
        this.logToConsole(`❌ Unknown message type: ${message.type}`, "ERROR");
    }
  }

  private handleUserJoin(ws: WebSocket, userId: string, username: string) {
    const user: User = {
      id: userId,
      username,
      ws,
    };

    this.users.set(userId, user);

    const joinMessage: ChatMessage = {
      id: nanoid(),
      username: "System",
      message: `${username} joined the chat`,
      timestamp: new Date().toISOString(),
      type: "system",
    };

    this.broadcastMessage(joinMessage);
    this.logToConsole(`👤 ${username} joined the chat`, "SUCCESS");

    // Send welcome data to new user
    ws.send(
      JSON.stringify({
        type: "joined",
        chatHistory: this.chatLog,
        users: Array.from(this.users.values()).map((u) => u.username),
      })
    );

    this.broadcastUserList();
  }

  private handleChatMessage(userId: string, messageText: string) {
    const user = this.users.get(userId);
    if (!user) return;

    const chatMessage: ChatMessage = {
      id: nanoid(),
      username: user.username,
      message: messageText,
      timestamp: new Date().toISOString(),
      type: "message",
    };

    this.broadcastMessage(chatMessage);
    this.logToConsole(`💬 ${user.username}: ${messageText}`, "MESSAGE");
  }

  private handleFileTransfer(userId: string, fileData: FileTransfer) {
    const user = this.users.get(userId);
    if (!user) return;

    // Save file to received folder
    const filePath = path.join("received", fileData.filename);
    const buffer = Buffer.from(fileData.fileData, "base64");
    fs.writeFileSync(filePath, buffer);

    const fileMessage: ChatMessage = {
      id: nanoid(),
      username: user.username,
      message: `📎 Shared file: ${fileData.filename} (${this.formatFileSize(
        fileData.fileSize
      )})`,
      timestamp: new Date().toISOString(),
      type: "file",
    };

    this.broadcastMessage(fileMessage);
    this.logToConsole(
      `📁 ${user.username} shared file: ${
        fileData.filename
      } (${this.formatFileSize(fileData.fileSize)})`,
      "FILE"
    );

    // Broadcast file to all other users
    this.broadcastToOthers(userId, {
      type: "file_received",
      data: {
        filename: fileData.filename,
        fileData: fileData.fileData,
        sender: user.username,
        fileSize: fileData.fileSize,
        downloadUrl: `/api/download/${fileData.filename}`,
      },
    });
  }

  private handleUserDisconnect(userId: string) {
    const user = this.users.get(userId);
    if (user) {
      const leaveMessage: ChatMessage = {
        id: nanoid(),
        username: "System",
        message: `${user.username} left the chat`,
        timestamp: new Date().toISOString(),
        type: "system",
      };

      this.broadcastMessage(leaveMessage);
      this.logToConsole(`👋 ${user.username} left the chat`, "WARNING");
      this.users.delete(userId);
      this.broadcastUserList();
    }
  }

  private broadcastMessage(message: ChatMessage) {
    this.chatLog.push(message);
    this.broadcast({
      type: "message",
      data: message,
    });
    this.saveChatLog();
  }

  private broadcast(data: any) {
    const message = JSON.stringify(data);
    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(message);
      }
    });
  }

  private broadcastToOthers(excludeUserId: string, data: any) {
    const message = JSON.stringify(data);
    this.users.forEach((user, userId) => {
      if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(message);
      }
    });
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.values()).map(
      (user) => user.username
    );
    this.broadcast({
      type: "user_list",
      data: userList,
    });
  }

  private saveChatLog() {
    const logContent = this.chatLog
      .map(
        (msg) =>
          `[${new Date(msg.timestamp).toLocaleString()}] ${msg.username}: ${
            msg.message
          }`
      )
      .join("\n");

    fs.writeFileSync("chatlog.txt", logContent);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private logToConsole(
    message: string,
    type: "SUCCESS" | "ERROR" | "WARNING" | "INFO" | "MESSAGE" | "FILE"
  ) {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
      SUCCESS: "\x1b[32m",
      ERROR: "\x1b[31m",
      WARNING: "\x1b[33m",
      INFO: "\x1b[36m",
      MESSAGE: "\x1b[37m",
      FILE: "\x1b[35m",
      RESET: "\x1b[0m",
    };

    console.log(`${colors[type]}[${timestamp}] ${message}${colors.RESET}`);
  }

  private createWebInterface() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🚀 Hono LAN Chat</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .message-enter {
            animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>
<body class="bg-gray-900 text-white">
    <div id="app">
        <!-- Login Screen -->
        <div id="loginScreen" class="min-h-screen flex items-center justify-center p-4">
            <div class="bg-gray-800 rounded-lg p-8 w-full max-w-md">
                <h1 class="text-3xl font-bold text-center mb-6">🚀 Hono LAN Chat</h1>
                <div class="space-y-4">
                    <div>
                        <label class="block text-gray-300 mb-2">Username</label>
                        <input
                            type="text"
                            id="usernameInput"
                            class="w-full p-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter your username"
                            maxlength="20"
                        />
                    </div>
                    <button
                        id="joinBtn"
                        class="w-full p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
                    >
                        Join Chat
                    </button>
                    <div class="text-center">
                        <span id="connectionStatus" class="inline-block w-3 h-3 rounded-full mr-2 bg-red-500"></span>
                        <span id="connectionText" class="text-gray-400">Connecting...</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Chat Screen -->
        <div id="chatScreen" class="min-h-screen flex hidden">
            <!-- Sidebar -->
            <div class="w-64 bg-gray-800 p-4 flex flex-col">
                <h2 class="text-xl font-bold mb-4">🔥 Hono Chat</h2>
                <div class="flex-1">
                    <h3 class="text-gray-300 mb-2">Online Users (<span id="userCount">0</span>)</h3>
                    <div id="userList" class="space-y-1 mb-4"></div>
                </div>
                <div class="space-y-2">
                    <input type="file" id="fileInput" class="hidden" />
                    <button
                        id="sendFileBtn"
                        class="w-full p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                    >
                        📎 Send File
                    </button>
                    <button
                        id="clearBtn"
                        class="w-full p-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                        🗑️ Clear Chat
                    </button>
                </div>
            </div>

            <!-- Main Chat Area -->
            <div class="flex-1 flex flex-col">
                <!-- Messages -->
                <div id="messagesContainer" class="flex-1 overflow-y-auto p-4 space-y-2">
                    <!-- Messages will be added here -->
                </div>

                <!-- Input Area -->
                <div class="p-4 bg-gray-800 border-t border-gray-700">
                    <div class="flex space-x-2">
                        <input
                            type="text"
                            id="messageInput"
                            class="flex-1 p-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Type your message..."
                            maxlength="500"
                        />
                        <button
                            id="sendBtn"
                            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        class HonoChatClient {
            constructor() {
                this.ws = null;
                this.username = '';
                this.isConnected = false;
                this.init();
            }

            init() {
                this.bindEvents();
                this.connect();
            }

            connect() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = \`\${protocol}//\${window.location.host}\`;
                
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    this.isConnected = true;
                    this.updateConnectionStatus(true);
                };

                this.ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                };

                this.ws.onclose = () => {
                    this.isConnected = false;
                    this.updateConnectionStatus(false);
                    setTimeout(() => this.connect(), 3000);
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                };
            }

            bindEvents() {
                // Login events
                document.getElementById('joinBtn').onclick = () => this.joinChat();
                document.getElementById('usernameInput').onkeypress = (e) => {
                    if (e.key === 'Enter') this.joinChat();
                };

                // Chat events
                document.getElementById('sendBtn').onclick = () => this.sendMessage();
                document.getElementById('messageInput').onkeypress = (e) => {
                    if (e.key === 'Enter') this.sendMessage();
                };

                document.getElementById('sendFileBtn').onclick = () => {
                    document.getElementById('fileInput').click();
                };

                document.getElementById('fileInput').onchange = (e) => {
                    this.sendFile(e.target.files[0]);
                };

                document.getElementById('clearBtn').onclick = () => {
                    document.getElementById('messagesContainer').innerHTML = '';
                };
            }

            joinChat() {
                const username = document.getElementById('usernameInput').value.trim();
                if (!username || !this.isConnected) return;

                this.username = username;
                this.send({
                    type: 'join',
                    username: username
                });
            }

            sendMessage() {
                const input = document.getElementById('messageInput');
                const message = input.value.trim();
                if (!message) return;

                this.send({
                    type: 'message',
                    message: message
                });

                input.value = '';
            }

            sendFile(file) {
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Data = e.target.result.split(',')[1];
                    this.send({
                        type: 'file',
                        data: {
                            filename: file.name,
                            fileData: base64Data,
                            fileSize: file.size,
                            sender: this.username
                        }
                    });
                };
                reader.readAsDataURL(file);
            }

            send(data) {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify(data));
                }
            }

            handleMessage(data) {
                switch (data.type) {
                    case 'joined':
                        this.showChatScreen();
                        data.chatHistory.forEach(msg => this.displayMessage(msg));
                        this.updateUserList(data.users);
                        break;
                    case 'message':
                        this.displayMessage(data.data);
                        break;
                    case 'user_list':
                        this.updateUserList(data.data);
                        break;
                    case 'file_received':
                        this.handleFileReceived(data.data);
                        break;
                }
            }

            showChatScreen() {
                document.getElementById('loginScreen').classList.add('hidden');
                document.getElementById('chatScreen').classList.remove('hidden');
            }

            displayMessage(message) {
                const container = document.getElementById('messagesContainer');
                const messageDiv = document.createElement('div');
                
                const typeClasses = {
                    message: 'bg-gray-800 text-white',
                    file: 'bg-purple-900 text-purple-200',
                    system: 'bg-yellow-900 text-yellow-200'
                };

                messageDiv.className = \`p-3 rounded-lg message-enter \${typeClasses[message.type] || typeClasses.message}\`;
                
                const time = new Date(message.timestamp).toLocaleTimeString();
                messageDiv.innerHTML = \`
                    <div class="flex items-center justify-between mb-1">
                        <span class="font-bold">\${message.username}</span>
                        <span class="text-xs opacity-75">\${time}</span>
                    </div>
                    <div>\${message.message}</div>
                \`;

                container.appendChild(messageDiv);
                container.scrollTop = container.scrollHeight;
            }

            updateUserList(users) {
                const userList = document.getElementById('userList');
                const userCount = document.getElementById('userCount');
                
                userList.innerHTML = users.map(user => \`
                    <div class="text-gray-400 text-sm flex items-center">
                        <span class="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                        \${user}
                    </div>
                \`).join('');
                
                userCount.textContent = users.length;
            }

            handleFileReceived(data) {
                // Auto-download received files
                const blob = new Blob([new Uint8Array(atob(data.fileData).split('').map(c => c.charCodeAt(0)))]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = data.filename;
                a.click();
                URL.revokeObjectURL(url);

                // Show notification
                this.showNotification(\`📁 File received from \${data.sender}: \${data.filename}\`);
            }

            updateConnectionStatus(connected) {
                const status = document.getElementById('connectionStatus');
                const text = document.getElementById('connectionText');
                const joinBtn = document.getElementById('joinBtn');

                if (connected) {
                    status.className = 'inline-block w-3 h-3 rounded-full mr-2 bg-green-500';
                    text.textContent = 'Connected';
                    joinBtn.disabled = false;
                } else {
                    status.className = 'inline-block w-3 h-3 rounded-full mr-2 bg-red-500';
                    text.textContent = 'Disconnected';
                    joinBtn.disabled = true;
                }
            }

            showNotification(message) {
                // Simple notification system
                const notification = document.createElement('div');
                notification.className = 'fixed top-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50';
                notification.textContent = message;
                document.body.appendChild(notification);

                setTimeout(() => {
                    notification.remove();
                }, 3000);
            }
        }

        // Initialize the chat client
        new HonoChatClient();
    </script>
</body>
</html>`;

    fs.writeFileSync("public/index.html", html);
  }
}

new HonoLanChatServer();
